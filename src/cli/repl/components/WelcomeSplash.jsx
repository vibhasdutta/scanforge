/**
 * WelcomeSplash — Gemini CLI & Claude Code style onboarding hero section.
 */
import React from 'react';
import { Box, Text } from 'ink';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Tries each candidate path in order, returning the first that reads successfully as
// non-empty lines. dist/cli.js is a single bundled file, so a path resolved relative to
// it at runtime lands in dist/, not the original source location — every asset needs both
// a bundled-location candidate and a dev-source-location candidate.
function loadTextAsset(...candidates) {
  for (const candidate of candidates) {
    try {
      const lines = fs.readFileSync(candidate, 'utf8').replace(/\r\n/g, '\n').split('\n').filter(line => line.length > 0);
      if (lines.length) return lines;
    } catch {}
  }
  return null;
}

const __dir = path.dirname(fileURLToPath(import.meta.url));
const BANNER = loadTextAsset(
  path.join(__dir, 'banner.txt'), // bundled: copied to dist/banner.txt by build.js
  path.join(__dir, '..', '..', 'banner.txt'), // dev: src/cli/banner.txt
) || ['SCANFORGE'];
const LOGO = loadTextAsset(
  path.join(__dir, '..', 'assets', 'logo.txt'), // bundled: dist/../assets/logo.txt
  path.join(__dir, '..', '..', '..', '..', 'assets', 'logo.txt'), // dev: .../components/../../../../assets/logo.txt
);

const BANNER_WIDTH = Math.max(...BANNER.map(line => line.length));
const LOGO_WIDTH = LOGO ? Math.max(...LOGO.map(line => line.length)) : 0;
const TAGLINE_MIN_WIDTH = 22; // "Multi-page Lighthouse" — the longest of the three tagline lines

function Tagline() {
  return (
    <Box flexDirection="column" justifyContent="center">
      <Text color="gray">Multi-page Lighthouse</Text>
      <Text color="gray">audits for AI agents</Text>
      <Text color="gray">and developers.</Text>
    </Box>
  );
}

export function WelcomeSplash({ columns, isCompanionRunning = true, port = 3210 }) {
  const width = columns || 100;
  const bannerFits = width >= BANNER_WIDTH + 4;
  const sideBySideFits = width >= BANNER_WIDTH + 3 + TAGLINE_MIN_WIDTH;
  const logoFits = LOGO && width >= LOGO_WIDTH + 3 + BANNER_WIDTH + 4;

  return (
    <Box flexDirection="column" marginY={1} width="100%">
      {/* Logo beside banner+tagline (tagline stacked under the banner, not beside it) */}
      {logoFits ? (
        <Box gap={3} marginBottom={1} alignItems="center">
          <Box flexDirection="column">
            {LOGO.map((line, i) => (
              <Text key={i} color="#fc6200">{line}</Text>
            ))}
          </Box>
          <Box flexDirection="column">
            {BANNER.map((line, i) => (
              <Text key={i} color="#fc6200" bold>{line}</Text>
            ))}
            <Box marginTop={0}>
              <Text color="gray">Multi-page Lighthouse audits for AI agents and developers</Text>
            </Box>
          </Box>
        </Box>
      ) : bannerFits ? (
        sideBySideFits ? (
          <Box gap={3} marginBottom={1}>
            <Box flexDirection="column">
              {BANNER.map((line, i) => (
                <Text key={i} color="#fc6200" bold>{line}</Text>
              ))}
            </Box>
            <Tagline />
          </Box>
        ) : (
          <Box flexDirection="column" marginBottom={1}>
            {BANNER.map((line, i) => (
              <Text key={i} color="#fc6200" bold>{line}</Text>
            ))}
            <Box marginTop={0}>
              <Text color="gray">Multi-page Lighthouse audits for AI agents and developers</Text>
            </Box>
          </Box>
        )
      ) : (
        <Box marginBottom={1} flexDirection="column">
          <Box gap={1}>
            <Text color="#fc6200" bold>SCANFORGE</Text>
            <Text color="gray">v1.0.1</Text>
          </Box>
          <Text color="gray">Multi-page Lighthouse audits for AI agents and developers</Text>
        </Box>
      )}

      {/* Tips for getting started */}
      <Box flexDirection="column" marginY={1}>
        <Text color="white" bold>Tips for getting started:</Text>
        <Text color="gray">1. Type any URL (e.g. <Text color="#ffb454">example.com</Text>) to start an audit immediately.</Text>
        <Text color="gray">2. Use <Text color="#ffb454">/target</Text> to manage target URLs, <Text color="#ffb454">/settings</Text> to configure mode, device, and resource limits.</Text>
        <Text color="gray">3. Type <Text color="#ffb454">/help</Text> or <Text color="#ffb454">/</Text> for all slash commands and shortcuts.</Text>
      </Box>

      {/* Context / Companion Info Line */}
      <Box marginY={0} gap={1}>
        <Text color={isCompanionRunning ? 'green' : 'red'}>
          {isCompanionRunning ? '●' : '○'}
        </Text>
        <Text color="gray">
          ScanForge Companion on <Text color="white">http://127.0.0.1:{port}</Text> (Chrome / Edge extension connected)
        </Text>
      </Box>
    </Box>
  );
}
