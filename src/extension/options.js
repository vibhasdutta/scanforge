import { getAuditSettings, setAuditSettings } from './storage.js';

const form = document.getElementById('settings-form');
const status = document.getElementById('status');
const categoryInputs = [...document.querySelectorAll('input[name="audit-category"]')];
const coresInput = document.getElementById('max-cores');
const coresValue = document.getElementById('cores-value');
const coresHint = document.getElementById('cores-hint');
const memoryInput = document.getElementById('max-memory');
const memoryValue = document.getElementById('memory-value');
const memoryHint = document.getElementById('memory-hint');
// agentic-browsing's supportedModes per Lighthouse itself is ['navigation', 'snapshot'] — not timespan.
const MODE_CATEGORIES = {
  navigation: ['performance', 'accessibility', 'best-practices', 'seo', 'agentic-browsing'],
  timespan: ['performance', 'best-practices'],
  snapshot: ['accessibility', 'best-practices', 'seo', 'agentic-browsing'],
};

function checked(name) {
  return document.querySelector(`input[name="${name}"]:checked`)?.value;
}

function syncCategories() {
  const mode = checked('lighthouse-mode') || 'navigation';
  const allowed = MODE_CATEGORIES[mode];
  for (const input of categoryInputs) {
    const supported = allowed.includes(input.value);
    if (!supported && !input.disabled) input.dataset.previousChecked = String(input.checked);
    input.disabled = !supported;
    if (!supported) input.checked = false;
    else if (input.dataset.previousChecked === 'true') input.checked = true;
    input.closest('.choice').classList.toggle('disabled', !supported);
    input.closest('.choice').title = supported ? '' : `Not available in ${mode} mode`;
  }
}

function readForm() {
  const categories = categoryInputs.filter(input => input.checked && !input.disabled).map(input => input.value);
  if (!categories.length) throw new Error('Select at least one supported category.');
  return {
    lighthouseMode: checked('lighthouse-mode'), device: checked('audit-device'), processingMode: checked('processing-mode'), categories,
    // Sliders stay disabled until real hardware limits are known — omit rather than send a bogus value.
    ...(coresInput.disabled ? {} : { maxCores: Number(coresInput.value) }),
    ...(memoryInput.disabled ? {} : { maxMemoryMB: Number(memoryInput.value) }),
  };
}

function applyHardwareLimits(hw, settings) {
  if (!hw) {
    coresHint.textContent = 'Start the companion to detect this machine’s real CPU and memory limits.';
    memoryHint.textContent = 'Start the companion to detect this machine’s real CPU and memory limits.';
    return;
  }
  coresInput.min = 1;
  coresInput.max = hw.cpuMax;
  coresInput.value = settings?.maxCores ?? hw.cpuMax;
  coresInput.disabled = false;
  coresValue.textContent = `${coresInput.value} core${coresInput.value === '1' ? '' : 's'}`;
  coresHint.textContent = `Max ${hw.cpuMax} physical cores. ${hw.logicalCpus} logical threads detected, but hyperthreading doesn't add real capacity for this kind of work, so Fast mode is capped at the physical count.`;

  memoryInput.min = 512;
  memoryInput.max = hw.memMaxMB;
  memoryInput.step = 256;
  memoryInput.value = settings?.maxMemoryMB ?? hw.memMaxMB;
  memoryInput.disabled = false;
  memoryValue.textContent = `${(memoryInput.value / 1024).toFixed(1)} GB`;
  memoryHint.textContent = `${(hw.totalMemMB / 1024).toFixed(1)} GB total — capped at ${(hw.memMaxMB / 1024).toFixed(1)} GB to leave headroom for your system.`;
}

coresInput.addEventListener('input', () => {
  coresValue.textContent = `${coresInput.value} core${coresInput.value === '1' ? '' : 's'}`;
});
memoryInput.addEventListener('input', () => {
  memoryValue.textContent = `${(memoryInput.value / 1024).toFixed(1)} GB`;
});

// The companion may still be starting (or the page may have opened before it did) when
// this first runs. Rather than leave the sliders permanently stuck on "detecting…" until
// the whole page is reloaded, keep retrying just the hardware-limits half in the background
// until it succeeds — this never touches the rest of the form, so it can't clobber
// in-progress edits elsewhere.
let hardwareRetryTimer = null;
async function tryDetectHardware() {
  const shared = await chrome.runtime.sendMessage({ type: 'GET_SHARED_SETTINGS' }).catch(() => null);
  if (!shared?.ok || !shared.hardwareLimits) return;
  clearInterval(hardwareRetryTimer);
  hardwareRetryTimer = null;
  applyHardwareLimits(shared.hardwareLimits, shared.settings);
}

async function load() {
  const localSettings = await getAuditSettings(chrome.storage.local);
  const shared = await chrome.runtime.sendMessage({ type: 'GET_SHARED_SETTINGS' }).catch(() => null);
  const settings = shared?.ok ? shared.settings : localSettings;
  document.querySelector(`input[name="lighthouse-mode"][value="${settings.lighthouseMode}"]`).checked = true;
  document.querySelector(`input[name="audit-device"][value="${settings.device}"]`).checked = true;
  document.querySelector(`input[name="processing-mode"][value="${settings.processingMode}"]`).checked = true;
  for (const input of categoryInputs) input.checked = settings.categories.includes(input.value);
  syncCategories();
  applyHardwareLimits(shared?.ok ? shared.hardwareLimits : null, settings);
  if (!shared?.ok || !shared.hardwareLimits) {
    hardwareRetryTimer = setInterval(tryDetectHardware, 2000);
  }
}

form.addEventListener('change', event => {
  if (event.target.name === 'lighthouse-mode') syncCategories();
  status.textContent = '';
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const local = await setAuditSettings(chrome.storage.local, readForm());
    const shared = await chrome.runtime.sendMessage({ type: 'SAVE_SHARED_SETTINGS', settings: local }).catch(() => null);
    status.textContent = shared?.ok ? 'Settings saved for the extension and desktop companion.' : 'Settings saved locally. Start the companion to synchronize them.';
  } catch (error) {
    status.textContent = error.message;
  }
});

load().catch(error => { status.textContent = error.message; });
window.addEventListener('unload', () => { if (hardwareRetryTimer) clearInterval(hardwareRetryTimer); });
