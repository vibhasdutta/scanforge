/**
 * TaskBlock — Tear-free, windowed multi-target audit progress runner.
 *
 * Implements Priority-Based Virtual Windowing:
 * 1. Global Batch Progress: Overall completion percentage across all pages & devices.
 * 2. Active Task Pinning: Shows live animated dual-device progress bars ONLY for currently active page(s).
 * 3. Compact Status Ticker: Summarizes completed, running, and queued URLs without overflowing terminal height.
 * 4. Bounded Viewport: how many page panels are shown scales with available terminal rows
 *    (via maxRows) and is capped at 6 regardless of how many pages are queued — so a wide
 *    terminal with high Fast-mode concurrency actually shows more of what's running at
 *    once, instead of always hard-capping at 2 regardless of real concurrency or space.
 */
import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

function ProgressBar({ percent = 0, width = 24, color = '#ffb454', emptyColor = 'gray' }) {
  const clamped = Math.max(0, Math.min(1, percent));
  const filledCount = Math.round(clamped * width);
  const emptyCount = Math.max(0, width - filledCount);
  return (
    <Text color={color}>
      {'█'.repeat(filledCount)}
      <Text color={emptyColor}>{'░'.repeat(emptyCount)}</Text>
    </Text>
  );
}

function computeBatchStats(pages = []) {
  let totalAudits = 0;
  let completedAudits = 0;
  let runningCount = 0;
  let queuedCount = 0;
  let completedCount = 0;
  let failedCount = 0;

  for (const page of pages) {
    if (page.status === 'running') runningCount++;
    else if (page.status === 'complete') completedCount++;
    else if (page.status === 'failed' || page.status === 'stopped') failedCount++;
    else queuedCount++;

    for (const dev of [page.mobile, page.desktop]) {
      if (dev && dev.status !== 'skipped') {
        totalAudits++;
        if (dev.status === 'complete') completedAudits++;
        else if (dev.status === 'running') completedAudits += (dev.percent || 0) / 100;
      }
    }
  }

  const overallPercent = totalAudits > 0 ? Math.round((completedAudits / totalAudits) * 100) : 0;
  return { totalAudits, completedAudits, overallPercent, runningCount, queuedCount, completedCount, failedCount };
}

export function TaskBlock({ run, maxWidth, maxRows }) {
  if (!run) return null;

  const w = maxWidth || (process.stdout.columns || 100) - 2;
  const innerW = Math.max(30, w - 4);
  const barW = Math.max(12, Math.min(30, Math.floor(innerW * 0.4)));

  const pages = run.pages || [];
  const stats = computeBatchStats(pages);
  const isStopping = run.cancelled;

  // Each page panel is ~3 rows (title + mobile + desktop); fixed chrome around it (header,
  // progress bar, divider, status ticker, border, input box below) eats roughly 16 rows
  // regardless of how many panels are shown.
  const rowBudget = Math.max(3, (maxRows || 30) - 16);
  const maxVisiblePages = Math.max(1, Math.min(6, Math.floor(rowBudget / 3)));

  // Windowing: pin active (running) pages first, up to the space/concurrency-based cap.
  // If there's room left over, peek at what's queued next rather than leaving it blank.
  const activePages = pages.filter(p => p.status === 'running');
  const queuedPages = pages.filter(p => p.status === 'queued');
  const visiblePages = activePages.length > 0
    ? [...activePages.slice(0, maxVisiblePages), ...queuedPages.slice(0, Math.max(0, maxVisiblePages - activePages.length))]
    : queuedPages.slice(0, 1);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={isStopping ? 'red' : 'yellow'}
      paddingX={1}
      marginY={1}
      width={w}
    >
      {/* ── 1. Batch Header & Overall Progress Bar ───────────── */}
      <Box justifyContent="space-between" width={innerW}>
        <Box gap={1}>
          <Text color={isStopping ? 'red' : 'yellow'}>
            <Spinner type="dots" />
          </Text>
          <Text bold color={isStopping ? 'red' : 'yellow'}>
            {isStopping ? 'Stopping Audits...' : `🚀 Lighthouse Batch Audit (${stats.overallPercent}%)`}
          </Text>
        </Box>
        <Text color="#ffb454" bold>
          {stats.completedCount}/{pages.length} URLs • {run.devices?.join(' + ') || 'both'}
        </Text>
      </Box>

      {/* Global Batch Progress Bar */}
      <Box marginY={0} width={innerW} justifyContent="space-between">
        <ProgressBar percent={stats.overallPercent / 100} width={innerW - 8} color={stats.overallPercent === 100 ? 'green' : 'yellow'} />
        <Text color={stats.overallPercent === 100 ? 'green' : 'yellow'} bold>{stats.overallPercent}%</Text>
      </Box>

      <Text color="gray">{'─'.repeat(Math.min(innerW, 60))}</Text>

      {/* ── 2. Pinned Active Task(s) OR Compilation Bar ────── */}
      {stats.completedCount === pages.length ? (
        <Box flexDirection="column" marginY={0} width={innerW}>
          <Box justifyContent="space-between" width={innerW}>
            <Box gap={1}>
              <Text color="green"><Spinner type="dots" /></Text>
              <Text bold color="green">⚡ Compiling Report from DB…</Text>
            </Box>
            <Text color="green" dimColor>[Finalizing]</Text>
          </Box>
          <Box marginY={0} width={innerW} justifyContent="space-between">
            <ProgressBar percent={1} width={innerW - 8} color="green" />
            <Text color="green" bold>100%</Text>
          </Box>
        </Box>
      ) : (
        visiblePages.map((page, idx) => {
          const pageIdx = pages.findIndex(p => p.id === page.id);
          const isRunning = page.status === 'running';
          return (
            <Box key={page.id || idx} flexDirection="column" marginY={0} width={innerW}>
              {/* Active / peeked-ahead URL name */}
              <Box width={innerW} justifyContent="space-between">
                <Box gap={1}>
                  <Text color={isRunning ? 'yellow' : 'gray'}>{isRunning ? '⠋' : '○'}</Text>
                  <Text bold={isRunning} color={isRunning ? 'white' : 'gray'} wrap="truncate-end">
                    [{pageIdx + 1}/{pages.length}] {page.title || page.url}
                  </Text>
                </Box>
                <Text color={isRunning ? 'magenta' : 'gray'}>{isRunning ? '[Auditing]' : '[Queued]'}</Text>
              </Box>

              {/* Mobile Device Bar */}
              {page.mobile && page.mobile.status !== 'skipped' && (
                <Box gap={1} paddingLeft={2} width={innerW - 2} justifyContent="space-between">
                  <Box gap={1} flexShrink={1}>
                    <Text color="magenta">📱 Mobile :</Text>
                    <ProgressBar percent={(page.mobile.percent || 0) / 100} width={barW} color="magenta" />
                  </Box>
                  <Text color="gray" wrap="truncate-end">
                    {page.mobile.percent || 0}% {page.mobile.stage || 'Waiting'}
                  </Text>
                </Box>
              )}

              {/* Desktop Device Bar */}
              {page.desktop && page.desktop.status !== 'skipped' && (
                <Box gap={1} paddingLeft={2} width={innerW - 2} justifyContent="space-between">
                  <Box gap={1} flexShrink={1}>
                    <Text color="#ffb454">💻 Desktop:</Text>
                    <ProgressBar percent={(page.desktop.percent || 0) / 100} width={barW} color="#ffb454" />
                  </Box>
                  <Text color="gray" wrap="truncate-end">
                    {page.desktop.percent || 0}% {page.desktop.stage || 'Waiting'}
                  </Text>
                </Box>
              )}
            </Box>
          );
        })
      )}

      {/* ── 3. Compact Status Ticker (Queue Summary) ─────────── */}
      <Box marginTop={1} justifyContent="space-between" width={innerW}>
        <Box gap={2}>
          {stats.completedCount > 0 && (
            <Text color="green">✔ {stats.completedCount} done</Text>
          )}
          {stats.runningCount > 0 && (
            <Text color="yellow">⠋ {stats.runningCount} active</Text>
          )}
          {stats.queuedCount > 0 && (
            <Text color="gray">○ {stats.queuedCount} queued</Text>
          )}
          {stats.failedCount > 0 && (
            <Text color="red">✖ {stats.failedCount} failed</Text>
          )}
        </Box>
        <Text color="gray">Type <Text color="red">/stop</Text> to cancel</Text>
      </Box>
    </Box>
  );
}
