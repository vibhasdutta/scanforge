/**
 * AuditDb — Crash-resilient temporary disk cache for active audits.
 * Separate DBs for TUI (scanforge-tui.db) and Extension (scanforge-ext.db).
 * Automatically cleaned up on completion, exit, or crash recovery.
 */
import { existsSync, readFileSync, appendFileSync, writeFileSync, unlinkSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE_DIR = process.env.SCANFORGE_DATA_DIR || path.join(process.env.APPDATA || os.homedir(), 'ScanForge');
export const DB_DIR = path.join(BASE_DIR, 'db');
mkdirSync(DB_DIR, { recursive: true });

export const DB_FILES = {
  tui: path.join(DB_DIR, 'scanforge-tui.db'),
  ext: path.join(DB_DIR, 'scanforge-ext.db'),
};
const MAX_DB_BYTES = 20 * 1024 * 1024;

export class AuditDb {
  constructor(source = 'tui') {
    this.source = ['tui', 'ext'].includes(source) ? source : 'tui';
    this.filePath = DB_FILES[this.source];
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.init();
  }

  init() {
    try {
      writeFileSync(this.filePath, '', 'utf8');
    } catch {}
  }

  append(record) {
    if (!record) return;
    try {
      const line = JSON.stringify(record) + '\n';
      const size = existsSync(this.filePath) ? requireSize(this.filePath) : 0;
      if (Buffer.byteLength(line) + size > MAX_DB_BYTES) throw new Error('Audit report storage limit reached.');
      appendFileSync(this.filePath, line, 'utf8');
    } catch (e) {
      console.warn(`[AuditDb] Failed to write to ${this.filePath}:`, e.message);
    }
  }

  readAll() {
    try {
      if (!existsSync(this.filePath)) return [];
      const content = readFileSync(this.filePath, 'utf8');
      return content
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  clean() {
    try {
      if (existsSync(this.filePath)) {
        unlinkSync(this.filePath);
      }
    } catch {}
  }

  static cleanAll() {
    for (const file of Object.values(DB_FILES)) {
      try {
        if (existsSync(file)) {
          unlinkSync(file);
        }
      } catch {}
    }
  }
}

function requireSize(file) {
  try { return statSync(file).size; } catch { return 0; }
}

// Clean any leftover DBs on initial module load
AuditDb.cleanAll();

// Register process exit listeners for crash safety
const handleExit = () => AuditDb.cleanAll();
process.once('exit', handleExit);
process.once('SIGINT', handleExit);
process.once('SIGTERM', handleExit);
