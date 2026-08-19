/**
 * HeaderBanner — Full-width top status bar.
 *
 * Uses ink-gradient for the branding text when available,
 * falls back to bold ScanForge orange. Shows companion port, device profile,
 * mode, and keyboard shortcut hints.
 */
import React from 'react';
import { Box, Text } from 'ink';
import Gradient from 'ink-gradient';

export function HeaderBanner({ settings, isCompanionRunning = true, port = 3210, columns }) {
  const deviceLabel = settings.device === 'both'
    ? 'Mobile + Desktop'
    : settings.device === 'mobile' ? 'Mobile' : 'Desktop';
  const modeLabel = settings.lighthouseMode || 'navigation';

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#fc6200" paddingX={1} marginBottom={1} width="100%">
      <Box justifyContent="space-between">
        <Box gap={1}>
          <Gradient colors={['#fc6200', '#ffb454']}>
            <Text bold>⚡ SCANFORGE</Text>
          </Gradient>
          <Text color="gray">v1.0.1</Text>
          <Text color="gray">│</Text>
          <Text color={isCompanionRunning ? 'green' : 'red'} bold>
            {isCompanionRunning ? '● Companion' : '○ Offline'}
          </Text>
          <Text color="gray">:{port}</Text>
        </Box>
        <Box gap={1}>
          <Text color="#ffb454">🌐 Chrome / Edge</Text>
        </Box>
      </Box>

      <Box marginTop={0} justifyContent="space-between">
        <Box gap={1}>
          <Text color="gray">📱</Text>
          <Text color="white" bold>{deviceLabel}</Text>
          <Text color="gray">│</Text>
          <Text color="gray">🔍</Text>
          <Text color="white" bold>{modeLabel}</Text>
          <Text color="gray">│</Text>
          <Text color="gray">Categories:</Text>
          <Text color="white">{settings.categories?.join(', ')}</Text>
        </Box>
        <Text color="#ffb454" dimColor>
          Type a URL or <Text bold color="#fc6200">/</Text> for commands
        </Text>
      </Box>
    </Box>
  );
}
