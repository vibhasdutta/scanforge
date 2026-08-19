/**
 * HelpCard — Clean, structured slash commands cheat sheet.
 */
import React from 'react';
import { Box, Text } from 'ink';
import { SLASH_COMMANDS } from '../SlashCommands.js';

const CATEGORY_COLORS = {
  Audit: 'magenta',
  Targets: '#ffb454',
  Settings: 'blue',
  Reports: 'green',
  Status: 'yellow',
  Help: 'gray',
  Session: 'red',
};

export function HelpCard({ maxWidth }) {
  const w = maxWidth || (process.stdout.columns || 100) - 2;
  const innerW = Math.max(4, w - 4);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      marginY={1}
      width={w}
    >
      {/* Header */}
      <Box justifyContent="space-between" marginBottom={1} width={innerW}>
        <Box gap={1}>
          <Text bold color="yellow">⚡ ScanForge Slash Commands</Text>
        </Box>
        <Text color="gray">
          [Tab] to autocomplete anytime
        </Text>
      </Box>

      {/* Commands List */}
      {SLASH_COMMANDS.map(cmd => {
        const catColor = CATEGORY_COLORS[cmd.category] || 'gray';
        return (
          <Box key={cmd.name} justifyContent="space-between" width={innerW}>
            <Box gap={1} flexShrink={1}>
              <Text bold color="yellow">{cmd.name.padEnd(12)}</Text>
              {cmd.args ? <Text color="#ffb454">{cmd.args.padEnd(20)}</Text> : <Text color="gray">{' '.repeat(20)}</Text>}
              <Text color="white" wrap="truncate-end">— {cmd.description}</Text>
            </Box>
            <Text color={catColor}>[{cmd.category}]</Text>
          </Box>
        );
      })}

      {/* Footer Tips */}
      <Box marginTop={1} width={innerW} flexDirection="column">
        <Text color="gray">
          💡 Tip: Type any URL directly (e.g. <Text color="yellow">example.com</Text>) to start auditing immediately.
        </Text>
        <Text color="gray">
          💡 Use <Text color="yellow">/targets</Text> to open the interactive checkbox manager for queued URLs.
        </Text>
      </Box>
    </Box>
  );
}
