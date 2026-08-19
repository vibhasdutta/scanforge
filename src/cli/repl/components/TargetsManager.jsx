/**
 * TargetsManager — Interactive checkbox selection and queue manager for targets.
 */
import React from 'react';
import { Box, Text } from 'ink';

export function TargetsManager({ targets = [], cursor = 0, maxWidth }) {
  const w = maxWidth || (process.stdout.columns || 100) - 2;
  const innerW = Math.max(4, w - 4);
  const selectedCount = targets.filter(t => t.selected).length;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="#fc6200"
      paddingX={1}
      marginY={1}
      width={w}
    >
      {/* Header */}
      <Box justifyContent="space-between" marginBottom={1} width={innerW}>
        <Box gap={1}>
          <Text bold color="#fc6200">🎯 Target URLs Manager</Text>
          <Text color="gray">({selectedCount}/{targets.length} selected)</Text>
        </Box>
        <Text color="gray">
          Type a URL to add • [Space] Toggle • [d] Delete • [Enter] Audit • [Esc] Close
        </Text>
      </Box>

      {/* Target Items */}
      {targets.length === 0 ? (
        <Box marginY={1} width={innerW}>
          <Text color="gray">No targets in queue. Type one below (or "url1, url2" for several) and press </Text>
          <Text color="yellow">Enter</Text>
          <Text color="gray"> to add it.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" gap={0} width={innerW}>
          {targets.map((t, idx) => {
            const isHighlighted = idx === cursor;
            return (
              <Box key={t.id || idx} gap={1} width={innerW}>
                {/* Cursor */}
                <Text color={isHighlighted ? 'yellow' : 'gray'} bold={isHighlighted}>
                  {isHighlighted ? '❯' : ' '}
                </Text>
                {/* Checkbox */}
                <Text color={t.selected ? 'green' : 'gray'} bold={t.selected}>
                  [{t.selected ? '✓' : ' '}]
                </Text>
                {/* Number */}
                <Text color="gray">{idx + 1}.</Text>
                {/* URL */}
                <Text
                  color={isHighlighted ? 'white' : t.selected ? 'white' : 'gray'}
                  bold={isHighlighted || t.selected}
                  wrap="truncate-end"
                >
                  {t.url}
                </Text>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Footer Controls summary */}
      <Box marginTop={1} width={innerW} justifyContent="space-between">
        <Text color="gray">
          [↑/↓] Navigate • [Space] Check • [d] Delete • [c] Clear Queue
        </Text>
        <Text color="yellow" bold>
          {selectedCount} target{selectedCount === 1 ? '' : 's'} ready to audit
        </Text>
      </Box>
    </Box>
  );
}
