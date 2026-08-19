/**
 * ActivityFeed — Scrollable message history with viewport windowing.
 *
 * Uses Ink's <Static> for permanent log entries that never re-render,
 * and a dynamic tail section that shows the latest N messages
 * with auto-scroll behaviour.
 *
 * All text uses wrap="wrap" so long messages flow within the frame
 * instead of overflowing outside it.
 */
import React from 'react';
import { Box, Static, Text } from 'ink';

// Notification "badges" instead of bare log glyphs — reads as a toast, not a CI log line.
const NOTICE_THEME = {
  error: { badge: 'red', fg: 'black', icon: '✖', text: 'red' },
  success: { badge: 'green', fg: 'black', icon: '✔', text: 'green' },
  system: { badge: '#fc6200', fg: 'black', icon: '›', text: 'gray' },
};

function MessageLine({ msg, maxWidth }) {
  if (msg.type === 'user') {
    return (
      <Box gap={1} width={maxWidth}>
        <Text color="yellow" bold>❯</Text>
        <Text color="yellow" bold wrap="wrap">{msg.content}</Text>
      </Box>
    );
  }

  const theme = NOTICE_THEME[msg.type] || NOTICE_THEME.system;
  return (
    <Box gap={1} width={maxWidth}>
      <Text backgroundColor={theme.badge} color={theme.fg} bold> {theme.icon} </Text>
      <Text color={theme.text} wrap="wrap">{msg.content}</Text>
    </Box>
  );
}

export function ActivityFeed({ messages, maxVisible = 12, maxWidth }) {
  // Split into permanent (older) and dynamic (recent) messages.
  // <Static> renders items once and never re-renders them — prevents flicker.
  const permanentMessages = messages.slice(0, Math.max(0, messages.length - maxVisible));
  const dynamicMessages = messages.slice(-maxVisible);

  return (
    <Box flexDirection="column" flexGrow={1} width={maxWidth || '100%'}>
      {/* Permanent entries — rendered once, never updated */}
      <Static items={permanentMessages}>
        {msg => (
          <Box key={msg.id} marginLeft={1} width={maxWidth ? maxWidth - 2 : undefined}>
            <MessageLine msg={msg} maxWidth={maxWidth ? maxWidth - 2 : undefined} />
          </Box>
        )}
      </Static>

      {/* Dynamic tail — always visible, re-renders on new entries */}
      {dynamicMessages.map(msg => (
        <Box key={msg.id} marginLeft={1} width={maxWidth ? maxWidth - 2 : undefined}>
          <MessageLine msg={msg} maxWidth={maxWidth ? maxWidth - 2 : undefined} />
        </Box>
      ))}
    </Box>
  );
}
