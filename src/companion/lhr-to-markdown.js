const CATEGORY_ORDER = ['performance', 'accessibility', 'best-practices', 'seo', 'agentic-browsing'];
const METRICS = [
  ['first-contentful-paint', 'First Contentful Paint', '< 1.8 s'],
  ['largest-contentful-paint', 'Largest Contentful Paint', '< 2.5 s'],
  ['total-blocking-time', 'Total Blocking Time', '< 200 ms'],
  ['cumulative-layout-shift', 'Cumulative Layout Shift', '< 0.1'],
  ['speed-index', 'Speed Index', '< 3.4 s'],
  ['interactive', 'Time to Interactive', '< 3.8 s'],
];
const METRIC_IDS = new Set(METRICS.map(([id]) => id));
const MAX_FINDINGS = 12;
const MAX_ROWS = 6;

function clean(value) {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactUrl(value) {
  try {
    const url = new URL(value);
    const text = `${url.host}${url.pathname}${url.search}`;
    return text.length > 100 ? `${text.slice(0, 97)}...` : text;
  } catch {
    const text = clean(value);
    return text.length > 100 ? `${text.slice(0, 97)}...` : text;
  }
}

function formatNumber(value, key = '') {
  const lower = key.toLowerCase();
  if (lower.includes('byte') || lower.includes('size')) {
    if (Math.abs(value) >= 1048576) return `${(value / 1048576).toFixed(1)} MiB`;
    if (Math.abs(value) >= 1024) return `${(value / 1024).toFixed(1)} KiB`;
    return `${Math.round(value)} B`;
  }
  if (lower.includes('time') || lower.includes('duration') || lower.includes('timing') || lower.includes('wastedms')) {
    if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
    if (Math.abs(value) < 1) return `${value.toFixed(2)} ms`;
    if (Math.abs(value) < 10) return `${value.toFixed(1)} ms`;
    return `${Math.round(value)} ms`;
  }
  return Math.abs(value) >= 100 ? Math.round(value).toLocaleString('en-US') : Number(value.toFixed(2)).toString();
}

function simpleValue(value, key = '') {
  if (value == null) return '';
  if (typeof value === 'number') return formatNumber(value, key);
  if (typeof value !== 'object') return /url|origin/i.test(key) ? compactUrl(value) : clean(value);
  if (value.width != null && value.height != null) {
    return `${value.width} × ${value.height} px`;
  }
  if (value.type === 'source-location') {
    const position = [value.line == null ? null : value.line + 1, value.column == null ? null : value.column + 1].filter(v => v != null).join(':');
    return `${compactUrl(value.url || 'unknown source')}${position ? `:${position}` : ''}`;
  }
  if (value.type === 'node') return clean(value.snippet || value.selector || value.nodeLabel || 'DOM node');
  if (value.type === 'thumbnail') return compactUrl(value.url || value.src || 'image');
  if (value.type === 'url') return compactUrl(value.value || value.url);
  if (value.type === 'text') {
    if (value.value === '[unattributed]') return 'Unmapped browser/framework work (Lighthouse could not identify a JS callsite)';
    return clean(value.value);
  }
  if (value.type === 'code') return `\`${clean(value.value)}\``;
  for (const field of ['displayValue', 'value', 'url', 'origin', 'label', 'text', 'snippet', 'selector']) {
    if (value[field] != null && typeof value[field] !== 'object') return simpleValue(value[field], field);
  }
  return '';
}

function table(details) {
  if (!Array.isArray(details?.items) || !details.items.length) return [];
  const headings = (Array.isArray(details.headings) ? details.headings : [])
    .filter(h => h?.key && details.items.some(item => simpleValue(item?.[h.key], h.key)))
    .slice(0, 5);
  if (!headings.length) return [];
  const labels = headings.map(h => clean(h.label || h.text || h.key));
  const lines = [`| ${labels.join(' | ')} |`, `| ${labels.map(() => '---').join(' | ')} |`];
  for (const item of details.items.slice(0, MAX_ROWS)) {
    lines.push(`| ${headings.map(h => simpleValue(item?.[h.key], h.key)).join(' | ')} |`);
  }
  if (details.items.length > MAX_ROWS) {
    lines.push(`| +${details.items.length - MAX_ROWS} more affected items | ${labels.slice(1).map(() => '').join(' | ')} |`);
  }
  return lines;
}

function checklist(value) {
  const entries = Object.entries(value?.items || value || {}).filter(([, item]) => item && typeof item === 'object' && 'value' in item);
  const failed = entries.filter(([, item]) => item.value === false);
  const selected = failed.length ? failed : entries;
  return selected.slice(0, MAX_ROWS).map(([, item]) => `- ${item.value ? 'Passed' : 'Failed'}: ${clean(item.label)}`);
}

function networkChain(tree) {
  const roots = Object.values(tree?.chains || {});
  if (!roots.length) return [];
  const path = [];
  let node = roots.find(item => item.isLongest) || roots.sort((a, b) => (b.navStartToEndTime || 0) - (a.navStartToEndTime || 0))[0];
  while (node && path.length < MAX_ROWS) {
    path.push(node);
    const children = Object.values(node.children || {});
    node = children.find(item => item.isLongest) || children.sort((a, b) => (b.navStartToEndTime || 0) - (a.navStartToEndTime || 0))[0];
  }
  if (!path.length) return [];
  const uniquePath = path.filter((item, index) => index === 0 || item.url !== path[index - 1].url || item.navStartToEndTime !== path[index - 1].navStartToEndTime);
  return [
    `Longest critical chain: ${formatNumber(tree.longestChain?.duration || uniquePath.at(-1)?.navStartToEndTime || 0, 'duration')}`,
    '', '| Request | End time | Transfer |', '| --- | --- | --- |',
    ...uniquePath.map(item => `| ${compactUrl(item.url)} | ${formatNumber(item.navStartToEndTime || 0, 'duration')} | ${formatNumber(item.transferSize || 0, 'bytes')} |`),
  ];
}

function detailEvidence(details) {
  if (!details) return [];
  if (details.type === 'table' || details.type === 'opportunity') return table(details);
  const blocks = [];
  const items = Array.isArray(details.items) ? details.items : [];
  for (const item of items) {
    const title = clean(item.title);
    const value = item.value;
    let content = [];
    if (item.type === 'table') content = table(item);
    else if (item.type === 'checklist') content = checklist(item);
    else if (item.type === 'node') {
      const node = simpleValue(item, 'node');
      if (node) content = [`Affected element: \`${node}\``];
    } else if (value?.type === 'table') content = table(value);
    else if (value?.type === 'network-tree') content = networkChain(value);
    else if (value?.type === 'checklist') content = checklist(value);
    else if (value?.type === 'node') content = [`Affected element: \`${simpleValue(value, 'node')}\``];
    else if (item.type === 'list-section' && typeof value === 'string' && value) content = [clean(value)];
    if (content.length) {
      if (title) blocks.push(`**${title}**`, '');
      blocks.push(...content, '');
    }
  }
  return blocks.at(-1) === '' ? blocks.slice(0, -1) : blocks;
}

function conciseDescription(description = '') {
  const sentences = clean(description).match(/.*?(?:[.!?](?=\s|$)|$)/g)?.filter(Boolean) || [];
  return sentences.slice(0, 2).map(sentence => sentence.trim()).join(' ');
}

function recommendations(audit) {
  const title = (audit.title || '').toLowerCase();
  const id = (audit.id || '').toLowerCase();

  // Images & Media
  if (id.includes('modern-image-formats') || title.includes('modern image format')) {
    return ['Convert PNG/JPEG assets to next-gen formats (WebP or AVIF) for 30-70% smaller file sizes without quality loss.', 'Use `<picture>` elements to serve AVIF with WebP/JPEG fallbacks.'];
  }
  if (id.includes('properly-size-images') || title.includes('properly size images')) {
    return ['Provide responsive variants via `srcset` and `sizes` attributes matching display breakpoints.', 'Ensure server or CDN dynamically resizes images to match container dimensions.'];
  }
  if (id.includes('unsized-images') || title.includes('explicit width and height')) {
    return ['Add explicit `width` and `height` attributes to all `<img>` and `<video>` tags (or CSS `aspect-ratio`) to prevent Cumulative Layout Shift (CLS).'];
  }
  if (id.includes('offscreen-images') || title.includes('defer offscreen images')) {
    return ['Add `loading="lazy"` and `decoding="async"` to all images below the initial viewportfold.', 'Do NOT lazy-load the above-the-fold LCP image.'];
  }
  if (id.includes('image-alt') || title.includes('alt attribute')) {
    return ['Add descriptive `alt="..."` attributes to informative images, or `alt=""` with `aria-hidden="true"` for purely decorative elements.'];
  }

  // Performance & Critical Path
  if (title.includes('forced reflow')) {
    return ['Batch DOM reads before DOM writes.', 'Inspect attributed source locations and avoid reading layout immediately after changing styles or the DOM.', 'For unmapped time, record a Chrome DevTools Performance trace with production source maps enabled and inspect Layout/Recalculate Style events.'];
  }
  if (title.includes('lcp request discovery') || id.includes('preload-lcp-image')) {
    return ['Ensure the LCP hero image exists directly in the initial HTML markup.', 'Add `<link rel="preload" fetchpriority="high" as="image" href="...">` in `<head>` to start image download immediately.'];
  }
  if (title.includes('lcp breakdown')) {
    return ['Optimize the largest phase first: server/cache work for TTFB, preload/priority for load delay, image compression for load duration, or rendering/CSS work for render delay.'];
  }
  if (title.includes('network dependency') || id.includes('critical-request-chains')) {
    return ['Shorten the longest critical chain by inlining critical CSS, deferring non-critical scripts, and eliminating unnecessary resource redirects.', 'Only preconnect to origins needed during initial above-the-fold rendering.'];
  }
  if (title.includes('font-display') || id.includes('font-display')) {
    return ['Add `font-display: swap` or `font-display: optional` to all `@font-face` rules to ensure text remains visible during webfont downloads.'];
  }
  if (title.includes('render-blocking') || id.includes('render-blocking-resources')) {
    return ['Inline critical above-the-fold CSS and mark non-critical stylesheet links with `media="print"` / async loaders.', 'Add `defer` or `type="module"` to all `<script>` tags.'];
  }
  if (title.includes('unused css') || id.includes('unused-css-rules')) {
    return ['Remove unused stylesheet rules or split CSS by route/component.', 'Load non-critical component styles dynamically after initial render.'];
  }
  if (title.includes('unused javascript') || id.includes('unused-javascript')) {
    return ['Remove unused npm dependencies, tree-shake dead exports, and split large bundles with dynamic `import()`.', 'Defer analytics, tracking, and widget scripts until user interaction.'];
  }
  if (title.includes('long tasks') || title.includes('main-thread') || id.includes('long-tasks')) {
    return ['Break long JavaScript tasks (>50ms) into microtasks with `scheduler.yield()` or `setTimeout(..., 0)` to keep the UI thread responsive.'];
  }
  if (title.includes('layout shift') || id.includes('layout-shifts')) {
    return ['Reserve layout space with fixed height placeholders or skeleton loaders for dynamic ads, embeds, and injected DOM containers.'];
  }
  if (title.includes('server response time') || id.includes('server-response-time')) {
    return ['Optimize backend database queries, implement Redis/Memcached object caching, or use Edge CDN caching to keep TTFB under 800ms.'];
  }
  if (title.includes('cache') || id.includes('uses-long-cache-ttl')) {
    return ['Set `Cache-Control: public, max-age=31536000, immutable` for content-hashed static assets (JS, CSS, fonts, images).', 'Never apply long immutable caching to root HTML documents.'];
  }
  if (title.includes('third-party') || id.includes('third-party-summary')) {
    return ['Audit third-party integrations, remove redundant analytics trackers, and host critical libraries locally.'];
  }
  if (title.includes('dom size') || id.includes('dom-size')) {
    return ['Keep total DOM elements below 800 and DOM depth below 32 by virtualizing large repeating lists and paginating tables.'];
  }

  // Accessibility
  if (title.includes('contrast') || id.includes('color-contrast')) {
    return ['Increase foreground/background contrast to meet WCAG AA standards (minimum 4.5:1 for standard text, 3:1 for large text).'];
  }
  if (title.includes('heading') || id.includes('heading-order')) {
    return ['Ensure headings follow a logical hierarchy (`<h1>` followed by `<h2>`, without skipping levels). Preserve visual appearance with CSS utility classes.'];
  }
  if (title.includes('main landmark') || id.includes('landmark-one-main')) {
    return ['Wrap page primary content in exactly one `<main>` element, keeping header, navigation, and footer outside it.'];
  }
  if (title.includes('button-name') || title.includes('link-name') || id.includes('link-name') || id.includes('button-name')) {
    return ['Provide accessible names for interactive elements using text content, `aria-label`, or `aria-labelledby`.'];
  }

  // Best Practices & SEO
  if (title.includes('charset') || id.includes('charset')) {
    return ['Add `<meta charset="utf-8">` as the first element inside `<head>`, within the first 1024 bytes of the HTML response.'];
  }
  if (title.includes('meta description') || id.includes('meta-description')) {
    return ['Add a unique, concise `<meta name="description" content="...">` tag (between 50 and 160 characters) inside `<head>`.'];
  }
  if (title.includes('viewport') || id.includes('viewport')) {
    return ['Include `<meta name="viewport" content="width=device-width, initial-scale=1">` in `<head>` to enable mobile-responsive layout scaling.'];
  }
  if (title.includes('tap-targets') || id.includes('tap-targets')) {
    return ['Ensure touch target elements (buttons, links) are at least 48 × 48 px or have at least 8 px spacing between them.'];
  }
  if (title.includes('crawlable') || id.includes('crawlable-anchors')) {
    return ['Use valid `<a href="...">` anchor elements with real URLs instead of `href="#"` or `javascript:void(0)` to allow search engine crawlers to discover subpages.'];
  }

  return [];
}

function isFinding(id, audit) {
  if (METRIC_IDS.has(id) || !audit) return false;
  if (['numeric', 'binary'].includes(audit.scoreDisplayMode)) return audit.score != null && audit.score < 0.9;
  return id === 'lcp-breakdown-insight' && Array.isArray(audit.details?.items) && audit.details.items.length > 0;
}

function estimatedSavings(audit) {
  const ms = audit.details?.overallSavingsMs || 0;
  const bytes = audit.details?.overallSavingsBytes || 0;
  return { ms, bytes, rank: ms * 1000000 + bytes };
}

function environment(lhr, device) {
  const settings = lhr.configSettings || {};
  const screen = settings.screenEmulation || {};
  const throttling = settings.throttling || {};
  return {
    device: device || settings.formFactor || 'unknown',
    finalUrl: clean(lhr.finalUrl), requestedUrl: clean(lhr.requestedUrl || lhr.finalUrl),
    fetchTime: clean(lhr.fetchTime), lighthouseVersion: clean(lhr.lighthouseVersion),
    userAgent: clean(lhr.environment?.hostUserAgent || lhr.userAgent || ''),
    viewport: screen.width && screen.height ? `${screen.width} x ${screen.height} @${screen.deviceScaleFactor || 1}x` : 'Not reported',
    throttlingMethod: clean(settings.throttlingMethod || 'Not reported'),
    network: throttling.rttMs != null ? `${throttling.rttMs} ms RTT, ${throttling.throughputKbps || '?'} Kbps` : 'Not reported',
    cpu: throttling.cpuSlowdownMultiplier ? `${throttling.cpuSlowdownMultiplier}x slowdown` : 'Not reported',
    benchmarkIndex: lhr.environment?.benchmarkIndex ?? null,
  };
}

function extractMetricDisplay(id, audit) {
  if (!audit) return null;
  if (audit.displayValue != null && audit.displayValue !== '') return clean(audit.displayValue);
  if (audit.numericValue != null) {
    if (id === 'cumulative-layout-shift') return Number(audit.numericValue.toFixed(3)).toString();
    if (id.includes('time') || id.includes('paint') || id === 'speed-index' || id === 'interactive') {
      return audit.numericValue >= 1000 ? `${(audit.numericValue / 1000).toFixed(1)} s` : `${Math.round(audit.numericValue)} ms`;
    }
    return formatNumber(audit.numericValue, id);
  }
  if (audit.errorMessage) return `Error: ${clean(audit.errorMessage)}`;
  return null;
}

export function lhrToReportData(lhr, options = {}) {
  const categories = CATEGORY_ORDER.flatMap(key => {
    const category = lhr.categories?.[key];
    return category ? [{ id: key, title: clean(category.title), score: category.score }] : [];
  });
  const metrics = METRICS.flatMap(([id, label, target]) => {
    const audit = lhr.audits?.[id];
    const val = extractMetricDisplay(id, audit);
    return val ? [{ id, label, value: val, target, score: audit?.score ?? null }] : [];
  });
  const categoriesByAudit = new Map();
  for (const key of CATEGORY_ORDER) {
    const category = lhr.categories?.[key];
    for (const ref of category?.auditRefs || []) if (!categoriesByAudit.has(ref.id)) categoriesByAudit.set(ref.id, category.title);
  }
  const findings = [...categoriesByAudit]
    .map(([id, category]) => {
      const audit = lhr.audits?.[id];
      if (!isFinding(id, audit)) return null;
      const evidence = detailEvidence(audit.details);
      return {
        id, title: clean(audit.title), category: clean(category), score: audit.score,
        severity: audit.score < 0.5 ? 'Fix' : 'Improve', displayValue: clean(audit.displayValue),
        description: conciseDescription(audit.description), evidence, actions: recommendations(audit),
        savings: estimatedSavings(audit), confidence: !evidence.length
          ? 'Evidence incomplete - inspect the Lighthouse HTML report or reproduce the audit before changing code.'
          : evidence.some(line => /could not identify a JS callsite/i.test(line))
            ? 'Partial evidence - Lighthouse measured the work but could not attribute all of it to a JavaScript callsite.'
            : 'Evidence available',
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.savings.rank - a.savings.rank || a.score - b.score);
  const ids = [...categoriesByAudit.keys()];
  return {
    title: clean(options.title || lhr.finalUrl), url: clean(lhr.finalUrl), environment: environment(lhr, options.device),
    categories, metrics, findings, summary: { passed: ids.filter(id => lhr.audits?.[id]?.score >= 0.9).length, actionable: findings.length, reviewed: ids.length },
  };
}

function renderEnvironment(lines, env) {
  lines.push('## Audit environment', '', '| Setting | Value |', '| --- | --- |',
    `| Device | ${clean(env.device)} |`, `| Requested URL | ${clean(env.requestedUrl)} |`, `| Final URL | ${clean(env.finalUrl)} |`,
    `| Viewport | ${clean(env.viewport)} |`, `| Throttling | ${clean(env.throttlingMethod)} |`, `| Network | ${clean(env.network)} |`,
    `| CPU | ${clean(env.cpu)} |`, `| User agent | ${clean(env.userAgent || 'Not reported')} |`,
    `| Audit duration | ${clean(env.duration || 'Not reported')} |`, `| Lighthouse | v${clean(env.lighthouseVersion)} |`, `| Generated | ${clean(env.fetchTime)} |`);
}

function renderFinding(lines, finding, heading = '###') {
  const result = finding.displayValue ? ` - ${finding.displayValue}` : '';
  lines.push(`${heading} ${finding.severity}: ${finding.title}${result}`, '', `Category: ${finding.category}`, '', finding.description);
  if (finding.savings.ms || finding.savings.bytes) {
    const values = [];
    if (finding.savings.ms) values.push(formatNumber(finding.savings.ms, 'duration'));
    if (finding.savings.bytes) values.push(formatNumber(finding.savings.bytes, 'bytes'));
    lines.push('', `Estimated savings: ${values.join(' and ')}`);
  }
  if (finding.evidence.length) lines.push('', '**Evidence**', '', ...finding.evidence);
  lines.push('', `Confidence: ${finding.confidence}`);
  if (finding.actions.length) lines.push('', '**Recommended fix**', '', ...finding.actions.map(action => `- ${action}`));
  if (finding.evidence.some(line => /_next\/static\/chunks|webpack|assets\/.*\.js/i.test(line))) {
    lines.push('', 'Source note: this is a compiled bundle location. Enable production source maps or trace it back to the source module before editing.');
  }
  lines.push('');
}

export function reportDataToMarkdown(data) {
  const lines = [`# Lighthouse Report - ${data.url}`, ''];
  lines.push('## Scores', '', '| Category | Score |', '| --- | --- |');
  for (const category of data.categories) lines.push(`| ${category.title} | ${category.score == null ? 'N/A' : `${Math.round(category.score * 100)}%`} |`);

  lines.push('', '## Key metrics', '', '| Metric | Result | Target |', '| --- | --- | --- |');
  for (const metric of data.metrics) lines.push(`| ${metric.label} | ${metric.value} | ${metric.target} |`);

  lines.push('', '## Actionable findings', '');
  if (!data.findings.length) lines.push('No scored Lighthouse failures or warnings were found.', '');
  for (const finding of data.findings.slice(0, MAX_FINDINGS)) renderFinding(lines, finding);
  if (data.findings.length > MAX_FINDINGS) lines.push(`${data.findings.length - MAX_FINDINGS} lower-priority findings omitted.`, '');
  lines.push('## Check summary', '', `${data.summary.passed} passed; ${data.summary.actionable} actionable findings; ${data.summary.reviewed} category checks reviewed.`, '');
  renderEnvironment(lines, data.environment);
  return lines.join('\n');
}

export function lhrToMarkdown(lhr, options = {}) {
  return reportDataToMarkdown(lhrToReportData(lhr, options));
}

export function reportsToCombinedMarkdown(reports) {
  const groups = new Map();
  for (const report of reports.filter(Boolean)) {
    const key = report.captureId || report.url;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(report);
  }
  const output = ['# ScanForge combined Lighthouse report', ''];
  for (const pageReports of groups.values()) {
    const first = pageReports[0];
    output.push(`## ${clean(first.title || first.url)}`, '', clean(first.url), '', '### Mobile vs Desktop scores', '');
    const mobile = pageReports.find(report => report.device === 'mobile')?.data;
    const desktop = pageReports.find(report => report.device === 'desktop')?.data;
    output.push('| Category | Mobile | Desktop |', '| --- | --- | --- |');
    for (const id of CATEGORY_ORDER) {
      const m = mobile?.categories.find(item => item.id === id);
      const d = desktop?.categories.find(item => item.id === id);
      if (!m && !d) continue;
      const mScore = m ? (m.score != null ? `${Math.round(m.score * 100)}%` : 'Error') : 'Not tested';
      const dScore = d ? (d.score != null ? `${Math.round(d.score * 100)}%` : 'Error') : 'Not tested';
      output.push(`| ${m?.title || d?.title || id} | ${mScore} | ${dScore} |`);
    }
    output.push('', '### Mobile vs Desktop metrics', '', '| Metric | Mobile | Desktop | Target |', '| --- | --- | --- | --- |');
    for (const [, label, target] of METRICS) {
      const m = mobile?.metrics.find(item => item.label === label);
      const d = desktop?.metrics.find(item => item.label === label);
      if (m || d) output.push(`| ${label} | ${m?.value || '—'} | ${d?.value || '—'} | ${target} |`);
    }

    const failures = pageReports.filter(report => !report.ok);
    if (failures.length) {
      output.push('', '### Audit failures', '');
      for (const report of failures) output.push(`- ${report.device}: ${clean(report.error || 'Audit failed without an error message.')}`);
    }

    const merged = new Map();
    for (const report of pageReports.filter(item => item.data)) for (const finding of report.data.findings) {
      if (!merged.has(finding.id)) merged.set(finding.id, { ...finding, devices: [], evidenceByDevice: {} });
      const item = merged.get(finding.id);
      item.devices.push(report.device);
      item.evidenceByDevice[report.device] = finding.evidence;
      if (finding.savings.rank > item.savings.rank) item.savings = finding.savings;
    }
    const findings = [...merged.values()].sort((a, b) => b.savings.rank - a.savings.rank || a.score - b.score);
    output.push('', '### Top priorities', '');
    if (!findings.length) output.push('No actionable findings.', '');
    findings.slice(0, MAX_FINDINGS).forEach((finding, index) => {
      const devices = finding.devices.includes('mobile') && finding.devices.includes('desktop') ? 'Both' : finding.devices.map(clean).join(', ');
      output.push(`${index + 1}. **${finding.title}** - ${devices}`);
    });
    for (const finding of findings.slice(0, MAX_FINDINGS)) {
      const devices = finding.devices.includes('mobile') && finding.devices.includes('desktop') ? 'Both devices' : finding.devices.map(device => `${device[0].toUpperCase()}${device.slice(1)} only`).join(', ');
      output.push('', `### ${finding.severity}: ${finding.title}`, '', `Affects: ${devices}`, '', finding.description);
      for (const device of finding.devices) {
        const evidence = finding.evidenceByDevice[device];
        if (evidence?.length) output.push('', `**${device[0].toUpperCase()}${device.slice(1)} evidence**`, '', ...evidence);
      }
      output.push('', `Confidence: ${finding.confidence}`);
      if (finding.actions.length) output.push('', '**Recommended fix**', '', ...finding.actions.map(action => `- ${action}`));
    }
    output.push('', '### Audit environments', '');
    for (const report of pageReports.filter(item => item.data)) {
      const env = report.data.environment;
      output.push(`- ${report.device}: ${env.viewport}; ${env.throttlingMethod}; ${env.network}; CPU ${env.cpu}; duration ${env.duration || 'Not reported'}; Lighthouse v${env.lighthouseVersion}`);
    }
    output.push('', '---', '');
  }
  return output.join('\n');
}
