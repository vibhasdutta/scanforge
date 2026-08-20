import { listCaptures, clearCaptures, getLatestReports, clearLatestReports, getAuditSettings, DEFAULT_AUDIT_SETTINGS } from './storage.js';

const $ = id => document.getElementById(id);
const runBtn = $('run');
const runBatchBtn = $('run-batch');
const stopAllBtn = $('stop-all');
const captureToggleBtn = $('capture-toggle');
const clearCapturesBtn = $('clear-captures');
const captureCountEl = $('capture-count');
const captureListEl = $('capture-list');
const selectAllEl = $('select-all');
const selectionToolsEl = $('selection-tools');
const statusEl = $('status');
const errorEl = $('error');
const progressWrap = $('progress-wrap');
const selectedPagesEl = $('selected-pages');
const runModeEl = $('run-mode');
const progressPagesEl = $('progress-pages');
const reportsSection = $('reports-section');
const reportSelect = $('report-select');
const reportEl = $('report');
const copyBtn = $('copy');
const downloadBtn = $('download');
const clearReportsBtn = $('clear-reports');
const brandLogo = $('brand-logo');
const runSelectionEl = $('run-selection');
const settingsBtn = $('settings');
const companionBadge = $('companion-badge');
const companionLabel = $('companion-label');
const companionStartBtn = $('companion-start-btn');
const companionRestartBtn = $('companion-restart-btn');
const companionStopBtn = $('companion-stop-btn');
const companionActionsEl = $('companion-actions');

let reports = [];
let progressTimer = null;
let selectedCaptureIds = new Set();
let isCapturing = false;
let isAuditRunning = false;
let auditSettings = { ...DEFAULT_AUDIT_SETTINGS, categories: [...DEFAULT_AUDIT_SETTINGS.categories] };
let companionTimer = null;
stopAllBtn.textContent = 'Stop audit';

const STATUS_SVGS = {
  ready: 'assets/Scanforge-ready.svg',
  auditing: 'assets/scanforge-auditing.svg',
  starting: 'assets/scanforge-auditing.svg',
  stopping: 'assets/scanforge-stopping.svg',
  offline: 'assets/scanforge-offline.svg',
  error: 'assets/scanforge-error.svg',
  main: 'assets/scanforge-main.svg',
};

function renderCompanionStatus(state = 'offline') {
  const normalized = ['ready', 'auditing', 'starting', 'stopping', 'error'].includes(state) ? state : 'offline';
  const labels = {
    ready: 'Ready',
    auditing: 'Auditing',
    starting: 'Starting…',
    stopping: 'Stopping…',
    error: 'Error',
    offline: 'Offline',
  };
  companionBadge.dataset.state = normalized;
  companionLabel.textContent = labels[normalized];
  
  if (brandLogo) {
    brandLogo.dataset.state = normalized;
    const svgPath = STATUS_SVGS[normalized] || STATUS_SVGS.main;
    brandLogo.src = chrome.runtime.getURL(svgPath);
  }

  if (normalized === 'ready' || normalized === 'offline') {
    isAuditRunning = false;
    updateStopVisibility();
  } else if (normalized === 'auditing') {
    isAuditRunning = true;
    updateStopVisibility();
  }

  if (companionStartBtn && companionRestartBtn && companionStopBtn) {
    const isOffline = normalized === 'offline';
    const isStarting = normalized === 'starting';
    const isStopping = normalized === 'stopping';
    const isBusy = normalized === 'auditing' || isStarting || isStopping;

    companionStartBtn.classList.toggle('hidden', !isOffline && !isStarting);
    if (isOffline || isStarting) {
      companionStartBtn.disabled = isStarting;
      companionStartBtn.textContent = isStarting ? 'Starting…' : 'Start';
      companionRestartBtn.classList.add('hidden');
      companionStopBtn.classList.add('hidden');
    } else {
      companionRestartBtn.classList.toggle('hidden', isBusy);
      companionStopBtn.classList.remove('hidden');
      companionRestartBtn.disabled = isBusy;
      companionRestartBtn.textContent = 'Restart';
      companionStopBtn.disabled = isStopping;
      companionStopBtn.textContent = isStopping ? 'Stopping…' : 'Stop';
    }
  }
}

async function refreshCompanionStatus() {
  const response = await chrome.runtime.sendMessage({ type: 'CHECK_COMPANION' }).catch(() => null);
  if (response?.ok && response.status?.pid) {
    companionBadge.title = `ScanForge Companion\nPID: ${response.status.pid}\nName: ${response.status.processTitle || 'scanforge-companion'}\nPort: 3210`;
  } else {
    companionBadge.title = 'ScanForge Companion (Offline)';
  }
  renderCompanionStatus(response?.ok ? response.status?.state : 'offline');
  return response;
}

async function dispatchCompanionControl(action) {
  renderCompanionStatus(action === 'stop' ? 'stopping' : 'starting');
  if (companionStartBtn) companionStartBtn.disabled = true;
  if (companionRestartBtn) companionRestartBtn.disabled = true;
  if (companionStopBtn) companionStopBtn.disabled = true;
  errorEl.textContent = '';

  const response = await chrome.runtime.sendMessage({ type: 'COMPANION_CONTROL', action }).catch(err => ({ ok: false, error: err.message }));
  if (response?.ok) {
    await refreshCompanionStatus();
  } else {
    showError(response?.error || `Could not ${action} companion. Try running "scanforge" in your terminal.`);
    renderCompanionStatus('offline');
  }
}

if (companionStartBtn) companionStartBtn.addEventListener('click', () => dispatchCompanionControl('start'));
if (companionRestartBtn) companionRestartBtn.addEventListener('click', () => dispatchCompanionControl('restart'));
if (companionStopBtn) companionStopBtn.addEventListener('click', () => dispatchCompanionControl('stop'));

function updateStopVisibility() {
  if (stopAllBtn) {
    stopAllBtn.classList.toggle('hidden', !isAuditRunning);
  }
  if (companionActionsEl) {
    companionActionsEl.classList.toggle('hidden', isAuditRunning);
  }
}

function auditMode() {
  return auditSettings.processingMode === 'fast' ? 'fast' : 'accurate';
}

function lighthouseOptions() {
  const mode = auditSettings.lighthouseMode;
  const device = auditSettings.device;
  const categories = auditSettings.categories;
  if (!categories.length) throw new Error('Select at least one audit category.');
  return { mode, device, categories, allowPrivateNetworks: !!auditSettings.allowPrivateNetworks };
}

function renderRunSelection() {
  try {
    const options = lighthouseOptions();
    const device = options.device === 'both' ? '2 devices' : options.device;
    runSelectionEl.textContent = `${options.mode} / ${device} / ${options.categories.length} categories / ${auditMode()}`;
    runBtn.disabled = false;
  } catch (error) {
    runSelectionEl.textContent = error.message;
    runBtn.disabled = true;
  }
}

function showError(message) {
  statusEl.textContent = '';
  errorEl.textContent = message;
}

function hasCompleteDevicePairs(items) {
  if (!items.length || items.some(report => !report.ok)) return false;
  const pairs = new Map();
  for (const report of items) {
    const key = report.captureId || report.url;
    if (!pairs.has(key)) pairs.set(key, new Set());
    pairs.get(key).add(report.device);
  }
  return [...pairs.values()].every(devices => devices.has('mobile') && devices.has('desktop'));
}

function combinedMarkdown(items) {
  const generated = items.find(report => report.combinedMarkdown)?.combinedMarkdown;
  if (generated) return generated;
  return items.map(report => {
    const device = report.device === 'desktop' ? 'Desktop' : 'Mobile';
    return report.ok
      ? `# ${report.title || report.url} — ${device}\n\n${report.markdown}`
      : `# ${report.title || report.url} — ${device}\n\nAudit failed: ${report.error}`;
  }).join('\n\n---\n\n');
}

function renderReports(selected = 'combined') {
  reportSelect.replaceChildren();
  if (!reports.length) {
    reportsSection.classList.add('hidden');
    reportEl.value = '';
    copyBtn.disabled = true;
    downloadBtn.disabled = true;
    return;
  }
  reportsSection.classList.remove('hidden');
  const generatedCombined = reports.find(report => report.combinedMarkdown)?.combinedMarkdown;
  const combinedOnly = !!generatedCombined && reports.length > 1;
  if (combinedOnly) reportSelect.add(new Option(`Combined report (${reports.length} audits)`, 'combined'));
  if (!combinedOnly) {
  reports.forEach((report, index) => {
    const device = report.device === 'desktop' ? 'Desktop' : 'Mobile';
    reportSelect.add(new Option(`${device}: ${report.title || report.url}`, String(index)));
  });
  }
  reportSelect.classList.toggle('hidden', combinedOnly || reports.length === 1);
  reportSelect.value = combinedOnly ? 'combined' : '0';
  const choice = reportSelect.value;
  const report = reports[Number(choice)];
  reportEl.value = choice === 'combined' ? combinedMarkdown(reports) : (report?.ok ? report.markdown : combinedMarkdown([report]));
  copyBtn.disabled = !reportEl.value;
  downloadBtn.disabled = !reportEl.value;
}

function deviceRow(label, device) {
  const row = document.createElement('div'); row.className = 'device-progress';
  const name = document.createElement('span'); name.textContent = label;
  const track = document.createElement('div'); track.className = 'device-track'; track.setAttribute('role', 'progressbar'); track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', '100');
  const value = Math.round(device?.percent || 0);
  const bar = document.createElement('div'); bar.className = 'device-bar'; bar.style.width = `${value}%`; if (label === 'Desktop') bar.style.background = '#8fb8e8';
  track.setAttribute('aria-valuenow', String(value)); track.append(bar);
  const percent = document.createElement('span'); percent.className = 'device-percent'; percent.textContent = `${value}%`;
  row.append(name, track, percent);
  return row;
}

let lastRenderedProgressJson = '';
let lastRenderedReportsCount = -1;

function renderAuditProgress(progress) {
  isAuditRunning = progress.state === 'running';
  updateStopVisibility();
  const pages = progress.pages || [];
  if (!isAuditRunning && !pages.length) {
    progressWrap.classList.add('hidden');
    return;
  }
  progressWrap.classList.remove('hidden');

  const completedCount = pages.filter(p => p.status === 'complete' || p.status === 'stopped' || p.status === 'failed').length;
  const runningPages = pages.filter(p => p.status === 'running');
  const queuedPages = pages.filter(p => p.status === 'queued');
  const total = progress.selectedPages || pages.length;

  selectedPagesEl.textContent = `Progress: ${completedCount}/${total} done (${queuedPages.length} queued)`;
  runModeEl.textContent = `${progress.mode === 'fast' ? 'Fast' : 'Accurate'} mode`;

  const fragment = document.createDocumentFragment();

  // If all pages have finished auditing but run is compiling reports:
  if (completedCount === total && isAuditRunning) {
    const compilingCard = document.createElement('article');
    compilingCard.className = 'progress-page';
    const head = document.createElement('div');
    head.className = 'progress-page-head';
    const title = document.createElement('span');
    title.className = 'progress-page-title';
    title.style.cssText = 'color:var(--accent);font-weight:700;';
    title.textContent = '⚡ Compiling Report from DB…';
    const state = document.createElement('span');
    state.style.color = 'var(--accent)';
    state.textContent = 'Finalizing';
    head.append(title, state);
    compilingCard.append(head);
    const barWrap = document.createElement('div');
    barWrap.className = 'device-progress';
    const label = document.createElement('span'); label.textContent = 'Summary';
    const track = document.createElement('div'); track.className = 'device-track';
    const bar = document.createElement('div'); bar.className = 'device-bar'; bar.style.cssText = 'width:100%;background:var(--accent);';
    track.append(bar);
    const percent = document.createElement('span'); percent.className = 'device-percent'; percent.textContent = '100%';
    barWrap.append(label, track, percent);
    compilingCard.append(barWrap);
    fragment.append(compilingCard);
  } else {
    // ONLY render active/running pages! Once a page completes, it is removed from the active view.
    const displayPages = runningPages.length > 0 ? runningPages : queuedPages.slice(0, 1);
    for (const page of displayPages) {
      const pageIndex = pages.indexOf(page);
      const card = document.createElement('article');
      card.className = 'progress-page';
      const head = document.createElement('div');
      head.className = 'progress-page-head';
      const title = document.createElement('span');
      title.className = 'progress-page-title';
      title.textContent = `${pageIndex + 1}. ${page.title || page.url}`;
      const state = document.createElement('span');
      state.textContent = page.status;
      head.append(title, state);
      card.append(head);

      if (page.mobile?.status !== 'skipped') card.append(deviceRow('Mobile', page.mobile));
      if (page.desktop?.status !== 'skipped') card.append(deviceRow('Desktop', page.desktop));

      const active = page.desktop?.status === 'running' ? page.desktop : page.mobile?.status === 'running' ? page.mobile : null;
      const stage = document.createElement('div');
      stage.className = 'progress-stage';
      stage.textContent = active?.stage || (page.status === 'queued' ? 'Waiting for an audit slot' : page.status);
      card.append(stage);
      fragment.append(card);
    }
  }

  progressPagesEl.replaceChildren(fragment);
}

async function refreshProgress() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_AUDIT_PROGRESS' }).catch(() => null);
  if (!response?.ok || !response.progress) return;

  const isRunning = response.progress.state === 'running';
  isAuditRunning = isRunning;
  updateStopVisibility();

  if (!isRunning) {
    stopProgressPolling();
    progressWrap.classList.add('hidden');
    progressPagesEl.replaceChildren();
    reports = await getLatestReports(chrome.storage.local);
    if (reports.length !== lastRenderedReportsCount) {
      lastRenderedReportsCount = reports.length;
      renderReports('combined');
    }
    return;
  }

  const currentJson = JSON.stringify(response.progress);
  if (currentJson !== lastRenderedProgressJson) {
    lastRenderedProgressJson = currentJson;
    renderAuditProgress(response.progress);
  }
}

function startProgressPolling(selectedCount) {
  isAuditRunning = true;
  updateStopVisibility();
  if (progressTimer) clearInterval(progressTimer);
  progressWrap.classList.remove('hidden');
  selectedPagesEl.textContent = `Selected pages: ${selectedCount || 1}`;
  runModeEl.textContent = `${auditMode() === 'fast' ? 'Fast' : 'Accurate'} mode`;
  progressTimer = setInterval(refreshProgress, 350);
}

function stopProgressPolling() {
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = null;
}

function updateBatchButton() {
  const count = selectedCaptureIds.size;
  runBatchBtn.disabled = count === 0;
  runBatchBtn.textContent = count ? `Audit ${count} selected page${count === 1 ? '' : 's'}` : 'Select pages to audit';
}

async function renderCaptures() {
  const captures = await listCaptures(chrome.storage.local);
  const hasCaptures = captures.length > 0;
  clearCapturesBtn.classList.toggle('hidden', !hasCaptures);
  selectionToolsEl.classList.toggle('hidden', !hasCaptures);
  if (!selectedCaptureIds.size) captures.forEach(capture => selectedCaptureIds.add(capture.id));
  selectedCaptureIds = new Set([...selectedCaptureIds].filter(id => captures.some(capture => capture.id === id)));
  captureCountEl.textContent = `${selectedCaptureIds.size} of ${captures.length} selected`;
  selectAllEl.checked = captures.length > 0 && selectedCaptureIds.size === captures.length;
  selectAllEl.indeterminate = selectedCaptureIds.size > 0 && selectedCaptureIds.size < captures.length;
  captureListEl.replaceChildren();
  for (const capture of captures) {
    const row = document.createElement('div'); row.className = 'capture-row';
    const main = document.createElement('label'); main.className = 'capture-main';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = selectedCaptureIds.has(capture.id);
    checkbox.addEventListener('change', () => {
      checkbox.checked ? selectedCaptureIds.add(capture.id) : selectedCaptureIds.delete(capture.id);
      renderCaptures();
    });
    const label = document.createElement('div'); label.className = 'capture-label';
    const title = document.createElement('span'); title.className = 'capture-title'; title.textContent = capture.title || 'Untitled page';
    const url = document.createElement('span'); url.className = 'capture-url'; url.textContent = capture.url;
    label.append(title, url); main.append(checkbox, label);
    const audit = document.createElement('button'); audit.textContent = 'Audit';
    audit.addEventListener('click', () => startBatch([capture]));
    row.append(main, audit); captureListEl.append(row);
  }
  updateBatchButton();
}

async function renderCaptureToggle() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_CAPTURE_STATE' });
  isCapturing = !!response?.state;
  captureToggleBtn.textContent = isCapturing ? 'Stop capture' : 'Start capture';
  captureToggleBtn.dataset.capturing = String(isCapturing);
  updateStopVisibility();
}

async function startBatch(captures, mode = auditMode()) {
  errorEl.textContent = '';
  const options = lighthouseOptions();
  startProgressPolling(captures.length);
  const response = await chrome.runtime.sendMessage({ type: 'RUN_AUDIT_BATCH', captures, mode, options });
  if (!response?.ok) throw new Error(response?.error || 'Could not start the audit.');
  reports = response.results || await getLatestReports(chrome.storage.local);
  renderReports('combined');
  await refreshProgress();
}

runBtn.addEventListener('click', async () => {
  runBtn.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    startProgressPolling(1);
    const response = await chrome.runtime.sendMessage({ type: 'RUN_AUDIT', tabId: tab.id, mode: auditMode(), options: lighthouseOptions() });
    if (!response?.ok) throw new Error(response?.error || 'Could not audit the current page.');
    reports = response.results || await getLatestReports(chrome.storage.local);
    renderReports('combined');
    await refreshProgress();
  } catch (error) { showError(error.message); } finally { renderRunSelection(); }
});

runBatchBtn.addEventListener('click', async () => {
  runBatchBtn.disabled = true;
  try {
    const captures = (await listCaptures(chrome.storage.local)).filter(capture => selectedCaptureIds.has(capture.id));
    await startBatch(captures);
  } catch (error) { showError(error.message); } finally { updateBatchButton(); }
});

selectAllEl.addEventListener('change', async () => {
  const captures = await listCaptures(chrome.storage.local);
  selectedCaptureIds = selectAllEl.checked ? new Set(captures.map(capture => capture.id)) : new Set();
  await renderCaptures();
});

captureToggleBtn.addEventListener('click', async () => {
  try {
    const capturing = captureToggleBtn.dataset.capturing === 'true';
    await chrome.runtime.sendMessage({ type: capturing ? 'STOP_CAPTURE' : 'START_CAPTURE' });
    await Promise.all([renderCaptureToggle(), renderCaptures()]);
  } catch (error) { showError(error.message); }
});

clearCapturesBtn.addEventListener('click', async () => {
  await Promise.all([clearCaptures(chrome.storage.local), clearLatestReports(chrome.storage.local)]);
  await chrome.runtime.sendMessage({ type: 'RESET_AUDIT_HISTORY' });
  progressWrap.classList.add('hidden');
  selectedCaptureIds.clear(); reports = []; renderReports(); await renderCaptures();
});

stopAllBtn.addEventListener('click', async () => {
  stopAllBtn.disabled = true;
  stopAllBtn.textContent = 'Stopping…';
  renderCompanionStatus('stopping');
  await chrome.runtime.sendMessage({ type: 'STOP_AUDIT' });
  isAuditRunning = false;
  updateStopVisibility();
  stopAllBtn.disabled = false;
  stopAllBtn.textContent = 'Stop audit';
  await refreshCompanionStatus();
  await refreshProgress();
});

copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(reportEl.value);
  const oldText = copyBtn.textContent;
  copyBtn.textContent = 'Copied!';
  setTimeout(() => { copyBtn.textContent = oldText; }, 1500);
});

downloadBtn.addEventListener('click', () => {
  if (!reportEl.value) return;
  const pages = new Map();
  for (const report of reports) {
    const key = report.captureId || report.url || report.title;
    if (!pages.has(key)) pages.set(key, report.title || report.url || 'report');
  }
  const pageNames = [...pages.values()];
  const pageName = pageNames.length > 1 ? `${pageNames[0]} and ${pageNames.length - 1} more` : (pageNames[0] || 'report');
  const safeName = pageName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'report';
  const blob = new Blob([reportEl.value], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `scanforge-${safeName}.md`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

clearReportsBtn.addEventListener('click', async () => {
  await clearLatestReports(chrome.storage.local);
  const reset = await chrome.runtime.sendMessage({ type: 'RESET_AUDIT_HISTORY' });
  if (reset?.ok) progressWrap.classList.add('hidden');
  reports = [];
  renderReports();
});
reportSelect.addEventListener('change', () => renderReports(reportSelect.value));
settingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

(async () => {
  auditSettings = await getAuditSettings(chrome.storage.local);
  reports = await getLatestReports(chrome.storage.local);
  renderRunSelection();
  renderReports();
  await Promise.all([renderCaptures(), renderCaptureToggle(), refreshCompanionStatus()]);
  await refreshProgress();
  const progressRes = await chrome.runtime.sendMessage({ type: 'GET_AUDIT_PROGRESS' }).catch(() => null);
  if (progressRes?.progress?.state === 'running') {
    startProgressPolling(progressRes.progress.selectedPages);
  }
  companionTimer = setInterval(refreshCompanionStatus, 2000);
})().catch(error => showError(error.message));

window.addEventListener('unload', () => { if (companionTimer) clearInterval(companionTimer); });
