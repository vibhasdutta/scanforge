/**
 * ReportInspector — Interactive full-screen / navigable report browser for ScanForge.
 */
import React from 'react';
import { Box, Text } from 'ink';

function scoreColor(score) {
  if (score == null) return 'gray';
  if (score >= 0.9) return 'green';
  if (score >= 0.5) return 'yellow';
  return 'red';
}

function scoreBadge(score) {
  if (score == null) return '—';
  const n = Math.round(score * 100);
  if (n >= 90) return `🟢 ${n}%`;
  if (n >= 50) return `🟡 ${n}%`;
  return `🔴 ${n}%`;
}

export function ReportInspector({ reports = [], cursor = 0, isExpanded = false, maxWidth }) {
  if (!reports || !reports.length) return null;

  const w = maxWidth || (process.stdout.columns || 100) - 2;
  const innerW = Math.max(4, w - 4);
  const selectedReport = reports[cursor] || reports[0];
  const data = selectedReport?.data;
  const selectedCount = reports.filter(r => r.selected).length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1} marginY={1} width={w}>
      {/* Header */}
      <Box justifyContent="space-between" marginBottom={1} width={innerW}>
        <Box gap={1}>
          <Text bold color="green">📊 Audit Report Explorer</Text>
          <Text color="gray">({selectedCount}/{reports.length} selected)</Text>
        </Box>
        <Text color="gray">
          [↑/↓] Move • [Space] Select • [a] All • [e] Expand • [Enter] Save • [Esc/q] Close
        </Text>
      </Box>

      {/* Report Tabs / List */}
      <Box flexDirection="column" gap={0} marginBottom={1} width={innerW}>
        {reports.map((r, idx) => {
          const isCurrent = idx === cursor;
          const rData = r.data;
          const perfScore = rData?.categories?.find(c => c.id === 'performance')?.score;
          return (
            <Box key={r.id || idx} gap={1} width={innerW}>
              <Text color={isCurrent ? 'yellow' : 'gray'} bold={isCurrent}>
                {isCurrent ? '❯' : ' '}
              </Text>
              <Text color={r.selected ? 'green' : 'gray'} bold={r.selected}>
                [{r.selected ? '✓' : ' '}]
              </Text>
              <Text color="gray">{idx + 1}.</Text>
              <Text color={isCurrent ? 'white' : 'gray'} bold={isCurrent} wrap="truncate-end">
                {r.title || r.url}
              </Text>
              <Text color="magenta">({r.device})</Text>
              {perfScore != null && (
                <Text color={scoreColor(perfScore)}>
                  Perf: {scoreBadge(perfScore)}
                </Text>
              )}
            </Box>
          );
        })}
      </Box>

      {/* Selected Report Details Panel */}
      {selectedReport && data && (
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} width={innerW}>
          {/* Active Title */}
          <Box justifyContent="space-between" width={innerW - 4}>
            <Box gap={1}>
              <Text bold color="white">{selectedReport.title || selectedReport.url}</Text>
              <Text color="magenta">({selectedReport.device})</Text>
            </Box>
            {data.environment?.duration && (
              <Text color="gray">{data.environment.duration}</Text>
            )}
          </Box>

          {/* Scores Row */}
          <Box gap={2} marginY={1} flexWrap="wrap" width={innerW - 4}>
            {data.categories?.map(cat => (
              <Text key={cat.id} color={scoreColor(cat.score)}>
                {cat.title}: <Text bold>{scoreBadge(cat.score)}</Text>
              </Text>
            ))}
          </Box>

          {/* Core Web Vitals */}
          {data.metrics && data.metrics.length > 0 && (
            <Box gap={2} marginBottom={1} flexWrap="wrap" width={innerW - 4}>
              {data.metrics.map(m => (
                <Text key={m.id} color="gray">
                  {m.label}: <Text color="white" bold>{m.value}</Text>
                </Text>
              ))}
            </Box>
          )}

          {/* Recommendations / Findings */}
          {data.findings && data.findings.length > 0 && (
            <Box flexDirection="column" width={innerW - 4}>
              <Text color="yellow" bold>
                {isExpanded ? 'All Findings & Recommendations:' : 'Top Recommendations (Press [Space] for full list):'}
              </Text>
              {(isExpanded ? data.findings : data.findings.slice(0, 4)).map((f, i) => (
                <Box key={i} paddingLeft={1} width={innerW - 5}>
                  <Text color={f.severity === 'Fix' ? 'red' : 'yellow'} bold>
                    [{f.severity}]{' '}
                  </Text>
                  <Text color="white" wrap="truncate-end">
                    {f.title}{f.displayValue ? ` — ${f.displayValue}` : ''}
                  </Text>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* Footer Controls */}
      <Box marginTop={1} width={innerW} justifyContent="space-between">
        <Text color="gray">
          [Enter] Save selected as one combined report • [/clearaudit] Reset session
        </Text>
        <Text color="green" bold>
          {isExpanded ? 'Expanded View' : 'Compact View'}
        </Text>
      </Box>
    </Box>
  );
}
