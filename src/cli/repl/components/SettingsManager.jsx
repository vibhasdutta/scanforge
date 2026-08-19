/**
 * SettingsManager — Interactive settings panel for /settings.
 * Radio groups (mode, device, processing) + a checkbox group (categories),
 * flattened into one navigable list, matching TargetsManager's keyboard model.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { getHardwareLimits } from '../../../companion/companion-bus.js';

// agentic-browsing's supportedModes per Lighthouse itself is ['navigation', 'snapshot'] — not timespan.
const MODE_CATEGORIES = {
  navigation: ['performance', 'accessibility', 'best-practices', 'seo', 'agentic-browsing'],
  timespan: ['performance', 'best-practices'],
  snapshot: ['accessibility', 'best-practices', 'seo', 'agentic-browsing'],
};

const MODE_OPTIONS = [
  ['navigation', 'Navigation', 'Measure a fresh page load'],
  ['timespan', 'Timespan', 'Measure an activity window'],
  ['snapshot', 'Snapshot', 'Inspect the loaded state'],
];
const DEVICE_OPTIONS = [
  ['both', 'Mobile + Desktop', 'One combined report'],
  ['mobile', 'Mobile only', 'Emulated mobile conditions'],
  ['desktop', 'Desktop only', 'Desktop viewport and network'],
];
const PROCESSING_OPTIONS = [
  ['accurate', 'Accurate', 'One page at a time'],
  ['fast', 'Fast', 'Concurrent, scaled to CPU/memory'],
];
const CATEGORY_OPTIONS = [
  ['performance', 'Performance'],
  ['accessibility', 'Accessibility'],
  ['best-practices', 'Best practices'],
  ['seo', 'SEO'],
  ['agentic-browsing', 'Agentic browsing'],
];

// Builds the flattened row list (headers + selectable rows) rendered top to bottom.
// Shared by the component (rendering) and AgentRepl (keyboard navigation) so both
// always agree on what row index N actually is.
export function buildSettingsRows(settings) {
  const allowed = MODE_CATEGORIES[settings.lighthouseMode] || MODE_CATEGORIES.navigation;
  const rows = [];
  rows.push({ type: 'header', label: 'Lighthouse mode' });
  for (const [value, label, hint] of MODE_OPTIONS) {
    rows.push({ type: 'radio', group: 'lighthouseMode', value, label, hint, selected: settings.lighthouseMode === value });
  }
  rows.push({ type: 'header', label: 'Device' });
  for (const [value, label, hint] of DEVICE_OPTIONS) {
    rows.push({ type: 'radio', group: 'device', value, label, hint, selected: settings.device === value });
  }
  rows.push({ type: 'header', label: 'Page processing' });
  for (const [value, label, hint] of PROCESSING_OPTIONS) {
    rows.push({ type: 'radio', group: 'processingMode', value, label, hint, selected: settings.processingMode === value });
  }
  rows.push({ type: 'header', label: 'Categories' });
  for (const [value, label] of CATEGORY_OPTIONS) {
    const supported = allowed.includes(value);
    rows.push({ type: 'checkbox', group: 'categories', value, label, selected: !!settings.categories?.includes(value), disabled: !supported });
  }

  const hw = getHardwareLimits();
  rows.push({ type: 'header', label: `Resource limits (Fast mode) — ${(hw.totalMemMB / 1024).toFixed(1)} GB RAM` });
  rows.push({
    type: 'slider', group: 'maxCores', label: 'CPU cores', unit: '',
    min: 1, max: hw.cpuMax, step: 1, value: Math.min(hw.cpuMax, settings.maxCores ?? hw.cpuMax),
    hint: `max ${hw.cpuMax} physical — ${hw.logicalCpus} logical threads detected, but hyperthreading doesn't add real capacity for this`,
  });
  rows.push({
    type: 'slider', group: 'maxMemoryMB', label: 'Memory', unit: 'MB',
    min: 512, max: hw.memMaxMB, step: 256, value: Math.min(hw.memMaxMB, settings.maxMemoryMB ?? hw.memMaxMB),
    hint: `max ${(hw.memMaxMB / 1024).toFixed(1)} GB of ${(hw.totalMemMB / 1024).toFixed(1)} GB total — reserves headroom for your OS`,
  });
  return rows;
}

// Adjusts the highlighted slider row by one step in the given direction (-1 or 1), clamped.
export function adjustSlider(settings, row, direction) {
  if (!row || row.type !== 'slider') return settings;
  const next = Math.max(row.min, Math.min(row.max, row.value + direction * row.step));
  if (next === row.value) return settings;
  return { ...settings, [row.group]: next };
}

// Applies selecting/toggling one row, returning the next settings object.
// Radio rows replace their group's value; picking a new lighthouseMode also drops
// any now-unsupported categories (mirrors the server's own normalizeSettings safety net).
export function applySettingsSelection(settings, row) {
  if (!row || row.type === 'header') return settings;
  if (row.type === 'radio') {
    const next = { ...settings, [row.group]: row.value };
    if (row.group === 'lighthouseMode') {
      const allowed = MODE_CATEGORIES[row.value] || MODE_CATEGORIES.navigation;
      const kept = (settings.categories || []).filter(c => allowed.includes(c));
      next.categories = kept.length ? kept : [...allowed];
    }
    return next;
  }
  if (row.type === 'checkbox') {
    if (row.disabled) return settings;
    const has = (settings.categories || []).includes(row.value);
    const nextCategories = has ? settings.categories.filter(c => c !== row.value) : [...(settings.categories || []), row.value];
    if (!nextCategories.length) return settings; // never allow zero categories
    return { ...settings, categories: nextCategories };
  }
  return settings;
}

export function SettingsManager({ settings, cursor = 0, maxWidth, warning = '' }) {
  const w = maxWidth || (process.stdout.columns || 100) - 2;
  const innerW = Math.max(30, w - 4);
  const rows = buildSettingsRows(settings);
  const selectable = rows.filter(r => r.type !== 'header');
  const highlighted = selectable[cursor];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#fc6200" paddingX={1} marginY={1} width={w}>
      <Box justifyContent="space-between" marginBottom={1} width={innerW}>
        <Text bold color="#fc6200">⚙ Audit Settings</Text>
        <Text color="gray">
          [↑/↓] Move • [Space/Enter] Select • [←/→] Adjust slider • [Esc] Close
        </Text>
      </Box>

      <Box flexDirection="column" width={innerW}>
        {rows.map((row, idx) => {
          if (row.type === 'header') {
            return (
              <Box key={`h-${idx}`} marginTop={idx === 0 ? 0 : 1} width={innerW}>
                <Text color="#ffb454" bold>{row.label}</Text>
              </Box>
            );
          }
          if (row.type === 'slider') {
            const isHighlighted = row === highlighted;
            const barWidth = 20;
            const frac = (row.value - row.min) / (row.max - row.min || 1);
            const filled = Math.round(frac * barWidth);
            const displayValue = row.unit === 'MB' ? `${(row.value / 1024).toFixed(1)} GB` : `${row.value}`;
            return (
              <Box key={row.group} flexDirection="column" width={innerW}>
                <Box gap={1} width={innerW}>
                  <Text color={isHighlighted ? 'yellow' : 'gray'} bold={isHighlighted}>{isHighlighted ? '❯' : ' '}</Text>
                  <Text color={isHighlighted ? 'white' : 'gray'} bold={isHighlighted}>{row.label}</Text>
                  <Text color={isHighlighted ? '#fc6200' : 'gray'}>
                    {'█'.repeat(filled)}<Text color="gray">{'░'.repeat(barWidth - filled)}</Text>
                  </Text>
                  <Text color="#ffb454" bold>{displayValue}</Text>
                  {isHighlighted && <Text color="gray">[←/→] Adjust</Text>}
                </Box>
                {row.hint && (
                  <Box paddingLeft={2} width={innerW}>
                    <Text color="gray" wrap="truncate-end">{row.hint}</Text>
                  </Box>
                )}
              </Box>
            );
          }
          const isHighlighted = row === highlighted;
          const isRadio = row.type === 'radio';
          const markColor = row.disabled ? 'gray' : row.selected ? 'green' : isHighlighted ? 'white' : 'gray';
          return (
            <Box key={`${row.group}-${row.value}`} gap={1} width={innerW}>
              <Text color={isHighlighted ? 'yellow' : 'gray'} bold={isHighlighted}>{isHighlighted ? '❯' : ' '}</Text>
              <Text color={markColor} bold={row.selected}>{isRadio ? (row.selected ? '(●)' : '( )') : `[${row.selected ? '✓' : ' '}]`}</Text>
              <Text
                color={row.disabled ? 'gray' : isHighlighted ? 'white' : row.selected ? 'white' : 'gray'}
                bold={isHighlighted}
              >
                {row.label}
              </Text>
              {row.hint && <Text color="gray">{row.hint}</Text>}
              {row.disabled && <Text color="gray">(not available in this mode)</Text>}
            </Box>
          );
        })}
      </Box>

      <Box marginTop={1} width={innerW} justifyContent="space-between">
        {warning ? (
          <Text color="#ff776d" bold>{warning}</Text>
        ) : (
          <Text color="gray">Changes apply immediately and sync with the extension.</Text>
        )}
        <Text color="#ffb454" bold>{settings.processingMode === 'fast' ? 'Fast' : 'Accurate'} • {settings.categories?.length || 0} categories</Text>
      </Box>
    </Box>
  );
}
