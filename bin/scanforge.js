#!/usr/bin/env node

/**
 * ScanForge CLI & Unified TUI Companion
 * Multi-page Lighthouse auditing companion for developers & AI coding tools.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  process.title = 'scanforge';
} catch {}

const args = process.argv.slice(2);
const command = args[0]?.toLowerCase();

if (command === '--help' || command === '-h' || command === 'help') {
  console.log(`
ScanForge - Multi-page Lighthouse auditing for Developers & AI

USAGE:
  scanforge                       Launch unified Terminal UI & Extension Companion
  scanforge <url...> [options]    Direct headless audit of specified URLs
  scanforge --unregister          Remove native-messaging registration (run before uninstalling)

OPTIONS:
  --device=<both|mobile|desktop>  Device profile (default: both)
  --mode=<navigation|timespan>    Lighthouse mode (default: navigation)
  --output=<file.md>              Save combined markdown report to file
  --help, -h                      Show this help message

EXAMPLES:
  scanforge
  scanforge https://example.com https://example.com/pricing --device=both --output=report.md
`);
  process.exit(0);
} else if (command === '--unregister' || command === 'unregister') {
  // npm dropped preuninstall/postuninstall lifecycle scripts in v7 (no reliable context for why a
  // package is being removed), so cleanup can't run automatically on `npm uninstall`. This has to be
  // a command users run themselves first.
  await import('../scripts/unregister-native-host.js');
} else if (args.some(arg => /^https?:\/\//i.test(arg))) {
  // Direct CLI Audit Mode
  const urls = args.filter(arg => /^https?:\/\//i.test(arg));
  const deviceArg = args.find(a => a.startsWith('--device='))?.split('=')[1] || 'both';
  const modeArg = args.find(a => a.startsWith('--mode='))?.split('=')[1] || 'navigation';
  const outputArg = args.find(a => a.startsWith('--output='))?.split('=')[1];

  console.log(`\n🚀 ScanForge Direct Audit: ${urls.length} URL(s) on ${deviceArg} device profile...\n`);

  const { executeAuditBatch } = await import('../src/cli/direct-audit.js');

  const pages = urls.map((url, i) => ({ id: `page-${i}`, url, title: url }));
  const reports = await executeAuditBatch({
    pages,
    deviceOption: deviceArg,
    lighthouseMode: modeArg,
    onProgress: ({ device, percent, stage }) => {
      process.stdout.write(`\r  [${device.toUpperCase()}] ${percent}%: ${stage.slice(0, 50).padEnd(50)}`);
    },
  });

  console.log('\n\n✅ Audit complete!\n');

  const markdown = reports[0]?.combinedMarkdown || reports.map(r => r.markdown).join('\n\n---\n\n');

  if (outputArg) {
    fs.writeFileSync(outputArg, markdown, 'utf8');
    console.log(`📄 Saved combined report to: ${outputArg}`);
  } else {
    console.log(markdown);
  }
} else {
  // Unified TUI + Companion Server Mode
  const cliDistPath = path.resolve(__dirname, '../dist/cli.js');
  if (fs.existsSync(cliDistPath)) {
    const mod = await import(pathToFileURL(cliDistPath).href);
    if (typeof mod.runTUI === 'function') {
      await mod.runTUI();
    }
  } else {
    const { runTUI } = await import(pathToFileURL(path.resolve(__dirname, '../src/cli/index.jsx')).href);
    await runTUI();
  }
}
