import { forceGC } from '../companion/perf-patch.js';
import lighthouse, { snapshot as lighthouseSnapshot, startTimespan } from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import log from 'lighthouse-logger';
import * as chromeLauncher from 'chrome-launcher';
import puppeteer from 'puppeteer-core';
import { lhrToReportData, reportDataToMarkdown, reportsToCombinedMarkdown } from '../companion/lhr-to-markdown.js';
import { closeChromeSilently } from '../companion/companion-bus.js';
import { assertSafeAuditUrl } from '../companion/security.js';

const AUDIT_TIMEOUT_MS = Math.max(30000, Number(process.env.SCANFORGE_AUDIT_TIMEOUT_MS || 180000));

function withAuditTimeout(promise, onTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(async () => {
      await Promise.resolve(onTimeout?.()).catch(() => {});
      reject(new Error(`Lighthouse did not finish within ${Math.round(AUDIT_TIMEOUT_MS / 1000)} seconds and was stopped.`));
    }, AUDIT_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runLighthouse(pageUrl, device, mode, categories, chrome) {
  // locale: 'en-US' pins Lighthouse's output strings regardless of the host machine's locale —
  // recommendations() below matches audit titles against hardcoded English substrings, which
  // would silently stop matching (no error, just empty recommendations) under any other locale.
  // disableFullPageScreenshot: the report generator never reads screenshot data, and this run's
  // whole LHR gets discarded right after — no reason to make Lighthouse hold that extra weight.
  const flags = { onlyCategories: categories, logLevel: 'info', maxWaitForLoad: 60000, locale: 'en-US', disableFullPageScreenshot: true };
  const config = device === 'desktop' ? desktopConfig : undefined;
  if (mode === 'navigation') return lighthouse(pageUrl, { ...flags, port: chrome.port }, config);

  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}`, defaultViewport: null });
  const existingPages = await browser.pages();
  const page = existingPages[0] || await browser.newPage();
  try {
    await page.goto(pageUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    if (mode === 'snapshot') return lighthouseSnapshot(page, { flags, config });
    const timespan = await startTimespan(page, { flags, config });
    await page.evaluate(async () => {
      const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      scrollTo({ top: max, behavior: 'instant' });
      await new Promise(resolve => setTimeout(resolve, 1500));
      scrollTo({ top: 0, behavior: 'instant' });
      await new Promise(resolve => setTimeout(resolve, 1500));
    });
    return timespan.endTimespan();
  } finally {
    // Keep Chrome running across audits
  }
}

export async function executeAuditBatch({
  pages = [],
  deviceOption = 'both',
  lighthouseMode = 'navigation',
  categories = ['performance', 'accessibility', 'best-practices', 'seo'],
  allowPrivateNetworks = false,
  onProgress = () => {},
  onPageComplete = () => {},
  isCancelled = () => false,
}) {
  const devices = deviceOption === 'mobile' ? ['mobile'] : deviceOption === 'desktop' ? ['desktop'] : ['mobile', 'desktop'];
  const reports = [];

  // One Chrome instance per device type, reused across every page — not one per worker (the
  // corruption that fix addressed was specifically mobile and desktop sharing a single instance
  // and leaving stale screen-emulation state behind), and not one per individual audit either
  // (that was the correct fix but paid Chrome's full cold-start cost on every single page,
  // turning multi-page runs from one launch total into 2x-the-page-count launches).
  const chromeByDevice = {};
  async function getChrome(device) {
    if (!chromeByDevice[device]) {
      chromeByDevice[device] = await chromeLauncher.launch({
        chromeFlags: ['--headless=new', '--no-first-run', '--disable-default-apps', '--disable-extensions'],
        logLevel: 'silent',
      });
    }
    return chromeByDevice[device];
  }
  async function discardChrome(device) {
    const chrome = chromeByDevice[device];
    delete chromeByDevice[device];
    if (chrome) await closeChromeSilently(chrome);
  }

  try {
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    if (isCancelled()) break;
    const page = pages[pageIndex];
    await assertSafeAuditUrl(page.url, allowPrivateNetworks);

    for (const device of devices) {
      if (isCancelled()) break;
      onProgress({ pageId: page.id, device, percent: 5, stage: `Starting ${device} audit...` });

      let completedSteps = 0;
      const onStatus = ([, message]) => {
        if (typeof message !== 'string') return;
        let percent = 10;
        if (message.startsWith('Navigating')) percent = 20;
        else if (message.startsWith('Getting artifact:')) percent = 35;
        else if (message.startsWith('Analyzing')) percent = 65;
        else if (message.startsWith('Auditing:')) percent = Math.min(95, 70 + completedSteps);
        onProgress({ pageId: page.id, device, percent, stage: message });
      };
      const onStatusEnd = ([, message]) => {
        if (typeof message === 'string' && (message.startsWith('Getting artifact:') || message.startsWith('Auditing:'))) {
          completedSteps += 1;
        }
      };

      log.events.on('status', onStatus);
      log.events.on('statusEnd', onStatusEnd);

      const startedAt = Date.now();
      try {
        const chrome = await getChrome(device);

        const result = await withAuditTimeout(
          runLighthouse(page.url, device, lighthouseMode, categories, chrome),
          () => discardChrome(device)
        );

        if (!result) throw new Error('Lighthouse returned no result.');

        const data = lhrToReportData(result.lhr, { device, title: page.title || page.url });
        data.environment.duration = `${((Date.now() - startedAt) / 1000).toFixed(1)} s`;
        const scores = Object.fromEntries(categories.map(k => [k, result.lhr.categories[k]?.score ?? null]));

        // Same 150MB+ raw trace/LHR release as the companion's own workers — matters most
        // here when many URLs are passed in one direct invocation before the process exits.
        result.lhr = null;
        forceGC();

        const report = {
          ok: true,
          id: `${page.id}-${device}`,
          captureId: page.id,
          device,
          title: page.title || page.url,
          url: page.url,
          markdown: reportDataToMarkdown(data),
          data,
          scores,
        };
        reports.push(report);
        onProgress({ pageId: page.id, device, percent: 100, stage: 'Complete' });
      } catch (err) {
        const errMsg = isCancelled() ? 'Audit stopped by user.' : err.message;
        reports.push({
          ok: false,
          id: `${page.id}-${device}`,
          captureId: page.id,
          device,
          title: page.title || page.url,
          url: page.url,
          error: errMsg,
        });
        onProgress({ pageId: page.id, device, percent: 100, stage: isCancelled() ? 'Stopped' : 'Failed', error: errMsg });
        // A failed/crashed Chrome instance shouldn't be trusted for the next page's audit of
        // this device — discard it so getChrome() launches fresh next time. The timeout path
        // already discards via withAuditTimeout's onTimeout callback above.
        await discardChrome(device);
      } finally {
        log.events.removeListener('status', onStatus);
        log.events.removeListener('statusEnd', onStatusEnd);
      }
    }

    onPageComplete(page.id);
  }
  } finally {
    await Promise.all(Object.keys(chromeByDevice).map(discardChrome));
  }

  if (reports.length) {
    reports[0].combinedMarkdown = reportsToCombinedMarkdown(reports);
    forceGC();
  }

  return reports;
}
