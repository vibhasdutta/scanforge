import * as esbuild from 'esbuild';
import { copyFileSync } from 'node:fs';

// 1. Build Extension Service Worker
await esbuild.build({
  entryPoints: ['src/extension/background.js'],
  bundle: true,
  outfile: 'dist/background.js',
  platform: 'browser',
  format: 'esm',
  target: 'chrome120',
  logLevel: 'info',
});

// 2. Build TUI CLI Application
await esbuild.build({
  entryPoints: ['src/cli/index.jsx'],
  bundle: true,
  outfile: 'dist/cli.js',
  platform: 'node',
  format: 'esm',
  target: 'node22',
  packages: 'external',
  jsx: 'automatic',
  logLevel: 'info',
});

// dist/cli.js is a single bundled file, so import.meta.url-relative reads inside it
// resolve to dist/ — the banner text asset has to sit alongside it, not just in src/.
copyFileSync('src/cli/banner.txt', 'dist/banner.txt');

console.log('✅ Built dist/background.js and dist/cli.js');
