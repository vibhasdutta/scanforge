import { forceGC } from './perf-patch.js';
import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';
import lighthouse, { snapshot as lighthouseSnapshot, startTimespan } from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import log from 'lighthouse-logger';
import * as chromeLauncher from 'chrome-launcher';
import puppeteer from 'puppeteer-core';
import { lhrToReportData, reportDataToMarkdown, reportsToCombinedMarkdown } from './lhr-to-markdown.js';
import { AuditDb } from './audit-db.js';
import { assertSafeAuditUrl } from './security.js';

try {
  process.title = 'scanforge-companion';
} catch {}

const DATA_DIR = process.env.SCANFORGE_DATA_DIR || path.join(process.env.APPDATA || os.homedir(), 'ScanForge');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const PID_FILE = path.join(DATA_DIR, 'companion.pid');
const AUDIT_TIMEOUT_MS = Math.max(30000, Number(process.env.SCANFORGE_AUDIT_TIMEOUT_MS || 180000));
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
// agentic-browsing's supportedModes per Lighthouse itself (core/config/default-config.js)
// is ['navigation', 'snapshot'] — not timespan.
const MODE_CATEGORIES = {
  navigation: [...CATEGORIES, 'agentic-browsing'],
  timespan: ['performance', 'best-practices'],
  snapshot: ['accessibility', 'best-practices', 'seo', 'agentic-browsing'],
};
const DEVICES = ['mobile', 'desktop'];
const CHROME_FLAGS = [
  '--headless=new',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-component-update',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-breakpad',
  '--disable-client-side-phishing-detection',
  '--disable-domain-reliability',
  '--disable-sync',
  '--disable-features=Translate,OptimizationHints,MediaRouter',
  '--mute-audio',
  '--disable-gpu',
  '--disable-dev-shm-usage',
];
// Fast mode's worker count. Each worker holds its own full Chrome process tree for the
// whole run — measured ~130MB idle, 300-500MB+ while actively auditing once page content
// and Lighthouse's own trace/LHR data (documented 150MB+ per finished audit below) are
// factored in. Memory is the tighter real-world constraint on typical dev machines, so it
// caps concurrency alongside CPU rather than CPU alone. Re-evaluated per run, since free
// memory changes; os.cpus().length is logical threads, not physical cores, so it's halved
// as a rough physical-core estimate rather than treated as raw parallel capacity.
const MEMORY_PER_FAST_WORKER_BYTES = 512 * 1024 * 1024;
const MAX_FAST_CONCURRENCY = 8;

// Detected, per-machine ceilings for the CPU/memory sliders — the actual bounds the UI
// clamps to, so a user genuinely cannot select an unsafe value. Physical-core estimate
// (not raw logical thread count) and total RAM minus a reserved slice for the OS/host,
// same reasoning VM software uses for its own resource sliders.
export function getHardwareLimits() {
  const cpuMax = Math.max(2, Math.ceil(os.cpus().length / 2));
  const totalMemMB = Math.round(os.totalmem() / (1024 * 1024));
  const memMaxMB = Math.max(512, totalMemMB - 2048);
  return { cpuMax, memMaxMB, totalMemMB, logicalCpus: os.cpus().length };
}

// Node's own V8 heap has a separate ceiling from system RAM (commonly ~4GB by default,
// crashed with exactly this "JavaScript heap out of memory" once before) — more system
// memory doesn't raise it. The CLI runs its companion in-process, so every concurrent
// worker's Lighthouse analysis (~150MB+ of live trace/LHR data while it's in flight) shares
// ONE heap with the rest of the app. Capped against it too, not just Chrome-process memory.
const NODE_HEAP_PER_WORKER_BYTES = 300 * 1024 * 1024;

function fastConcurrencyCap(pageCount, maxCores, maxMemoryMB) {
  const hw = getHardwareLimits();
  const cpuCap = Math.min(hw.cpuMax, maxCores || hw.cpuMax);
  const memBudgetBytes = Math.min((maxMemoryMB || hw.memMaxMB) * 1024 * 1024, os.freemem());
  const memCap = Math.max(1, Math.floor(memBudgetBytes / MEMORY_PER_FAST_WORKER_BYTES));
  const heapStats = v8.getHeapStatistics();
  const heapHeadroom = Math.max(0, heapStats.heap_size_limit - heapStats.used_heap_size);
  const heapCap = Math.max(1, Math.floor(heapHeadroom / NODE_HEAP_PER_WORKER_BYTES));
  return Math.min(cpuCap, memCap, heapCap, MAX_FAST_CONCURRENCY, pageCount);
}

mkdirSync(DATA_DIR, { recursive: true });

export function writePidFile(port = 3210) {
  try {
    writeFileSync(PID_FILE, JSON.stringify({
      pid: process.pid,
      title: process.title || 'scanforge-companion',
      startedAt: Date.now(),
      port,
    }, null, 2), 'utf8');
  } catch {}
}

export function cleanPidFile() {
  try {
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
  } catch {}
}

function normalizeSettings(value = {}) {
  const lighthouseMode = ['navigation', 'timespan', 'snapshot'].includes(value.lighthouseMode) ? value.lighthouseMode : 'navigation';
  const device = ['both', 'mobile', 'desktop'].includes(value.device) ? value.device : 'both';
  const processingMode = ['accurate', 'fast'].includes(value.processingMode) ? value.processingMode : 'accurate';
  const allowed = MODE_CATEGORIES[lighthouseMode] || CATEGORIES;
  const categories = [...new Set((Array.isArray(value.categories) ? value.categories : CATEGORIES).filter(category => allowed.includes(category)))];
  const hw = getHardwareLimits();
  const maxCores = Math.min(hw.cpuMax, Math.max(1, Number.isFinite(value.maxCores) ? Math.round(value.maxCores) : hw.cpuMax));
  const maxMemoryMB = Math.min(hw.memMaxMB, Math.max(512, Number.isFinite(value.maxMemoryMB) ? Math.round(value.maxMemoryMB) : hw.memMaxMB));
  return { lighthouseMode, device, processingMode, categories: categories.length ? categories : [...allowed], maxCores, maxMemoryMB };
}

function loadSharedSettings() {
  try {
    return normalizeSettings(JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')));
  } catch {
    return normalizeSettings();
  }
}

export function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function deviceState() {
  return { status: 'waiting', percent: 0, stage: 'Waiting', error: null };
}

function compileReportsFromDb(records) {
  return (records || []).map(record => {
    if (!record.ok) {
      return {
        ok: false,
        id: record.id,
        captureId: record.captureId,
        device: record.device,
        title: record.title,
        url: record.url,
        error: record.error || 'Audit failed.',
      };
    }
    return {
      ok: true,
      id: record.id,
      captureId: record.captureId,
      device: record.device,
      title: record.title,
      url: record.url,
      markdown: record.markdown || (record.data ? reportDataToMarkdown(record.data) : ''),
      data: record.data,
      scores: record.scores || {},
    };
  });
}

export async function closeChromeSilently(chrome) {
  if (!chrome) return;
  try {
    const res = await fetch(`http://127.0.0.1:${chrome.port}/json/version`).catch(() => null);
    if (res?.ok) {
      const data = await res.json().catch(() => null);
      if (data?.webSocketDebuggerUrl && typeof WebSocket !== 'undefined') {
        const ws = new WebSocket(data.webSocketDebuggerUrl);
        await new Promise((resolve) => {
          ws.onopen = () => {
            try { ws.send(JSON.stringify({ id: 1, method: 'Browser.close' })); } catch {}
            setTimeout(() => { try { ws.close(); } catch {} resolve(); }, 150);
          };
          ws.onerror = () => resolve();
          setTimeout(resolve, 300);
        });
      }
    }
  } catch {}
  if (chrome.pid) {
    try {
      process.kill(chrome.pid);
    } catch {}
  }
}

function withAuditTimeout(promise, onTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(async () => {
      await Promise.resolve(onTimeout?.()).catch(() => {});
      reject(new Error(`Lighthouse did not finish within ${Math.round(AUDIT_TIMEOUT_MS / 1000)} seconds and was stopped.`));
    }, AUDIT_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runLighthouse(pageUrl, device, mode, categories, chrome) {
  // logLevel 'silent' prevents Lighthouse from writing directly to stderr/stdout,
  // but internal log.events still fire so we can track progress in the TUI.
  const flags = { onlyCategories: categories, logLevel: 'silent', maxWaitForLoad: 60000 };
  const config = device === 'desktop' ? desktopConfig : undefined;
  if (mode === 'navigation') return lighthouse(pageUrl, { ...flags, port: chrome.port }, config);

  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}`, defaultViewport: null });
  const existingPages = await browser.pages();
  const page = existingPages[0] || await browser.newPage();
  try {
    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    if (mode === 'snapshot') return lighthouseSnapshot(page, { flags, config });
    const timespan = await startTimespan(page, { flags, config });
    await page.evaluate(async () => {
      const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      scrollTo({ top: max, behavior: 'instant' });
      await new Promise(resolve => setTimeout(resolve, 1500));
      scrollTo({ top: 0, behavior: 'instant' });
      await new Promise(resolve => setTimeout(resolve, 1500));
    });
    return timespan.endTimespan();
  } finally {
    // Keep browser alive across runs
  }
}

export class CompanionBus extends EventEmitter {
  constructor() {
    super();
    this.runs = new Map();
    this.sharedSettings = loadSharedSettings();
    this.latestReports = [];
    this._broadcastTimer = null;
  }

  getSettings() {
    return this.sharedSettings;
  }

  saveSettings(value) {
    this.sharedSettings = normalizeSettings(value);
    try {
      writeFileSync(SETTINGS_FILE, `${JSON.stringify(this.sharedSettings, null, 2)}\n`, 'utf8');
    } catch {}
    this.emit('settings', { settings: this.sharedSettings });
    return this.sharedSettings;
  }

  getStatus() {
    const base = {
      pid: process.pid,
      processTitle: process.title || 'scanforge-companion',
    };
    const activeRun = [...this.runs.values()].find(run => run.state === 'running');
    if (activeRun) {
      return {
        ...base,
        state: activeRun.cancelled ? 'stopping' : 'auditing',
        activeRunId: activeRun.id,
        run: this.publicRun(activeRun),
      };
    }
    const latestRun = [...this.runs.values()].sort((a, b) => b.startedAt - a.startedAt)[0];
    if (latestRun?.state === 'error') {
      return { ...base, state: 'error', activeRunId: null, error: latestRun.error || 'The last audit failed.' };
    }
    return { ...base, state: 'ready', activeRunId: null };
  }

  publicRun(run) {
    if (!run) return null;
    return {
      id: run.id,
      state: run.state,
      mode: run.mode,
      lighthouseMode: run.lighthouseMode,
      categories: run.categories,
      devices: run.devices,
      selectedPages: run.pages.length,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      pages: run.pages,
      reports: run.reports,
      error: run.error,
    };
  }

  broadcastStatus(immediate = false) {
    if (immediate) {
      if (this._broadcastTimer) {
        clearTimeout(this._broadcastTimer);
        this._broadcastTimer = null;
      }
      this.emit('status', { status: this.getStatus() });
      return;
    }
    if (this._broadcastTimer) return;
    this._broadcastTimer = setTimeout(() => {
      this._broadcastTimer = null;
      this.emit('status', { status: this.getStatus() });
    }, 100);
  }

  async stopActiveRuns() {
    const activeRuns = [...this.runs.values()].filter(run => run.state === 'running');
    for (const run of activeRuns) {
      run.cancelled = true;
      for (const child of run.children || []) child.send?.({ type: 'cancel' });
      await Promise.all([...(run.launchers || [])].map(chrome => closeChromeSilently(chrome)));
    }
    this.broadcastStatus(true);
    return activeRuns.length;
  }

  updateDevice(run, pageId, device, patch) {
    const page = run.pages.find(item => item.id === pageId);
    if (page) page[device] = { ...page[device], ...patch };
    this.broadcastStatus(false);
  }

  createRun(payload) {
    const options = payload.options || {};
    const lighthouseMode = ['navigation', 'timespan', 'snapshot'].includes(options.mode)
      ? options.mode
      : this.sharedSettings.lighthouseMode || 'navigation';
    const categories = [...new Set((options.categories || this.sharedSettings.categories || CATEGORIES).filter(c => (MODE_CATEGORIES[lighthouseMode] || CATEGORIES).includes(c)))];
    if (!categories.length) throw new Error(`Select at least one category supported by ${lighthouseMode} mode.`);

    const deviceOption = options.device || this.sharedSettings.device || 'both';
    const devices = deviceOption === 'mobile' ? ['mobile'] : deviceOption === 'desktop' ? ['desktop'] : DEVICES;
    const maxCores = options.maxCores || this.sharedSettings.maxCores;
    const maxMemoryMB = options.maxMemoryMB || this.sharedSettings.maxMemoryMB;

    const seenUrls = new Set();
    const pages = [];
    for (const page of (Array.isArray(payload.pages) ? payload.pages : [])) {
      if (!page?.url || typeof page.url !== 'string') continue;
      const normalized = normalizeUrl(page.url);
      if (!/^https?:\/\//.test(normalized) || normalized.length > 2048 || seenUrls.has(normalized)) continue;
      seenUrls.add(normalized);
      pages.push({
        id: page.id || uid(),
        title: String(page.title || normalized).slice(0, 500),
        url: normalized,
        status: 'queued',
        mobile: devices.includes('mobile') ? deviceState() : { ...deviceState(), status: 'skipped', stage: 'Not selected' },
        desktop: devices.includes('desktop') ? deviceState() : { ...deviceState(), status: 'skipped', stage: 'Not selected' },
      });
    }

    if (!pages.length) throw new Error('Select at least one valid page to audit.');
    if (pages.length > 25) throw new Error('A run may contain at most 25 pages.');
    for (const [id, oldRun] of this.runs) if (this.runs.size >= 20 && oldRun.state !== 'running') this.runs.delete(id);
    if (this.runs.size >= 20) throw new Error('Too many retained audit runs. Wait for an active run to finish.');

    const source = payload.source === 'ext' ? 'ext' : 'tui';
    const db = new AuditDb(source);

    const run = {
      id: uid(),
      source,
      db,
      state: 'running',
      mode: payload.mode || this.sharedSettings.processingMode || 'accurate',
      pages,
      reports: [],
      categories,
      devices,
      lighthouseMode,
      maxCores,
      maxMemoryMB,
      startedAt: Date.now(),
      finishedAt: null,
      error: null,
      cancelled: false,
      launchers: new Set(),
      children: new Set(),
    };

    this.runs.set(run.id, run);
    this.broadcastStatus();
    this.executeRun(run);
    return run;
  }

  async executeRun(run) {
    const activeTasks = new Set();
    let completedSteps = 0;

    const onStatus = ([, message]) => {
      if (typeof message !== 'string') return;
      let percent = 8;
      if (message.startsWith('Navigating')) percent = 18;
      else if (message.startsWith('Getting artifact:')) percent = 30;
      else if (message.startsWith('Analyzing')) percent = 68;
      else if (message.startsWith('Auditing:')) percent = Math.min(96, 72 + completedSteps);
      for (const task of activeTasks) {
        this.updateDevice(run, task.pageId, task.device, { stage: message, percent: Math.max(task.percent || 0, percent) });
        task.percent = percent;
      }
    };

    const onStatusEnd = ([, message]) => {
      if (typeof message === 'string' && (message.startsWith('Getting artifact:') || message.startsWith('Auditing:'))) {
        completedSteps += 1;
      }
    };

    // Suppress console output during audit to prevent TUI disruption.
    // Lighthouse and chrome-launcher write directly to console.log/warn/error
    // which breaks the Ink rendering.  We capture and silence them here.
    const _origLog = console.log;
    const _origWarn = console.warn;
    const _origErr = console.error;
    const _capturedLogs = [];

    const suppressConsole = () => {
      const noop = (...args) => _capturedLogs.push(args.join(' '));
      console.log = noop;
      console.warn = noop;
      console.error = noop;
    };

    const restoreConsole = () => {
      console.log = _origLog;
      console.warn = _origWarn;
      console.error = _origErr;
    };

    log.events.on('status', onStatus);
    log.events.on('statusEnd', onStatusEnd);

    let cursor = 0;
    const worker = async () => {
      suppressConsole();
      const chrome = await chromeLauncher.launch({
        chromeFlags: CHROME_FLAGS,
        logLevel: 'silent',
      });
      run.launchers.add(chrome);

      try {
        while (!run.cancelled) {
          const page = run.pages[cursor++];
          if (!page) return;

          for (const device of run.devices) {
            if (run.cancelled) break;
            page.status = 'running';
            const task = { pageId: page.id, device, percent: 2 };
            activeTasks.add(task);
            this.updateDevice(run, page.id, device, { status: 'running', percent: 2, stage: `Starting ${device}` });

            const auditStartedAt = Date.now();
            try {
              await assertSafeAuditUrl(page.url);
              const result = await withAuditTimeout(
                runLighthouse(page.url, device, run.lighthouseMode, run.categories, chrome),
                () => closeChromeSilently(chrome)
              );
              if (!result) throw new Error('Lighthouse returned no result.');

              const scores = Object.fromEntries(run.categories.map(k => [k, result.lhr.categories[k]?.score ?? null]));
              const data = lhrToReportData(result.lhr, { device, title: page.title });
              data.environment.duration = `${((Date.now() - auditStartedAt) / 1000).toFixed(1)} s`;

              // Release 150MB+ raw TraceEngine/LHR memory immediately from RAM
              result.lhr = null;
              forceGC();

              const record = {
                ok: true,
                id: `${page.id}-${device}`,
                captureId: page.id,
                device,
                title: page.title,
                url: page.url,
                data,
                scores,
              };
              run.db?.append(record);
              this.updateDevice(run, page.id, device, { status: 'complete', percent: 100, stage: 'Complete' });
            } catch (err) {
              const errMsg = run.cancelled ? 'Stopped by user.' : err.message;
              const errRecord = {
                ok: false,
                id: `${page.id}-${device}`,
                captureId: page.id,
                device,
                title: page.title,
                url: page.url,
                error: errMsg,
              };
              run.db?.append(errRecord);
              this.updateDevice(run, page.id, device, {
                status: run.cancelled ? 'stopped' : 'failed',
                percent: 100,
                stage: run.cancelled ? 'Stopped' : 'Failed',
                error: errMsg,
              });
            } finally {
              activeTasks.delete(task);
            }
          }
          page.status = run.cancelled ? 'stopped' : 'complete';
        }
      } finally {
        run.launchers.delete(chrome);
        await closeChromeSilently(chrome);
        restoreConsole();
      }
    };

    try {
      // ═════════════════════════════════════════════════════════════════
      // PHASE 1: PURE AUDIT EXECUTION (Streams raw data directly to .db)
      // ═════════════════════════════════════════════════════════════════
      const concurrency = run.mode === 'fast' ? fastConcurrencyCap(run.pages.length, run.maxCores, run.maxMemoryMB) : 1;
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      run.state = run.cancelled ? 'stopped' : 'complete';

      // ═════════════════════════════════════════════════════════════════
      // PHASE 2: COMPILATION & REPORT GENERATION (From .db data)
      // ═════════════════════════════════════════════════════════════════
      if (!run.cancelled) {
        let records = run.db ? run.db.readAll() : [];
        const compiledReports = compileReportsFromDb(records);
        // records and compiledReports hold largely the same data twice over; release the
        // raw copy immediately instead of leaving both alive through report generation.
        records = null;
        run.reports = compiledReports;
        if (compiledReports.length) {
          const aggregatedMarkdown = reportsToCombinedMarkdown(compiledReports);
          compiledReports.forEach(r => { r.combinedMarkdown = aggregatedMarkdown; });
          this.latestReports = compiledReports;
        }
        // Phase 1's per-audit forceGC() calls don't cover this compilation phase — on a
        // resource-constrained machine with a correspondingly smaller heap ceiling, this was
        // the actual point of failure, not the audits themselves.
        forceGC();
      }
    } catch (err) {
      run.state = run.cancelled ? 'stopped' : 'error';
      run.error = err.message;
    } finally {
      try {
        run.db?.clean();
      } catch {}
      restoreConsole();
      log.events.removeListener('status', onStatus);
      log.events.removeListener('statusEnd', onStatusEnd);
      run.finishedAt = Date.now();
      for (const page of run.pages) {
        if (page.status === 'queued') page.status = run.cancelled ? 'stopped' : page.status;
      }
      this.broadcastStatus();
      this.emit('complete', { run, reports: run.reports });
    }
  }
}

export const globalCompanionBus = new CompanionBus();
