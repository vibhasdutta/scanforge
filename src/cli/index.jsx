import '../companion/perf-patch.js';
import React from 'react';
import { render } from 'ink';
import { AgentRepl } from './repl/AgentRepl.jsx';
import { terminalDriver } from './tui/terminal-driver.js';
import { globalCompanionBus } from '../companion/companion-bus.js';
import { startCompanionServer } from '../companion/companion-server.js';

export async function runTUI() {
  let server = null;

  // Registration isn't wired to npm's postinstall anymore (pnpm blocks it by default since
  // v10, and plenty of security-conscious npm setups set ignore-scripts=true globally too —
  // both skip postinstall silently, no error, leaving the extension's Start button unable to
  // find a companion). Re-registering on every launch instead is cheap and idempotent, and
  // it's a genuinely manual trigger — the user just ran "scanforge" themselves.
  try {
    await import('../../scripts/register-native-host.js');
  } catch {}

  terminalDriver.enter();

  try {
    server = await startCompanionServer({ bus: globalCompanionBus, silent: true });
  } catch (err) {
    // Port in use — continue without companion
  }

  const { waitUntilExit, unmount } = render(<AgentRepl bus={globalCompanionBus} />, {
    exitOnCtrlC: false, // We handle Ctrl+C ourselves in useInput
  });

  try {
    await waitUntilExit();
  } finally {
    unmount();
    terminalDriver.exit();
    if (server) server.close();
  }
}

// Auto-run if executed directly
if (process.argv[1]?.endsWith('cli.js') || process.argv[1]?.endsWith('index.jsx')) {
  runTUI();
}
