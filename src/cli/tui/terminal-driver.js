import { EventEmitter } from 'node:events';

export class TerminalDriver extends EventEmitter {
  constructor() {
    super();
    this.columns = process.stdout.columns || 100;
    this.rows = process.stdout.rows || 30;
    this.isEntered = false;
    this.onResize = this.handleResize.bind(this);
  }

  enter() {
    if (process.stdout.isTTY && !this.isEntered) {
      // Enter alternate screen buffer, clear screen, position cursor at top-left
      process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H\x1b[?25h');
      this.isEntered = true;
    }

    process.stdout.on('resize', this.onResize);

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
    process.stdout.removeListener('resize', this.onResize);
  }

  handleResize() {
    this.columns = process.stdout.columns || 100;
    this.rows = process.stdout.rows || 30;
    this.emit('resize', { columns: this.columns, rows: this.rows });
  }
}

export const terminalDriver = new TerminalDriver();
