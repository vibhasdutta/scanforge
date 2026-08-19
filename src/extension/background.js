import { addCapture, getCaptureState, setAuditSettings, setCaptureState, setLatestReports } from './storage.js';

const COMPANION = 'http://127.0.0.1:3210';
const STATUS_ICONS = {
  ready: {
    16: '/assets/derived/scanforge-ready-16.png',
    32: '/assets/derived/scanforge-ready-32.png',
    48: '/assets/derived/scanforge-ready-48.png',
    128: '/assets/derived/scanforge-ready-128.png',
  },
  auditing: {
    16: '/assets/derived/scanforge-auditing-16.png',
    32: '/assets/derived/scanforge-auditing-32.png',
    48: '/assets/derived/scanforge-auditing-48.png',
    128: '/assets/derived/scanforge-auditing-128.png',
  },
  stopping: {
    16: '/assets/derived/scanforge-stopping-16.png',
    32: '/assets/derived/scanforge-stopping-32.png',
    48: '/assets/derived/scanforge-stopping-48.png',
    128: '/assets/derived/scanforge-stopping-128.png',
  },
  offline: {
    16: '/assets/derived/scanforge-offline-16.png',
    32: '/assets/derived/scanforge-offline-32.png',
    48: '/assets/derived/scanforge-offline-48.png',
    128: '/assets/derived/scanforge-offline-128.png',
  },
  error: {
    16: '/assets/derived/scanforge-error-16.png',
    32: '/assets/derived/scanforge-error-32.png',
    48: '/assets/derived/scanforge-error-48.png',
    128: '/assets/derived/scanforge-error-128.png',
  },
};
let activeRunId = null;
let lastProgress = { state: 'idle', mode: 'accurate', selectedPages: 0, pages: [], startedAt: null, finishedAt: null };
let companionToken = null;

async function notify(title, message, state = 'ready') {
  const iconMap = {
    ready: 'assets/derived/scanforge-ready-128.png',
    auditing: 'assets/derived/scanforge-auditing-128.png',
    stopping: 'assets/derived/scanforge-stopping-128.png',
    error: 'assets/derived/scanforge-error-128.png',
    main: 'assets/derived/scanforge-main-128.png',
  };
  const iconPath = iconMap[state] || iconMap.ready;
  const iconUrl = chrome.runtime.getURL(iconPath);

  try {
    chrome.notifications.create(`scanforge-${Date.now()}`, {
      type: 'basic',
      iconUrl,
      title: title || 'ScanForge',
      message: message || 'Lighthouse audit completed.',
      priority: 2,
      silent: false,
    }, (id) => {
      if (chrome.runtime.lastError) {
        console.warn('[ScanForge] Notification creation warning:', chrome.runtime.lastError.message);
      }
    });
  } catch (err) {
    console.warn('[ScanForge] Notification exception:', err.message);
  }
}

async function setToolbarStatus(state) {
  const normalized = STATUS_ICONS[state] ? state : 'offline';
  await Promise.all([
    chrome.action.setIcon({ path: STATUS_ICONS[normalized] }),
    chrome.action.setBadgeText({ text: '' }),
    chrome.action.setTitle({ title: `ScanForge — ${normalized[0].toUpperCase()}${normalized.slice(1)}` }),
  ]).catch(error => console.warn('[ScanForge] Could not update toolbar status', error));
}

let backgroundPollTimer = null;

function startBackgroundMonitoring() {
  if (backgroundPollTimer) clearInterval(backgroundPollTimer);
  backgroundPollTimer = setInterval(async () => {
    if (!activeRunId) {
      clearInterval(backgroundPollTimer);
      backgroundPollTimer = null;
      return;
    }
    const run = await refreshRun().catch(() => null);
    if (!run || run.state !== 'running') {
      clearInterval(backgroundPollTimer);
      backgroundPollTimer = null;
    }
  }, 1000);
  try {
    chrome.alarms.create('audit_monitor', { periodInMinutes: 0.1 });
  } catch {}
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'audit_monitor') {
    const run = await refreshRun().catch(() => null);
    if (!run || run.state !== 'running') {
      try { await chrome.alarms.clear('audit_monitor'); } catch {}
    }
  }
});

async function syncCompanionStatus() {
  try {
    const health = await companion('/health');
    if (health.activeRunId && health.run) {
      activeRunId = health.activeRunId;
      lastProgress = health.run;
      await chrome.storage.local.set({ activeRunId });
    } else if (health.state !== 'auditing' && health.state !== 'stopping') {
      const stored = await chrome.storage.local.get('activeRunId');
      if (stored.activeRunId) await chrome.storage.local.remove('activeRunId');
      activeRunId = null;
    }
    const shared = await companion('/settings').catch(() => null);
    if (shared?.settings) await setAuditSettings(chrome.storage.local, shared.settings);
    await setToolbarStatus(health.state || 'ready', health.run);
    return health;
  } catch (error) {
    await setToolbarStatus('offline');
    return null;
  }
}

function isCapturableUrl(url) {
  return url && /^https?:\/\//.test(url);
}

async function companion(path, options) {
  try {
    if (!companionToken) {
      const native = await nativeCompanion('status');
      if (!native.ok || !native.token) throw new Error(native.error || 'ScanForge Native Companion is not registered. Run npm run register.');
      companionToken = native.token;
    }
    const response = await fetch(`${COMPANION}${path}`, {
      ...options,
      headers: { 'x-scanforge-token': companionToken, ...(options?.headers || {}) },
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `Companion returned ${response.status}.`);
    return body;
  } catch (error) {
    if (error.message.includes('fetch')) {
      throw new Error('ScanForge Companion is not running. In your terminal, run: npx scanforge (or npm run companion)');
    }
    throw error;
  }
}

function nativeCompanion(action) {
  return new Promise(resolve => {
    chrome.runtime.sendNativeMessage('com.scanforge.companion', { action }, response => {
      const error = chrome.runtime.lastError;
      if (error) {
        let msg = error.message;
        if (msg.includes('specified native messaging host not found') || msg.includes('Native host has exited')) {
          msg = '⚠️ ScanForge Native Companion is not registered.\nRun "npm run register" in terminal to enable browser launching.';
        }
        resolve({ ok: false, error: msg });
      } else {
        resolve(response || { ok: true });
      }
    });
  });
}

async function startRun(pages, mode, options = {}) {
  if (!activeRunId) ({ activeRunId = null } = await chrome.storage.local.get('activeRunId'));
  if (activeRunId) {
    try {
      const existing = await companion(`/runs/${activeRunId}`);
      if (existing.state === 'running') throw new Error('An audit is already running. Stop it before starting another.');
    } catch (error) {
      if (error.message !== 'Run not found.') throw error;
    }
    activeRunId = null;
    await chrome.storage.local.remove('activeRunId');
  }
  const run = await companion('/runs', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pages, mode, options }),
  });
  activeRunId = run.id;
  await chrome.storage.local.set({ activeRunId });
  lastProgress = run;
  await setToolbarStatus('auditing');
  await setLatestReports(chrome.storage.local, []);
  startBackgroundMonitoring();
  await notify('ScanForge audit started', `${pages.length} page${pages.length === 1 ? '' : 's'} queued in ${mode === 'fast' ? 'Fast' : 'Accurate'} mode.`, 'auditing');
  return run;
}

async function refreshRun() {
  if (!activeRunId) ({ activeRunId = null } = await chrome.storage.local.get('activeRunId'));
  if (!activeRunId) return lastProgress;
  let run;
  try {
    run = await companion(`/runs/${activeRunId}`);
  } catch (error) {
    if (error.message === 'Run not found.') {
      activeRunId = null;
      await chrome.storage.local.remove('activeRunId');
      lastProgress = { state: 'idle', mode: 'accurate', selectedPages: 0, pages: [], startedAt: null, finishedAt: null };
      await setToolbarStatus('ready');
      return lastProgress;
    }
    throw error;
  }
  lastProgress = run;
  await setToolbarStatus(run.state === 'running' ? 'auditing' : run.state === 'error' ? 'error' : 'ready', run);
  if (run.state !== 'running') {
    await setLatestReports(chrome.storage.local, run.reports || []);
    const failed = (run.reports || []).filter(report => !report.ok).length;
    if (run.state === 'error' || failed) {
      await notify('ScanForge audit finished with issues', `${failed || 1} audit result${failed === 1 ? '' : 's'} failed. Open ScanForge for details.`, 'error');
    } else if (run.state === 'stopped') {
      await notify('ScanForge audit stopped', 'The active audit was stopped.', 'stopping');
    } else {
      await notify('ScanForge report ready', `${run.selectedPages || run.pages?.length || 1} page${(run.selectedPages || run.pages?.length || 1) === 1 ? '' : 's'} finished. Your Markdown report is ready.`, 'ready');
    }
    activeRunId = null;
    await chrome.storage.local.remove('activeRunId');
  }
  return run;
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== 'complete') return;
  (async () => {
    const state = await getCaptureState(chrome.storage.local);
    if (!state?.active || !isCapturableUrl(tab.url)) return;
    await addCapture(chrome.storage.local, { url: tab.url, title: tab.title });
  })().catch(error => console.error('[ScanForge] Capture failed', error));
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('scanforge-companion-status', { periodInMinutes: 0.5 });
  syncCompanionStatus();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('scanforge-companion-status', { periodInMinutes: 0.5 });
  syncCompanionStatus();
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'scanforge-companion-status') syncCompanionStatus();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === 'CHECK_COMPANION') {
      const health = await syncCompanionStatus();
      return health ? { ok: true, status: health } : { ok: false, error: 'ScanForge Companion is offline. Click Start or run "npx scanforge" in your terminal.' };
    }
    if (message.type === 'COMPANION_CONTROL' || message.type === 'START_COMPANION' || message.type === 'STOP_COMPANION') {
      const action = message.type === 'START_COMPANION' ? 'start' : message.type === 'STOP_COMPANION' ? 'stop' : message.action;
      if (!['start', 'stop', 'restart'].includes(action)) {
        return { ok: false, error: 'Unknown action: ' + action };
      }

      if (action === 'stop') {
        try {
          await companion('/control/shutdown', { method: 'POST' });
        } catch {}
        await nativeCompanion('stop').catch(() => {});
        await setToolbarStatus('offline');
        return { ok: true, state: 'offline' };
      }

      const native = await nativeCompanion(action);
      for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 200));
        const health = await syncCompanionStatus();
        if (health?.service === 'ScanForge Companion') {
          return { ok: true, status: health };
        }
      }
      const health = await syncCompanionStatus();
      if (health) return { ok: true, status: health };
      return {
        ok: false,
        error: native?.error || `Could not ${action} companion automatically.\n\nTo fix:\n1. Open your terminal\n2. Run: npm run register\n3. Or start with: scanforge`
      };
    }
    if (message.type === 'GET_SHARED_SETTINGS') {
      const result = await companion('/settings');
      await setAuditSettings(chrome.storage.local, result.settings);
      return { ok: true, settings: result.settings, hardwareLimits: result.hardwareLimits };
    }
    if (message.type === 'SAVE_SHARED_SETTINGS') {
      const result = await companion('/settings', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(message.settings || {}),
      });
      await setAuditSettings(chrome.storage.local, result.settings);
      return { ok: true, settings: result.settings };
    }
    if (message.type === 'GET_CAPTURE_STATE') {
      return { ok: true, state: await getCaptureState(chrome.storage.local) };
    }
    if (message.type === 'START_CAPTURE') {
      const state = { active: true };
      await setCaptureState(chrome.storage.local, state);
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (isCapturableUrl(tab?.url)) {
        await addCapture(chrome.storage.local, { url: tab.url, title: tab.title });
      }
      return { ok: true, state };
    }
    if (message.type === 'STOP_CAPTURE') {
      await setCaptureState(chrome.storage.local, null);
      return { ok: true };
    }
    if (message.type === 'RUN_AUDIT') {
      const tab = await chrome.tabs.get(message.tabId);
      if (!isCapturableUrl(tab.url)) throw new Error('Only HTTP and HTTPS pages can be audited.');
      const run = await startRun([{ id: `current-${Date.now()}`, url: tab.url, title: tab.title }], message.mode, message.options);
      return { ok: true, runId: run.id };
    }
    if (message.type === 'RUN_AUDIT_BATCH') {
      const run = await startRun(message.captures || [], message.mode, message.options);
      return { ok: true, runId: run.id };
    }
    if (message.type === 'GET_AUDIT_PROGRESS') {
      return { ok: true, progress: await refreshRun() };
    }
    if (message.type === 'RESET_AUDIT_HISTORY') {
      if (!activeRunId) ({ activeRunId = null } = await chrome.storage.local.get('activeRunId'));
      if (activeRunId) return { ok: false, error: 'An audit is still running.' };
      lastProgress = { state: 'idle', mode: 'accurate', selectedPages: 0, pages: [], startedAt: null, finishedAt: null };
      return { ok: true, progress: lastProgress };
    }
    if (message.type === 'STOP_AUDIT' || message.type === 'STOP_ALL') {
      if (backgroundPollTimer) { clearInterval(backgroundPollTimer); backgroundPollTimer = null; }
      try { await chrome.alarms.clear('audit_monitor'); } catch {}
      await setToolbarStatus('stopping');
      const currentRunId = activeRunId || (await chrome.storage.local.get('activeRunId'))?.activeRunId;
      await companion('/control/stop', { method: 'POST' }).catch(() => {});
      if (currentRunId) {
        await companion(`/runs/${currentRunId}`, { method: 'DELETE' }).catch(() => {});
      }
      activeRunId = null;
      await chrome.storage.local.remove('activeRunId');
      lastProgress = {
        ...lastProgress, state: 'stopped', finishedAt: Date.now(),
        pages: (lastProgress.pages || []).map(page => ({ ...page, status: page.status === 'complete' ? 'complete' : 'stopped' })),
      };
      await syncCompanionStatus();
      await notify('ScanForge audit stopped', 'The active Lighthouse audit was stopped.', 'stopping');
      return { ok: true, progress: lastProgress };
    }
    return { ok: false, error: 'Unknown message.' };
  })().then(sendResponse).catch(error => {
    console.error('[ScanForge]', error);
    if (['RUN_AUDIT', 'RUN_AUDIT_BATCH'].includes(message.type)) notify('ScanForge audit failed', error.message, 'error');
    sendResponse({ ok: false, error: error.message });
  });
  return true;
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId?.startsWith('scanforge-')) {
    chrome.action.openPopup().catch(() => {
      chrome.runtime.openOptionsPage().catch(() => {});
    });
  }
});

(async () => {
  await syncCompanionStatus();
  const stored = await chrome.storage.local.get('activeRunId');
  if (stored.activeRunId) {
    activeRunId = stored.activeRunId;
    startBackgroundMonitoring();
  }
})();
