#!/usr/bin/env node

/**
 * ScanForge Native Messaging Host Registration
 * Pure Node.js cross-platform registration for Chrome, Edge, Brave, and Firefox.
 */

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRealHomeDir } from './real-home.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const HOST_NAME = 'com.scanforge.companion';
const CHROMIUM_EXTENSION_ID = 'bnmloegglgcibagjdhhnlagclcfbmcia';
const FIREFOX_EXTENSION_ID = 'scanforge@scanforge.app';

// Registration itself is harmless to write even for a browser that isn't installed (the
// manifest just sits unread), so detection here is purely informational — it tells the user
// what's actually usable right now without silently skipping a browser detection missed
// (e.g. a portable/non-standard install path).
function detectBrowsers(platform) {
  const found = { chrome: false, chromium: false, edge: false, brave: false, firefox: false };
  if (platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = process.env['LOCALAPPDATA'] || '';
    const candidates = {
      chrome: [`${pf}\\Google\\Chrome\\Application\\chrome.exe`, `${pf86}\\Google\\Chrome\\Application\\chrome.exe`, `${local}\\Google\\Chrome\\Application\\chrome.exe`],
      edge: [`${pf}\\Microsoft\\Edge\\Application\\msedge.exe`, `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`],
      brave: [`${pf}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`, `${local}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`],
      firefox: [`${pf}\\Mozilla Firefox\\firefox.exe`, `${pf86}\\Mozilla Firefox\\firefox.exe`],
    };
    for (const [browser, paths] of Object.entries(candidates)) found[browser] = paths.some(existsSync);
  } else if (platform === 'darwin') {
    const apps = {
      chrome: '/Applications/Google Chrome.app',
      chromium: '/Applications/Chromium.app',
      edge: '/Applications/Microsoft Edge.app',
      brave: '/Applications/Brave Browser.app',
      firefox: '/Applications/Firefox.app',
    };
    for (const [browser, appPath] of Object.entries(apps)) found[browser] = existsSync(appPath);
  } else {
    // Most Linux distros don't ship Google Chrome in their default repos (proprietary), so
    // Chromium is commonly the only Chromium-based browser actually installed — detected and
    // labeled separately here rather than folded into "Chrome" so the console output reflects
    // what's really on the machine.
    const bins = {
      chrome: ['google-chrome', 'google-chrome-stable'],
      chromium: ['chromium', 'chromium-browser'],
      edge: ['microsoft-edge', 'microsoft-edge-stable'],
      brave: ['brave-browser', 'brave'],
      firefox: ['firefox'],
    };
    for (const [browser, names] of Object.entries(bins)) {
      found[browser] = names.some(name => {
        try { execSync(`command -v ${name}`, { stdio: 'ignore', shell: '/bin/sh' }); return true; }
        catch { return false; }
      });
    }
  }
  return found;
}

function logDetectedBrowsers(found) {
  const labels = { chrome: 'Chrome', chromium: 'Chromium', edge: 'Edge', brave: 'Brave', firefox: 'Firefox' };
  const present = Object.entries(found).filter(([, v]) => v).map(([k]) => labels[k]);
  const missing = Object.entries(found).filter(([, v]) => !v).map(([k]) => labels[k]);
  if (present.length) console.log(`[ScanForge] Detected: ${present.join(', ')} — registered and ready to use.`);
  if (missing.length) console.log(`[ScanForge] Not detected: ${missing.join(', ')} (registered anyway, in case they're installed elsewhere — harmless if unused).`);
}

// Windows' native process launcher (what Chrome/Edge/Brave/Firefox use to start a native
// messaging host) cannot execute .bat/.cmd files directly — it needs a real executable.
// macOS/Linux don't have this problem: scanforge-native-host.sh runs fine as-is because
// POSIX exec() honors its #!/bin/sh shebang. So only Windows needs a compiled launcher,
// and we build it here automatically (csc.exe ships with every Windows install via .NET
// Framework — no extra install, no PowerShell shell-out) instead of requiring a separate
// manual step that's easy to forget.
const COMPANION_LAUNCHER_SOURCE = `
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

[assembly: AssemblyTitle("ScanForge Companion")]
[assembly: AssemblyProduct("ScanForge")]
[assembly: AssemblyDescription("ScanForge Headless Companion Server")]
[assembly: AssemblyCompany("ScanForge")]
[assembly: AssemblyVersion("1.0.4.0")]
[assembly: AssemblyFileVersion("1.0.4.0")]

namespace ScanForgeLauncher
{
    class Program
    {
        static string FindNode(string rootDir)
        {
            string nodeBinTxt = Path.Combine(rootDir, "node_bin.txt");
            if (File.Exists(nodeBinTxt))
            {
                string path = File.ReadAllText(nodeBinTxt).Trim();
                if (File.Exists(path)) return path;
            }
            string defaultProg = @"C:\\Program Files\\nodejs\\node.exe";
            if (File.Exists(defaultProg)) return defaultProg;
            return "node";
        }

        static void ForwardStream(Stream source, Stream destination)
        {
            byte[] buffer = new byte[4096];
            int bytesRead;
            try
            {
                while ((bytesRead = source.Read(buffer, 0, buffer.Length)) > 0)
                {
                    destination.Write(buffer, 0, bytesRead);
                    destination.Flush();
                }
            }
            catch { }
        }

        static byte[] ReadExactly(Stream source, int count)
        {
            byte[] buffer = new byte[count];
            int offset = 0;
            while (offset < count)
            {
                int read = source.Read(buffer, offset, count - offset);
                if (read <= 0) throw new EndOfStreamException("native-host.js closed its output before sending a full response.");
                offset += read;
            }
            return buffer;
        }

        // Relays exactly ONE native-messaging-framed response (4-byte little-endian length,
        // then that many bytes of JSON) instead of streaming until end-of-file. The 'start'
        // and 'restart' actions launch a long-lived, detached companion server; on Windows
        // that detached process can end up holding a duplicate handle of this launcher's
        // redirected stdout pipe (a known .NET RedirectStandardOutput inheritance gotcha),
        // so the pipe never actually reaches EOF and a blind forward-until-EOF read would
        // hang forever even though native-host.js already wrote its response and exited.
        // Reading the exact framed length sidesteps that entirely.
        static void RelayOneMessage(Stream source, Stream destination)
        {
            byte[] header = ReadExactly(source, 4);
            destination.Write(header, 0, 4);
            uint length = BitConverter.ToUInt32(header, 0);
            if (length > 0)
            {
                byte[] payload = ReadExactly(source, (int)length);
                destination.Write(payload, 0, payload.Length);
            }
            destination.Flush();
        }

        static int Main(string[] args)
        {
            string exeDir = AppDomain.CurrentDomain.BaseDirectory;
            string rootDir = Path.GetFullPath(Path.Combine(exeDir, ".."));
            if (!Directory.Exists(Path.Combine(rootDir, "src")))
            {
                rootDir = exeDir;
            }

            string nodePath = FindNode(rootDir);
            string scriptPath = Path.Combine(rootDir, "src", "companion", "native-host.js");

            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = nodePath,
                Arguments = "\\"" + scriptPath + "\\" " + string.Join(" ", args),
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                WorkingDirectory = rootDir
            };

            using (Process proc = new Process { StartInfo = psi })
            {
                proc.Start();

                System.Threading.Tasks.Task.Run(() =>
                {
                    try
                    {
                        using (Stream input = Console.OpenStandardInput())
                        {
                            ForwardStream(input, proc.StandardInput.BaseStream);
                        }
                        proc.StandardInput.Close();
                    }
                    catch { }
                });

                System.Threading.Tasks.Task.Run(() =>
                {
                    try
                    {
                        using (Stream err = Console.OpenStandardError())
                        {
                            ForwardStream(proc.StandardError.BaseStream, err);
                        }
                    }
                    catch { }
                });

                try
                {
                    using (Stream output = Console.OpenStandardOutput())
                    {
                        RelayOneMessage(proc.StandardOutput.BaseStream, output);
                    }
                }
                catch { }

                // native-host.js exits on its own right after writing its response (verified
                // independently of this launcher). A 'start'/'restart' action's detached child
                // keeps running afterward and must not block this launcher's return to Chrome,
                // so this is a best-effort reap with a short timeout, not a hard wait.
                proc.WaitForExit(2000);
                return 0;
            }
        }
    }
}
`;

function findCsc() {
  return [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe',
  ].find(existsSync) || null;
}

// Builds bin/scanforge-companion.exe if it doesn't already exist. Returns its path on
// success, or null if it couldn't be built (caller falls back to the .bat, with a warning).
function ensureCompanionLauncher(rootDir) {
  const exePath = path.join(rootDir, 'bin', 'scanforge-companion.exe');
  if (existsSync(exePath)) return exePath;

  const csc = findCsc();
  if (!csc) {
    console.warn('[ScanForge] csc.exe (.NET Framework) was not found, so the native messaging launcher could not be built.');
    console.warn('[ScanForge] Falling back to the .bat launcher — Windows cannot run this reliably as a native messaging host, so the extension\'s Start/Restart buttons may not work.');
    console.warn('[ScanForge] .NET Framework ships with Windows by default; if it is genuinely missing, install it and re-run "npm run register".');
    return null;
  }

  try {
    const binDir = path.join(rootDir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const srcPath = path.join(binDir, 'ScanForgeCompanion.cs');
    writeFileSync(srcPath, COMPANION_LAUNCHER_SOURCE, 'utf8');
    const icoPath = path.join(rootDir, 'assets', 'derived', 'scanforge.ico');
    const iconArg = existsSync(icoPath) ? ` "/win32icon:${icoPath}"` : '';
    execSync(`"${csc}" /nologo /optimize /target:winexe${iconArg} "/out:${exePath}" "${srcPath}"`, { stdio: 'ignore' });
    console.log('✅ Built native messaging launcher: bin/scanforge-companion.exe');
    return exePath;
  } catch (e) {
    console.warn('[ScanForge] Could not compile the native messaging launcher:', e.message);
    console.warn('[ScanForge] Falling back to the .bat launcher, which Windows cannot run reliably as a native messaging host.');
    return null;
  }
}

function registerWindows() {
  writeFileSync(path.join(ROOT_DIR, 'node_bin.txt'), process.execPath, 'utf8');
  const batPath = path.join(ROOT_DIR, 'src', 'companion', 'scanforge-native-host.bat');
  const launcherPath = ensureCompanionLauncher(ROOT_DIR) || batPath;
  const appDataDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'ScanForge');
  mkdirSync(appDataDir, { recursive: true });

  const chromiumManifestPath = path.join(appDataDir, 'native-messaging-host.json');
  const firefoxManifestPath = path.join(appDataDir, 'native-messaging-host-firefox.json');

  const chromiumManifest = {
    name: HOST_NAME,
    description: 'ScanForge Headless Companion Bridge',
    path: launcherPath,
    type: 'stdio',
    allowed_origins: [
      `chrome-extension://${CHROMIUM_EXTENSION_ID}/`,
    ],
  };

  const firefoxManifest = {
    name: HOST_NAME,
    description: 'ScanForge Headless Companion Bridge',
    path: launcherPath,
    type: 'stdio',
    allowed_extensions: [
      FIREFOX_EXTENSION_ID,
    ],
  };

  writeFileSync(chromiumManifestPath, JSON.stringify(chromiumManifest, null, 2), 'utf8');
  writeFileSync(firefoxManifestPath, JSON.stringify(firefoxManifest, null, 2), 'utf8');

  const registryTargets = [
    'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
    'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts',
    'HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts',
  ];

  for (const root of registryTargets) {
    try {
      execSync(`reg add "${root}\\${HOST_NAME}" /ve /t REG_SZ /d "${chromiumManifestPath}" /f`, { stdio: 'ignore' });
    } catch (e) {
      console.warn(`[ScanForge] Could not add registry key for ${root}:`, e.message);
    }
  }

  try {
    execSync(`reg add "HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HOST_NAME}" /ve /t REG_SZ /d "${firefoxManifestPath}" /f`, { stdio: 'ignore' });
  } catch (e) {
    console.warn('[ScanForge] Could not add Mozilla registry key:', e.message);
  }

  console.log('✅ Registered ScanForge native messaging host on Windows.');
  logDetectedBrowsers(detectBrowsers('win32'));
}

function registerUnix(platform) {
  writeFileSync(path.join(ROOT_DIR, 'node_bin.txt'), process.execPath, 'utf8');
  const launcherPath = path.join(ROOT_DIR, 'src', 'companion', 'scanforge-native-host.sh');
  try {
    chmodSync(launcherPath, 0o755);
  } catch {}

  const home = getRealHomeDir();
  // Chrome's own docs list "Chromium" as a directory distinct from "Google Chrome" — most
  // Linux distros ship Chromium (not Google Chrome, which isn't in most default repos) as
  // the readily-available Chromium-based browser, so this is a real, commonly-hit target,
  // not a rare edge case.
  const manifestDirs = platform === 'darwin'
    ? [
        path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts'),
        path.join(home, 'Library', 'Application Support', 'Chromium', 'NativeMessagingHosts'),
        path.join(home, 'Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts'),
        path.join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'),
        path.join(home, 'Library', 'Application Support', 'Mozilla', 'NativeMessagingHosts'),
      ]
    : [
        path.join(home, '.config', 'google-chrome', 'NativeMessagingHosts'),
        path.join(home, '.config', 'chromium', 'NativeMessagingHosts'),
        path.join(home, '.config', 'microsoft-edge', 'NativeMessagingHosts'),
        path.join(home, '.config', 'BraveSoftware', 'Brave-Browser', 'NativeMessagingHosts'),
        path.join(home, '.mozilla', 'native-messaging-hosts'),
      ];

  const chromiumManifest = {
    name: HOST_NAME,
    description: 'ScanForge Headless Companion Bridge',
    path: launcherPath,
    type: 'stdio',
    allowed_origins: [
      `chrome-extension://${CHROMIUM_EXTENSION_ID}/`,
    ],
  };

  const firefoxManifest = {
    name: HOST_NAME,
    description: 'ScanForge Headless Companion Bridge',
    path: launcherPath,
    type: 'stdio',
    allowed_extensions: [
      FIREFOX_EXTENSION_ID,
    ],
  };

  for (const dir of manifestDirs) {
    try {
      mkdirSync(dir, { recursive: true });
      const isMozilla = dir.toLowerCase().includes('mozilla');
      const manifestFile = path.join(dir, `${HOST_NAME}.json`);
      writeFileSync(manifestFile, JSON.stringify(isMozilla ? firefoxManifest : chromiumManifest, null, 2), 'utf8');
    } catch (e) {
      console.warn(`[ScanForge] Could not write manifest to ${dir}:`, e.message);
    }
  }

  console.log(`✅ Registered ScanForge native messaging host on ${platform === 'darwin' ? 'macOS' : 'Linux'}.`);
  logDetectedBrowsers(detectBrowsers(platform));
}

// No longer wired to npm's "postinstall" — pnpm blocks postinstall scripts by default since
// v10, and a growing number of security-conscious npm setups set ignore-scripts=true globally
// too, so `npm install` silently skipping this with no error was a real, recurring failure
// mode. Registration now runs on every "scanforge" launch instead (self-heals automatically),
// plus "scanforge --register" and "npm run register" as explicit manual triggers. It must
// never make its caller fail. A user with an unusual setup (unsupported platform, no .NET
// Framework, a locked-down registry) still gets a fully working `scanforge` CLI; they just
// won't get automatic browser-extension launching until they can resolve whatever blocked it.
function main() {
  try {
    const platform = os.platform();
    if (platform === 'win32') {
      registerWindows();
    } else if (platform === 'darwin' || platform === 'linux') {
      registerUnix(platform);
    } else {
      console.warn(`[ScanForge] Native messaging auto-registration isn't supported on "${platform}" yet.`);
      console.warn('[ScanForge] The CLI (npx scanforge) still works fully — only the browser extension\'s auto-launch is affected.');
    }
  } catch (e) {
    console.warn('[ScanForge] Native messaging registration failed:', e.message);
    console.warn('[ScanForge] The CLI still works. Retry later with: npm run register');
  }
}

main();
