/**
 * AgentRepl — Gemini CLI & Claude Code style Agent REPL for ScanForge
 */
import React, { useEffect, useReducer, useState, useCallback } from 'react';
import { Box, Text, useApp, useInput, useWindowSize } from 'ink';
import TextInput from 'ink-text-input';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { SLASH_COMMANDS } from './SlashCommands.js';
import { promptReducer, INITIAL_PROMPT_STATE } from './promptReducer.js';
import { WelcomeSplash } from './components/WelcomeSplash.jsx';
import { ActivityFeed } from './components/ActivityFeed.jsx';
import { TaskBlock } from './components/TaskBlock.jsx';
import { CommandPaletteDropdown } from './components/CommandPaletteDropdown.jsx';
import { TargetsManager } from './components/TargetsManager.jsx';
import { ReportInspector } from './components/ReportInspector.jsx';
import { HelpCard } from './components/HelpCard.jsx';
import { SettingsManager, buildSettingsRows, applySettingsSelection, adjustSlider } from './components/SettingsManager.jsx';
import { terminalDriver } from '../tui/terminal-driver.js';
import { globalCompanionBus, normalizeUrl, cleanPidFile } from '../../companion/companion-bus.js';
import { reportsToCombinedMarkdown } from '../../companion/lhr-to-markdown.js';

export function getDownloadsFolder() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Downloads') : path.join(home, 'Downloads');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Downloads');
  }
  const xdg = process.env.XDG_DOWNLOAD_DIR;
  if (xdg && fs.existsSync(xdg)) return xdg;
  return path.join(home, 'Downloads');
}

export function AgentRepl({ bus = globalCompanionBus }) {
  const { exit } = useApp();

  // ── Terminal dimensions ─────────────────────────────────────────
  // Read from Ink's own useWindowSize() rather than a separately-tracked resize
  // listener — two independent process.stdout 'resize' listeners (this app's and
  // Ink's own internal one) can fire on different ticks after a real resize, so
  // for a render or two the Box width this app declares and the width Ink's own
  // redraw/cursor-position math assumes disagree. Ink's docs call this out by name:
  // "ghost lines may briefly appear" on resize. Sharing Ink's own tracked stdout
  // removes the race instead of papering over the symptom.
  const dimensions = useWindowSize();

  // ── Prompt state machine (useReducer) ───────────────────────────
  const [prompt, dispatch] = useReducer(promptReducer, INITIAL_PROMPT_STATE);

  // ── App state ───────────────────────────────────────────────────
  const [messages, setMessages] = useState([]);
  const [targets, setTargets] = useState([]);
  const [settings, setSettings] = useState(() => bus.getSettings());
  const [companionStatus, setCompanionStatus] = useState(() => bus.getStatus());
  const [sessionReports, setSessionReports] = useState([]); // every run this session; /report selects from these to combine & save
  const [outDir, setOutDir] = useState(() => getDownloadsFolder());

  // ── Interactive Managers (Targets / Reports / Help) ─────────────
  const [showTargetsManager, setShowTargetsManager] = useState(false);
  const [targetCursor, setTargetCursor] = useState(0);
  const [showReportInspector, setShowReportInspector] = useState(false);
  const [reportCursor, setReportCursor] = useState(0);
  const [isReportExpanded, setIsReportExpanded] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showSettingsManager, setShowSettingsManager] = useState(false);
  const [settingsCursor, setSettingsCursor] = useState(0);
  const [settingsWarning, setSettingsWarning] = useState('');

  // ── Message helpers ─────────────────────────────────────────────
  const addMessage = useCallback((type, content) => {
    setMessages(prev => [...prev, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      content,
    }]);
  }, []);

  // ── Safe exit handler ──────────────────────────────────────────
  const handleSafeExit = useCallback(async () => {
    try {
      await bus.stopActiveRuns();
    } catch {}
    try {
      cleanPidFile();
    } catch {}
    try {
      terminalDriver.exit();
    } catch {}
    try {
      exit();
    } catch {}
    setTimeout(() => {
      process.exit(0);
    }, 50);
  }, [bus, exit]);

  // ── Companion Bus sync ──────────────────────────────────────────
  useEffect(() => {
    const handleStatus = ({ status }) => setCompanionStatus(status);
    const handleSettings = ({ settings: s }) => setSettings(s);
    const handleComplete = ({ reports }) => {
      const list = reports || [];
      setSessionReports(prev => [...prev, ...list.map(r => ({ ...r, selected: true }))]);
      setShowTargetsManager(false);
      setShowHelp(false);
      setShowSettingsManager(false);
      setReportCursor(0);
      setIsReportExpanded(false);
      setShowReportInspector(list.length > 0);
      addMessage('success', `Audit completed — ${list.length} report${list.length === 1 ? '' : 's'} ready.`);
    };

    bus.on('status', handleStatus);
    bus.on('settings', handleSettings);
    bus.on('complete', handleComplete);
    return () => {
      bus.removeListener('status', handleStatus);
      bus.removeListener('settings', handleSettings);
      bus.removeListener('complete', handleComplete);
    };
  }, [bus, addMessage]);

  // ── Save a combined Markdown report for the given (selected) reports ────
  const saveCombinedReport = useCallback((reports) => {
    const primaryReport = reports[0];
    const rawName = primaryReport?.title || primaryReport?.url || 'report';
    const safeName = rawName.replace(/https?:\/\//i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'report';
    const dateStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const suffix = reports.length > 1 ? `-combined-${reports.length}` : '';
    const targetFile = path.join(outDir, `scanforge-${safeName}${suffix}-${dateStamp}.md`);
    const md = reportsToCombinedMarkdown(reports);
    try {
      fs.mkdirSync(path.dirname(targetFile), { recursive: true });
      fs.writeFileSync(targetFile, md, 'utf8');
      addMessage('success', `Report saved (${reports.length} audit${reports.length === 1 ? '' : 's'})\n   ${targetFile}`);
    } catch (err) {
      addMessage('error', `Save failed: ${err.message}`);
    }
  }, [outDir, addMessage]);

  // ── Keyboard interception (top-level dispatcher) ────────────────
  useInput((input, key) => {
    // ── TARGETS_MANAGER mode: handle interactive checklist navigation ──
    // Single-key shortcuts (space/s/a/d/c) only fire when the input box is empty — the
    // moment you're typing a URL to add, letters like the 'd' in docs.google.com or the
    // 's' in stripe.com must reach the text box, not get eaten as a shortcut.
    if (showTargetsManager) {
      const isTyping = prompt.rawInput.length > 0;
      if (key.upArrow) {
        setTargetCursor(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setTargetCursor(prev => Math.min(targets.length - 1, prev + 1));
        return;
      }
      if (!isTyping && input === ' ') {
        setTargets(prev =>
          prev.map((t, idx) => (idx === targetCursor ? { ...t, selected: !t.selected } : t))
        );
        return;
      }
      if (!isTyping && (input === 's' || input === 'S' || input === 'a' || input === 'A')) {
        const allSelected = targets.every(t => t.selected);
        setTargets(prev => prev.map(t => ({ ...t, selected: !allSelected })));
        return;
      }
      if (!isTyping && (input === 'd' || input === 'D')) {
        if (targets.length > 0) {
          setTargets(prev => prev.filter((_, idx) => idx !== targetCursor));
          setTargetCursor(prev => Math.max(0, Math.min(prev, targets.length - 2)));
        }
        return;
      }
      if (!isTyping && (input === 'c' || input === 'C')) {
        setTargets([]);
        setTargetCursor(0);
        return;
      }
      if (!isTyping && key.return) {
        const selected = targets.filter(t => t.selected);
        setShowTargetsManager(false);
        if (selected.length > 0) {
          addMessage('system', `🚀 Starting audit on ${selected.length} selected target(s)...`);
          bus.createRun({ pages: selected, options: settings });
        }
        return;
      }
      if (key.escape) {
        setShowTargetsManager(false);
        return;
      }
    }

    // ── REPORT_INSPECTOR mode: navigate, multi-select, and combine reports ──
    if (showReportInspector && sessionReports.length > 0) {
      if (key.upArrow) {
        setReportCursor(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setReportCursor(prev => Math.min(sessionReports.length - 1, prev + 1));
        return;
      }
      if (input === ' ') {
        setSessionReports(prev => prev.map((r, idx) => (idx === reportCursor ? { ...r, selected: !r.selected } : r)));
        return;
      }
      if (input === 'e' || input === 'E') {
        setIsReportExpanded(prev => !prev);
        return;
      }
      if (input === 'a' || input === 'A' || input === 's' || input === 'S') {
        setSessionReports(prev => {
          const allSelected = prev.every(r => r.selected);
          return prev.map(r => ({ ...r, selected: !allSelected }));
        });
        return;
      }
      if (input >= '1' && input <= '9') {
        const idx = parseInt(input, 10) - 1;
        if (idx >= 0 && idx < sessionReports.length) {
          setReportCursor(idx);
        }
        return;
      }
      if (key.return) {
        const selected = sessionReports.filter(r => r.selected);
        if (!selected.length) {
          addMessage('error', 'No reports selected. Press [Space] to select at least one.');
          return;
        }
        saveCombinedReport(selected);
        setShowReportInspector(false);
        return;
      }
      if (key.escape || input === 'q' || input === 'Q') {
        setShowReportInspector(false);
        return;
      }
    }

    // ── SETTINGS_MANAGER mode: navigate radio/checkbox rows, apply live ──
    if (showSettingsManager) {
      const rows = buildSettingsRows(settings).filter(r => r.type !== 'header');
      if (key.upArrow) {
        setSettingsCursor(prev => Math.max(0, prev - 1));
        setSettingsWarning('');
        return;
      }
      if (key.downArrow) {
        setSettingsCursor(prev => Math.min(rows.length - 1, prev + 1));
        setSettingsWarning('');
        return;
      }
      if (key.leftArrow || key.rightArrow) {
        const next = adjustSlider(settings, rows[settingsCursor], key.leftArrow ? -1 : 1);
        if (next !== settings) {
          setSettings(next);
          bus.saveSettings(next);
        }
        return;
      }
      if (input === ' ' || key.return) {
        const row = rows[settingsCursor];
        if (row.type === 'checkbox' && row.group === 'categories' && !row.disabled && row.selected && (settings.categories || []).length === 1) {
          setSettingsWarning('At least one category is required — pick another before removing this one.');
          return;
        }
        const next = applySettingsSelection(settings, row);
        if (next !== settings) {
          setSettings(next);
          bus.saveSettings(next);
          setSettingsWarning('');
        }
        return;
      }
      if (key.escape || input === 'q' || input === 'Q') {
        setShowSettingsManager(false);
        setSettingsWarning('');
        return;
      }
    }

    // ── HELP mode: Esc or Enter dismisses ─────────────────────────────
    if (showHelp) {
      if (key.escape || key.return) {
        setShowHelp(false);
        return;
      }
    }

    // ── COMMAND_PALETTE mode: navigate suggestions / complete ────────
    if (prompt.mode === 'COMMAND_PALETTE') {
      if (key.downArrow) {
        dispatch({ type: 'NAVIGATE_DOWN' });
        return;
      }
      if (key.upArrow) {
        dispatch({ type: 'NAVIGATE_UP' });
        return;
      }
      if (key.tab) {
        dispatch({ type: 'SELECT_CURRENT' });
        return;
      }
      if (key.escape) {
        dispatch({ type: 'DISMISS_PALETTE' });
        return;
      }
    }

    // ── NORMAL mode: history browsing ─────────────────────────
    if (prompt.mode === 'NORMAL' && !showTargetsManager) {
      if (key.upArrow) {
        dispatch({ type: 'NAVIGATE_UP' });
        return;
      }
      if (key.downArrow) {
        dispatch({ type: 'NAVIGATE_DOWN' });
        return;
      }
    }

    // ── Global shortcuts ──────────────────────────────────────
    if (key.ctrl && input === 'c') {
      handleSafeExit();
      return;
    }
  });

  // ── Submit handler ──────────────────────────────────────────────
  const handleSubmit = (value) => {
    let text = value.trim();
    if (!text) return;

    // If in COMMAND_PALETTE mode and a suggestion is highlighted, resolve the command
    if (prompt.mode === 'COMMAND_PALETTE' && prompt.filteredCommands.length > 0) {
      const selected = prompt.filteredCommands[prompt.highlightedIndex];
      if (selected) {
        const parts = text.split(' ');
        const typedCmd = parts[0].toLowerCase();
        const restArgs = parts.slice(1).join(' ').trim();
        // If the typed string is not already an exact match, auto-fill from highlighted selection
        if (!SLASH_COMMANDS.some(c => c.name === typedCmd)) {
          text = restArgs ? `${selected.name} ${restArgs}` : selected.name;
        }
      }
    }

    // While the Targets Manager is open, typing is for adding URLs, not commands — accepts
    // "url1 url2" or "url1, url2" (comma or whitespace separated), stays open so more can
    // be added right after, matching the interactive checkbox/select flow it's already in.
    if (showTargetsManager) {
      const rawUrls = text.split(/[\s,]+/).filter(Boolean);
      const added = [];
      const duplicates = [];
      setTargets(prev => {
        const updated = [...prev];
        for (const raw of rawUrls) {
          const norm = normalizeUrl(raw);
          if (!norm || !/^https?:\/\//.test(norm)) continue;
          if (updated.some(t => normalizeUrl(t.url) === norm)) {
            duplicates.push(norm);
          } else {
            updated.push({ id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, url: norm, title: norm, selected: true });
            added.push(norm);
          }
        }
        return updated;
      });
      if (added.length) addMessage('success', `Added ${added.length} target(s): ${added.join(', ')}`);
      if (duplicates.length) addMessage('system', `Ignored duplicate URL(s): ${duplicates.join(', ')}`);
      if (!added.length && !duplicates.length) addMessage('error', `No valid URL found in "${text}"`);
      dispatch({ type: 'SUBMIT' });
      return;
    }

    // Dismiss open cards on new input
    if (showHelp) setShowHelp(false);
    if (showSettingsManager) setShowSettingsManager(false);

    // Direct exit commands (with or without slash)
    if (['exit', 'quit', ':q'].includes(text.toLowerCase())) {
      handleSafeExit();
      return;
    }

    // Direct URL check
    if (/^(https?:\/\/|[a-z0-9-]+\.[a-z]{2,})/i.test(text) && !text.startsWith('/')) {
      const norm = normalizeUrl(text);
      if (norm && /^https?:\/\//.test(norm)) {
        addMessage('user', norm);
        // Automatically sync with targets queue if not duplicate
        setTargets(prev => {
          if (prev.some(t => normalizeUrl(t.url) === norm)) return prev;
          return [...prev, { id: `t-${Date.now()}`, url: norm, title: norm, selected: true }];
        });
        addMessage('system', `🚀 Starting Lighthouse audit on: ${norm}`);
        bus.createRun({
          pages: [{ id: `page-${Date.now()}`, url: norm, title: norm }],
          options: settings,
        });
      } else {
        addMessage('error', `Invalid URL: ${text}`);
      }
      dispatch({ type: 'SUBMIT' });
      return;
    }

    // Slash command execution
    if (text.startsWith('/')) {
      const [cmd, ...rest] = text.split(' ');
      handleCommandExecution(cmd.toLowerCase(), rest.join(' ').trim());
      dispatch({ type: 'SUBMIT' });
      return;
    }

    addMessage('user', text);
    addMessage('system', `Unknown input "${text}". Type a URL or /help for commands.`);
    dispatch({ type: 'SUBMIT' });
  };

  // ── Command execution ───────────────────────────────────────────
  const handleCommandExecution = (cmd, arg) => {
    switch (cmd) {
      case '/audit': case '/run': case '/scan': {
        const queued = targets.filter(t => t.selected).map(t => ({
          id: t.id, url: normalizeUrl(t.url), title: t.title || t.url,
        }));

        let inlinePages = [];
        if (arg) {
          const rawUrls = arg.split(/[\s,]+/).filter(Boolean);
          inlinePages = rawUrls.map((u, i) => {
            const norm = normalizeUrl(u);
            return { id: `p-${i}-${Date.now()}`, url: norm, title: norm };
          }).filter(p => p.url && /^https?:\/\//.test(p.url));

          // Merge into targets queue without creating duplicates
          setTargets(prev => {
            const existingNorms = new Set(prev.map(t => normalizeUrl(t.url)));
            const newOnes = inlinePages
              .filter(p => !existingNorms.has(p.url))
              .map(p => ({ ...p, selected: true }));
            return [...prev, ...newOnes];
          });
        }

        // Merge queued + inline and deduplicate
        const seen = new Set();
        const allPages = [...queued, ...inlinePages].filter(p => {
          if (!p.url || seen.has(p.url)) return false;
          seen.add(p.url);
          return true;
        });

        if (!allPages.length) {
          addMessage('error', 'No targets to audit. Use /target <url> first, or run /audit <url>');
          return;
        }

        setShowTargetsManager(false);
        setShowReportInspector(false);
        setShowHelp(false);
        setShowSettingsManager(false);
        addMessage('system', `🚀 Starting audit on ${allPages.length} unique target(s)...`);
        bus.createRun({ pages: allPages, options: settings });
        break;
      }

      case '/stop': case '/cancel':
        bus.stopActiveRuns();
        addMessage('system', '⏹ Audit stopped.');
        break;

      case '/target': case '/targets': case '/tar': case '/list': case '/urls': case '/queue': {
        if (arg) {
          const rawUrls = arg.split(/[\s,]+/).filter(Boolean);
          const added = [];
          const duplicates = [];

          setTargets(prev => {
            let updated = [...prev];
            for (const raw of rawUrls) {
              const norm = normalizeUrl(raw);
              if (!norm || !/^https?:\/\//.test(norm)) continue;
              if (updated.some(t => normalizeUrl(t.url) === norm)) {
                duplicates.push(norm);
              } else {
                updated.push({
                  id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                  url: norm,
                  title: norm,
                  selected: true,
                });
                added.push(norm);
              }
            }
            return updated;
          });

          setShowTargetsManager(false);
          setShowReportInspector(false);
          setShowHelp(false);
          setShowSettingsManager(false);
          if (added.length > 0) {
            addMessage('success', `Added ${added.length} target(s): ${added.join(', ')}`);
          }
          if (duplicates.length > 0) {
            addMessage('system', `Ignored duplicate URL(s): ${duplicates.join(', ')}`);
          }
        } else {
          setShowTargetsManager(prev => !prev);
          setShowReportInspector(false);
          setShowHelp(false);
          setShowSettingsManager(false);
          setTargetCursor(0);
        }
        break;
      }

      case '/clear': case '/clean': case '/cls':
        setMessages([]);
        setShowHelp(false);
        setShowTargetsManager(false);
        setShowReportInspector(false);
        setShowSettingsManager(false);
        break;

      case '/clearaudit': case '/auditclear': case '/clearsession': case '/resetaudit':
        setSessionReports([]);
        setShowReportInspector(false);
        addMessage('system', 'Cleared all audit reports for this session — ready for a fresh run.');
        break;

      case '/settings': case '/config': {
        setShowSettingsManager(prev => !prev);
        setShowTargetsManager(false);
        setShowReportInspector(false);
        setShowHelp(false);
        setSettingsCursor(0);
        setSettingsWarning('');
        break;
      }

      case '/report': case '/results': case '/scores': case '/r': {
        if (!sessionReports.length) {
          addMessage('system', 'No reports available yet. Run an audit first.');
          break;
        }
        const num = parseInt(arg, 10);
        if (!isNaN(num) && num >= 1 && num <= sessionReports.length) {
          setReportCursor(num - 1);
          setIsReportExpanded(true);
          setShowReportInspector(true);
        } else {
          setShowReportInspector(prev => !prev);
        }
        setShowTargetsManager(false);
        setShowHelp(false);
        setShowSettingsManager(false);
        break;
      }

      case '/outdir': case '/savepath': case '/path': {
        if (arg) {
          if (arg === 'default' || arg === 'reset') {
            const def = getDownloadsFolder();
            setOutDir(def);
            addMessage('success', `📁 Save directory reset to Downloads:\n   ${def}`);
          } else {
            const resolved = path.resolve(process.cwd(), arg);
            try {
              fs.mkdirSync(resolved, { recursive: true });
              setOutDir(resolved);
              addMessage('success', `📁 Save directory set to:\n   ${resolved}`);
            } catch (err) {
              addMessage('error', `Could not create directory: ${err.message}`);
            }
          }
        } else {
          addMessage('system', `📁 Current save directory:\n   ${outDir}\n\nTip: To change, use: /outdir <folder_path>\n     To reset, use: /outdir default`);
        }
        break;
      }

      case '/status': case '/info': case '/companion': {
        const st = bus.getStatus();
        addMessage('system',
          `Status:\n  Process: ${st.processTitle || 'scanforge'} (PID: ${st.pid || process.pid})\n  Server:  http://127.0.0.1:3210 (Active)\n  State:   ${st.state}\n  Run:     ${st.activeRunId || 'None'}`
        );
        break;
      }

      case '/help': case '/?': {
        setShowHelp(prev => !prev);
        setShowTargetsManager(false);
        setShowSettingsManager(false);
        break;
      }

      case '/exit': case '/quit': case '/q': case '/:q':
        handleSafeExit();
        break;

      default:
        addMessage('error', `Unknown command "${cmd}". Type /help for available commands.`);
    }
  };

  // ── Derived state ───────────────────────────────────────────────
  const isAuditing = companionStatus?.state === 'auditing';
  // Never claim more width than the real terminal has — Ink/Yoga will lay out
  // content assuming this width fits, and a floor above the true available
  // columns causes rows to overflow and visually corrupt on narrow terminals.
  const width = Math.max(10, dimensions.columns - 2);
  const cwd = process.cwd().replace(/\\/g, '/');
  const shortCwd = cwd.length > 35 ? '...' + cwd.slice(-32) : cwd;
  const deviceLabel = settings.device === 'both' ? 'Mobile + Desktop' : settings.device;

  return (
    <Box flexDirection="column" width={width} height={dimensions.rows} paddingX={1}>
      {/* flexGrow pushes the input/footer section down to the bottom of the terminal when
          content doesn't fill it, instead of leaving it stranded right after short content
          with a wall of empty space below. Tall content just pushes back normally. */}
      <Box flexDirection="column" flexGrow={1}>
      {/* ── Main Panel Elements (Hidden during active audit for pure focused view) ── */}
      {!isAuditing && (
        <>
          {/* Welcome Splash (only on initial clean launch, and not alongside another panel —
              showing both at once was needless height pressure on shorter terminals). */}
          {messages.length === 0 && !showTargetsManager && !showReportInspector && !showHelp && !showSettingsManager && (
            <WelcomeSplash columns={width} isCompanionRunning={true} port={3210} />
          )}

          {/* Activity Feed (scrollable message history) */}
          {messages.length > 0 && !showTargetsManager && !showReportInspector && !showHelp && !showSettingsManager && (
            <ActivityFeed messages={messages} maxVisible={8} maxWidth={width} />
          )}

          {/* Interactive Targets Manager (When opened via /targets) */}
          {showTargetsManager && (
            <TargetsManager
              targets={targets}
              cursor={targetCursor}
              maxWidth={width}
            />
          )}

          {/* Help Card (When opened via /help) */}
          {showHelp && <HelpCard maxWidth={width} />}

          {/* Interactive Report Inspector (When opened via /report): multi-select + combine + save */}
          {showReportInspector && sessionReports.length > 0 && (
            <ReportInspector
              reports={sessionReports}
              cursor={reportCursor}
              isExpanded={isReportExpanded}
              maxWidth={width}
            />
          )}

          {/* Interactive Settings Manager (When opened via /settings) */}
          {showSettingsManager && (
            <SettingsManager
              settings={settings}
              cursor={settingsCursor}
              maxWidth={width}
              maxRows={dimensions.rows}
              warning={settingsWarning}
            />
          )}
        </>
      )}

      {/* ── Live Task Block (ONLY progress element shown during audit along with input box) ── */}
      {isAuditing && companionStatus?.run && <TaskBlock run={companionStatus.run} maxWidth={width} maxRows={dimensions.rows} />}
      </Box>

      {/* ── Bottom Section: Input Prompt + Suggestions + Footer ── */}
      <Box flexDirection="column" width={width} marginTop={1}>
        {/* ── Persistent Input Prompt ─────────────────────────── */}
        <Box
          borderStyle="round"
          borderColor="#fc6200"
          paddingX={1}
          width={width}
        >
          <Box gap={1} flexGrow={1}>
            <Text color="yellow" bold>❯ </Text>
            <TextInput
              value={prompt.rawInput}
              onChange={text => dispatch({ type: 'INPUT_CHANGE', text })}
              onSubmit={handleSubmit}
              focus={!showReportInspector && !showHelp && !showSettingsManager}
            />
            {/* ink-text-input hardcodes its own placeholder to grey with no color prop,
                so the theme-orange placeholder is rendered here instead, alongside it. */}
            {!prompt.rawInput && (
              <Text color="#fc6200">
                {showTargetsManager
                  ? "Type URL(s) to add • [↑/↓] Navigate • [Space] Toggle • [Enter] Audit selected • [Esc] Close"
                  : showReportInspector
                  ? "Reports: [Space] Select • [a] All • [Enter] Save selected • [Esc] Close"
                  : showSettingsManager
                  ? "Settings: [↑/↓] Move • [Space/Enter] Select • [Esc] Close"
                  : "Type your message, a URL, or / for commands..."}
              </Text>
            )}
          </Box>
        </Box>

        {/* ── Slash Command Suggestions (below input) ────────── */}
        {prompt.mode === 'COMMAND_PALETTE' && (
          <CommandPaletteDropdown
            filteredCommands={prompt.filteredCommands}
            highlightedIndex={prompt.highlightedIndex}
            scrollOffset={prompt.scrollOffset}
            maxVisible={Math.min(5, prompt.maxVisible)}
            maxWidth={width}
          />
        )}

        {/* ── Bottom Footer Status Line (Gemini CLI style) ─────── */}
        <Box justifyContent="space-between" paddingX={1} marginTop={0} width={width}>
          <Text color="gray">
            ~/{shortCwd} (PID {process.pid} • Port 3210)
          </Text>
          <Text color="gray">
            {deviceLabel} • {settings.lighthouseMode} • {targets.length} queued • [/] commands
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
