// Terminal dimensions are tracked via Ink's own useWindowSize() hook (see AgentRepl.jsx) so
// there's a single resize listener shared with Ink's internal redraw bookkeeping, rather than
// a second one here racing it. This driver only owns the alternate-screen buffer lifecycle.
export class TerminalDriver {
  constructor() {
    this.isEntered = false;
  }

  enter() {
    if (process.stdout.isTTY && !this.isEntered) {
      // Enter alternate screen buffer, clear screen, position cursor at top-left
      process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H\x1b[?25h');
      this.isEntered = true;
    }

    const cleanup = () => this.exit();
    process.once('exit', cleanup);
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  }

  exit() {
    if (this.isEntered && process.stdout.isTTY) {
      // Clear screen, leave alternate screen buffer, restore normal shell
      process.stdout.write('\x1b[2J\x1b[H\x1b[?1049l\x1b[?25h');
      this.isEntered = false;
    }
  }
}

export const terminalDriver = new TerminalDriver();
