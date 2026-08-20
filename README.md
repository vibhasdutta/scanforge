<p align="center">
  <img src="./Scanforge.png" alt="ScanForge lighthouse and anvil logo" width="150" height="150" />
</p>

<h1 align="center">ScanForge</h1>

<p align="center"><strong>Multi-page Lighthouse audits forged into concise, AI-ready Markdown.</strong></p>

<p align="center">No more running Lighthouse one URL at a time — queue an entire page journey, audit Mobile and Desktop concurrently, and export one focused report that developers and AI coding tools can act on.</p>

<p align="center">
  <img alt="Version 1.0.4" src="https://img.shields.io/badge/version-1.0.4-ff7300?style=flat-square" />
  <img alt="Manifest V3" src="https://img.shields.io/badge/extension-Manifest%20V3-202124?style=flat-square" />
  <img alt="Powered by Lighthouse" src="https://img.shields.io/badge/powered%20by-Lighthouse-ff7300?style=flat-square&logo=lighthouse&logoColor=white" />
  <img alt="Local first" src="https://img.shields.io/badge/privacy-local--first-202124?style=flat-square" />
</p>

<p align="center">
  <img alt="Google Chrome" src="https://img.shields.io/badge/Chrome-supported-202124?style=flat-square&logo=googlechrome&logoColor=white" />
  <img alt="Microsoft Edge" src="https://img.shields.io/badge/Edge-supported-202124?style=flat-square&logo=microsoftedge&logoColor=white" />
  <img alt="Brave" src="https://img.shields.io/badge/Brave-supported-202124?style=flat-square&logo=brave&logoColor=white" />
  <img alt="Mozilla Firefox" src="https://img.shields.io/badge/Firefox-supported-202124?style=flat-square&logo=firefoxbrowser&logoColor=white" />
</p>

<p align="center">
  <img alt="Windows" src="https://img.shields.io/badge/Windows-supported-202124?style=flat-square&logo=windows11&logoColor=white" />
  <img alt="macOS" src="https://img.shields.io/badge/macOS-supported-202124?style=flat-square&logo=apple&logoColor=white" />
  <img alt="Linux" src="https://img.shields.io/badge/Linux-supported-202124?style=flat-square&logo=linux&logoColor=white" />
</p>

---

## Contents

- [Chapter 1: What ScanForge does](#chapter-1-what-scanforge-does)
- [Chapter 2: How it works](#chapter-2-how-it-works)
- [Chapter 3: Platform support](#chapter-3-platform-support)
- [Chapter 4: Install and run](#chapter-4-install-and-run)
- [Chapter 5: Audit workflows](#chapter-5-audit-workflows)
- [Chapter 6: Audit configuration](#chapter-6-audit-configuration)
- [Chapter 7: Reports and notifications](#chapter-7-reports-and-notifications)
- [Chapter 8: Development](#chapter-8-development)
- [Chapter 9: Packaging](#chapter-9-packaging)
- [Chapter 10: Privacy and security](#chapter-10-privacy-and-security)
- [Chapter 11: Troubleshooting](#chapter-11-troubleshooting)
- [Chapter 12: Project status and roadmap](#chapter-12-project-status-and-roadmap)
- [Contributing](#contributing)

## Chapter 1: What ScanForge does

Lighthouse is excellent at inspecting one page, but its raw output is large and awkward to use across a complete customer journey. ScanForge wraps the official Lighthouse package with a workflow designed for multi-page auditing and focused reporting.

ScanForge can:

- Audit the current browser page.
- Capture multiple pages while you browse.
- Audit every captured page or only a selected subset.
- Run Mobile, Desktop, or both device profiles.
- Combine multiple pages and devices into one Markdown report.
- Preserve scores, Core Web Vitals, failing elements, affected resources, diagnostic evidence, estimated savings, and recommended fixes.
- Remove bulky data that rarely helps a developer or AI coding tool implement a fix.
- Copy or download reports using filenames derived from the audited pages.

### Who it is for

- Developers investigating performance, accessibility, SEO, and best-practice problems.
- Agencies reviewing multi-page websites and customer journeys.
- Teams attaching focused evidence to issues, pull requests, or documentation.
- AI-assisted workflows that need actionable findings rather than an entire Lighthouse result object.

## Chapter 2: How it works

```text
Browser extension (Chrome, Edge, Brave, Firefox)
      |
      | HTTP/SSE on 127.0.0.1:3210
      v
ScanForge Companion (Node.js)
      |
      v
Official Lighthouse package
      |
      v
Focused report data -> combined Markdown
```

The browser extension manages page capture, settings, progress, reports, downloads, toolbar state, and notifications. The local companion launches Lighthouse, schedules device and page jobs, streams progress, and converts Lighthouse results into focused report data.

The extension cannot run the Lighthouse Node package by itself due to browser sandbox limits. Run `npx scanforge-audit` or `npm run companion` in your terminal while auditing.

## Chapter 3: Platform support

### Browsers

| Browser | Package | Development page |
| --- | --- | --- |
| Google Chrome | Chromium ZIP | `chrome://extensions` |
| Microsoft Edge | Chromium ZIP | `edge://extensions` |
| Brave | Chromium ZIP | `brave://extensions` |
| Mozilla Firefox | Firefox ZIP | `about:debugging` |

### Operating systems

ScanForge is 100% portable and cross-platform:

| Operating system | Companion | Experience |
| --- | --- | --- |
| Windows 10/11 | `npx scanforge-audit` (or `npm run companion`) | Full browser extension + terminal |
| macOS | `npx scanforge-audit` (or `npm run companion`) | Full browser extension + terminal |
| Linux | `npx scanforge-audit` (or `npm run companion`) | Full browser extension + terminal |

All status controls and indicators remain right in the browser toolbar and extension popup.

## Chapter 4: Install and run

### Requirements

- Node.js 22.19+ and npm — the companion is a Node program; there's no way to audit anything without it, extension or not.
- A locally installed Chromium browser for Lighthouse to drive.
- Chrome, Edge, Brave, or Firefox, only if you also want the extension's UI.

The extension and the companion are two separate installs. The companion (npm) is the audit engine — on its own it's already a fully working CLI. The extension is an optional UI on top of it for page capture and in-browser reports; without the companion running, it just sits there **Offline** and can't audit anything. Install order doesn't matter, but for the full experience you need both.

### For users

**Companion (CLI)** — install it once and keep the `scanforge` command around (the terminal command is `scanforge` regardless — the package name and the command it installs aren't the same thing):

```bash
npm install -g scanforge-audit
scanforge
```

The first time you run `scanforge`, it registers native messaging for whatever supported browsers it finds on your machine — that's what lets the extension's own **Start** button launch the companion for you later. This isn't tied to the install step itself (no `postinstall` hook, so it works the same regardless of `npm`/`pnpm`/`yarn` or `ignore-scripts` settings) — it just runs automatically each time you launch `scanforge`, harmlessly re-checking every time. A persistent global install keeps that registration pointing at a stable location, so it keeps working. The companion itself starts on `http://127.0.0.1:3210`.

You can also trigger registration manually without opening the TUI: `scanforge --register`.

If you'd rather not install anything persistent and just run audits from a terminal yourself (not relying on the extension's Start button), `npx scanforge-audit` works too — it registers native messaging as well, but from a cache location that can get cleared, which would silently break Start until you run `npx` again.

**Linux: Firefox/Brave installed via Snap or Flatpak won't work with the Start button.** This isn't a ScanForge-specific bug — Snap and Flatpak sandbox the browser process, which blocks it from executing the native-messaging host script at all (not just finding it). Ubuntu ships Firefox as a Snap by default since 22.04, so this is easy to hit without realizing it. Check with `snap list` / `flatpak list`; if your browser shows up there, install its regular native package instead (e.g. Mozilla's official `.deb`/PPA for Firefox, or Brave's official apt repo) to get the Start button working.

Before uninstalling, run `scanforge --unregister` first to remove that native-messaging registration — npm doesn't run cleanup scripts on `npm uninstall` (removed in npm v7), so this has to be a manual step: `scanforge --unregister && npm uninstall -g scanforge-audit`.

**Extension** (adds the browser UI on top of the companion above — **requires it to be installed and registered first**, the extension can't do anything on its own) — download the zip for your browser from [Releases](../../releases): `scanforge-extension-1.1.zip` for Chrome/Edge/Brave, `scanforge-firefox-extension-1.1.zip` for Firefox. Extract it, then:

- **Chrome / Edge / Brave**: open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**, select **Load unpacked**, choose the extracted folder.
- **Firefox**: open `about:debugging`, select **This Firefox** → **Load Temporary Add-on**, choose `manifest.json` inside the extracted folder. Permanent installation needs a Mozilla-signed package or publication through Firefox Add-ons.

### For developers

```bash
git clone <this repo>
cd scanforge
npm install
```

`npm install` registers native messaging automatically (`postinstall` runs `scripts/register-native-host.js`), detecting which of Chrome/Edge/Brave/Firefox are installed. Safe to re-run any time with `npm run register`.

```bash
npm run companion         # start the companion, http://127.0.0.1:3210
npm run build              # bundle the extension after any source change
npm run package:extension  # build both browser zips locally, into release/
```

Load the extension the same way as above, pointing **Load unpacked** at this repo's root (after `npm run build`) instead of a downloaded zip.

## Chapter 5: Audit workflows

### Audit the current page

1. Open the page you want to inspect.
2. Open ScanForge from the toolbar.
3. Review the audit configuration summary.
4. Select **Audit current page**.
5. Follow Mobile and Desktop progress.
6. Copy or download the finished Markdown report.

### Capture and audit multiple pages

1. Select **Start capture**.
2. Browse through the pages in the journey.
3. Stop capture when the journey is complete.
4. Select every captured page or choose a subset.
5. Start the captured-page audit.
6. Download the single combined report.

The header **Stop audit** action appears only while Lighthouse work is active and cancels only that audit. Page capture has its own **Start capture** / **Stop capture** control and remains independent.

## Chapter 6: Audit configuration

Open the gear button in the popup to change settings. The Windows companion and extension share the same configuration while connected.

### Lighthouse mode

- **Navigation:** Measures a fresh page load and supports the complete standard workflow.
- **Timespan:** Measures activity during an interaction window. Lighthouse limits the available categories.
- **Snapshot:** Inspects the loaded state. Lighthouse limits the available categories.

### Device

- **Mobile + Desktop:** Runs both profiles and creates one combined report.
- **Mobile only:** Uses Lighthouse's emulated mobile conditions.
- **Desktop only:** Uses the desktop viewport and network configuration.

### Page processing

- **Accurate:** Processes one selected page at a time for more stable measurements.
- **Fast:** Processes multiple pages concurrently. The worker count is capped by both your CPU (an estimate of physical cores, not hyperthreaded logical count) and free memory at the moment the run starts, re-checked every run, never above 8. On a memory- or CPU-constrained machine it can fall back to one page at a time — same as Accurate. It is quicker when headroom allows, but shared resources can make performance scores less consistent — the more pages run at once, the less reliable Performance scores get. Accessibility, Best Practices, and SEO are not timing-sensitive and stay reliable regardless.

### Categories

- Performance
- Accessibility
- Best Practices
- SEO
- Agentic Browsing, where supported by Lighthouse

## Chapter 7: Reports and notifications

### Report behavior

- A one-device, one-page run produces one report.
- A Mobile + Desktop run produces one combined report.
- A multi-page run produces one combined report for the selected pages and devices.
- Download filenames use audited page names to make files easy to identify.

### Browser notifications

ScanForge sends notifications when:

- An audit starts.
- A report is ready.
- An audit finishes with failed results.
- An audit stops.
- An audit cannot start.

Notifications appear through the browser in the Windows, macOS, or Linux notification center. Enable notifications for the browser in operating-system settings if they do not appear.

## Chapter 8: Development

### Project structure

```text
assets/                  Brand assets and generated runtime icons
bin/                     CLI executable (scanforge command)
scripts/                 Icon and packaging automation
src/companion/           Lighthouse server, worker, and report formatter
src/extension/           Popup, settings, background source, and storage
dist/                    Generated extension service worker
release/                 Generated browser packages
manifest.json            Chromium manifest
manifest.firefox.json    Firefox manifest
build.js                 Extension bundler
```

### Development loop

Start the companion server:

```bash
npm run companion
```

After changing extension code:

```bash
npm run build
```

Reload ScanForge from the browser's extension page and reopen the popup.

### Commands

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies. Also registers native messaging automatically (`postinstall`). |
| `npm run companion` | Start the local Lighthouse companion server. |
| `npm run build` | Bundle the extension background worker (`dist/background.js`) and the CLI (`dist/cli.js`). |
| `npm run register` / `npm run unregister` | Re-run or undo native-messaging registration manually. |
| `npm run assets:prepare` | Generate runtime PNG and ICO sizes. |
| `npm run package:extension` | Build Chromium and Firefox ZIP packages in `release/`. |

## Chapter 9: Packaging

Build both browser packages locally:

```bash
npm run package:extension
```

Outputs:

```text
release/scanforge-extension-1.1.zip
release/scanforge-firefox-extension-1.1.zip
```

The first package supports Chrome, Edge, and Brave. The second contains Firefox's separate background and extension-identity configuration.

## Chapter 10: Privacy and security

ScanForge is local-first:

- Reports remain in extension storage until the user clears them.
- The extension communicates with the companion on `127.0.0.1:3210`.
- ScanForge does not require an account.
- ScanForge does not upload reports to an external server.

Audited pages still perform their normal requests to their own servers and third-party services, just as they do when opened in a browser.

## Chapter 11: Troubleshooting

### Companion is not running

In your terminal, run `npx scanforge-audit` (or `npm run companion`). The extension badge will change to **Ready** (green dot).

### Port 3210 is already in use

Only one companion should run at a time. If ScanForge already reports **Ready**, use that instance. Otherwise, identify the process using port `3210`, stop it, and restart ScanForge.

### The browser does not accept the ZIP

Extract the ZIP first. Choose **Load unpacked** and select the extracted folder containing `manifest.json`.

### Changes do not appear

1. Run `npm run build`.
2. Reload ScanForge from the browser's extension page.
3. Close and reopen the popup.

### Notifications do not appear

Confirm that browser notifications are allowed, ScanForge has its notification permission, and Focus Assist or Do Not Disturb is not suppressing alerts.

### Performance scores vary

Lighthouse performance results are lab measurements. CPU activity, browser state, network conditions, and concurrent Fast-mode audits affect scores. Use Accurate mode, reduce background activity, and compare multiple runs for final validation.

### A finding is marked unmapped

Lighthouse can measure work without resolving it to a JavaScript callsite. ScanForge preserves the measurement and labels the evidence as partial. Use a Chrome DevTools Performance recording with production source maps for deeper investigation.

## Chapter 12: Project status and roadmap

### Available now

- Chromium and Firefox packages.
- Single-page and multi-page auditing.
- Mobile and Desktop combined reports.
- Accurate and Fast processing modes.
- Browser notification-center alerts.
- Pure cross-platform Node.js companion engine for Windows, macOS, and Linux.

### Planned

- Automated cross-browser and cross-platform release verification.
- Direct CLI mode for terminal and AI agent execution without browser extension.

## Contributing

ScanForge is open to contributions. Bug reports, compatibility findings, documentation improvements, report-format enhancements, UI refinements, and platform packaging work are welcome.

### Before starting

1. Check existing issues or discussions to avoid duplicating active work.
2. For a large feature or architectural change, open an issue describing the problem and proposed direction.
3. Keep changes focused. Avoid mixing unrelated refactors with a feature or bug fix.

### Local contribution workflow

1. Fork the repository and create a branch from the current default branch.
2. Install dependencies with `npm install`.
3. Make the smallest complete change that solves the issue.
4. Run the relevant verification commands:

```bash
npm run build
npm run package:extension
```

5. Test the affected workflow in every browser or operating system available to you.
6. Update documentation when behavior, commands, permissions, packaging, or platform support changes.
7. Open a pull request explaining the problem, solution, verification performed, and remaining limitations.

### Good contribution areas

- Lighthouse report extraction and Markdown quality.
- Chrome, Edge, Brave, and Firefox compatibility.
- Windows, macOS, and Linux companion packaging.
- Accessibility, responsive layout, and keyboard interaction.
- Audit reliability, cancellation, progress reporting, and resource use.
- Documentation, screenshots, examples, and troubleshooting.

### Contribution principles

- Preserve the local-first privacy model.
- Do not silently upload audited URLs, reports, or page data.
- Do not claim browser or platform support without testing it.
- Keep reports concise, evidence-based, and useful for implementation.
- Preserve user data and avoid destructive migrations.

---

<div align="center">
  <strong>Scan. Understand. Fix.</strong><br />
  Built around Lighthouse for developers, teams, and AI-assisted workflows.<br /><br />
  Contributions are welcome.
</div>
