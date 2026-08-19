/**
 * CommandPaletteDropdown — Floating suggestions overlay.
 */
import React from 'react';
import { Box, Text } from 'ink';

const CATEGORY_COLORS = {
  Audit: 'magenta',
  Targets: '#ffb454',
  Settings: 'blue',
  Reports: 'green',
  Status: 'yellow',
  Help: 'gray',
  Session: 'red',
};

export function CommandPaletteDropdown({ filteredCommands, highlightedIndex, scrollOffset, maxVisible, maxWidth }) {
  if (!filteredCommands || filteredCommands.length === 0) return null;

  const total = filteredCommands.length;
  const visibleStart = scrollOffset;
  const visibleEnd = Math.min(visibleStart + maxVisible, total);
  const visibleItems = filteredCommands.slice(visibleStart, visibleEnd);
  const hasAbove = visibleStart > 0;
  const hasBelow = visibleEnd < total;

  const w = maxWidth || (process.stdout.columns || 100) - 2;
  const innerW = Math.max(4, w - 4);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#fc6200"
      paddingX={1}
      marginY={0}
      width={w}
    >
      {/* Header */}
      <Box justifyContent="space-between" marginBottom={0} width={innerW}>
        <Box gap={1}>
          <Text color="#fc6200" bold>⚡ Commands</Text>
          <Text color="gray">({total} match{total === 1 ? '' : 'es'})</Text>
        </Box>
        <Text color="gray">
          [↑↓] Navigate • [Tab/Enter] Select • [Esc] Close
        </Text>
      </Box>

      {/* Scroll-up indicator */}
      {hasAbove && (
        <Box paddingLeft={1} width={innerW}>
          <Text color="gray">↑ {visibleStart} more above</Text>
        </Box>
      )}

      {/* Visible command items */}
      {visibleItems.map((cmd, relIdx) => {
        const absIdx = visibleStart + relIdx;
        const isSelected = absIdx === highlightedIndex;
        const catColor = CATEGORY_COLORS[cmd.category] || 'gray';

        return (
          <Box
            key={cmd.name}
            gap={1}
            paddingLeft={1}
            justifyContent="space-between"
            width={innerW}
          >
            <Box gap={1} flexShrink={1}>
              <Text color={isSelected ? 'yellow' : 'gray'} bold={isSelected}>
                {isSelected ? '❯' : ' '}
              </Text>
              <Text color={isSelected ? 'white' : 'yellow'} bold={isSelected}>
                {cmd.name}
              </Text>
              {cmd.args ? (
                <Text color={isSelected ? '#ffb454' : 'gray'}>
                  {cmd.args}
                </Text>
              ) : null}
              <Text color={isSelected ? 'white' : 'gray'} wrap="truncate-end">
                — {cmd.description}
              </Text>
            </Box>
            <Text color={catColor}>
              [{cmd.category}]
            </Text>
          </Box>
        );
      })}

      {/* Scroll-down indicator */}
      {hasBelow && (
        <Box paddingLeft={1} width={innerW}>
          <Text color="gray">↓ {total - visibleEnd} more below</Text>
        </Box>
      )}
    </Box>
  );
}
