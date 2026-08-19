#!/usr/bin/env node

/**
 * ScanForge Native Messaging Host Unregistration
 * Removes registry keys, manifests, and clears all companion process locks.
 */

import { execSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOST_NAME = 'com.scanforge.companion';

function unregisterWindows() {
  const registryTargets = [
    'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
    'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts',
    'HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts',
    'HKCU\\Software\\Mozilla\\NativeMessagingHosts',
  ];

  for (const root of registryTargets) {
    try {
      execSync(`reg delete "${root}\\${HOST_NAME}" /f`, { stdio: 'ignore' });
    } catch {}
  }

  const appDataDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'ScanForge');
  const filesToDelete = [
    path.join(appDataDir, 'native-messaging-host.json'),
    path.join(appDataDir, 'native-messaging-host-firefox.json'),
    path.join(appDataDir, 'companion.pid'),
    path.join(appDataDir, 'scanforge-tui.db'),
    path.join(appDataDir, 'scanforge-ext.db'),
  ];

  for (const f of filesToDelete) {
    try {
      if (existsSync(f)) unlinkSync(f);
    } catch {}
  }

  console.log('✅ Unregistered ScanForge native messaging host and removed registry entries & lock files.');
}

function unregisterUnix(platform) {
  const home = os.homedir();
  const manifestDirs = platform === 'darwin'
    ? [
        path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'),
        path.join(home, 'Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts'),
        path.join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'),
        path.join(home, 'Library', 'Application Support', 'Mozilla', 'NativeMessagingHosts'),
      ]
    : [
        path.join(home, '.config', 'google-chrome', 'NativeMessagingHosts'),
        path.join(home, '.config', 'microsoft-edge', 'NativeMessagingHosts'),
        path.join(home, '.config', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'),
        path.join(home, '.mozilla', 'native-messaging-hosts'),
      ];

  for (const dir of manifestDirs) {
    const manifestFile = path.join(dir, `${HOST_NAME}.json`);
    try {
      if (existsSync(manifestFile)) unlinkSync(manifestFile);
    } catch {}
  }

  console.log('✅ Unregistered ScanForge native messaging host manifests.');
}

const platform = os.platform();
if (platform === 'win32') {
  unregisterWindows();
} else {
  unregisterUnix(platform);
}
