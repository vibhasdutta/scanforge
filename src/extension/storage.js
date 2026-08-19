/**
 * Storage helpers for ScanForge Chrome / Firefox Extension
 */

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Normalizes URLs so duplicate checks are accurate:
 * - Lowercases hostname
 * - Adds https:// if protocol is missing
 * - Strips trailing slash from paths
 */
export function normalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  try {
    const parsed = new URL(url);
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export const DEFAULT_AUDIT_SETTINGS = Object.freeze({
  lighthouseMode: 'navigation',
  device: 'both',
  processingMode: 'accurate',
  categories: ['performance', 'accessibility', 'best-practices', 'seo', 'agentic-browsing'],
});

export async function getAuditSettings(storageArea) {
  const { auditSettings = {} } = await storageArea.get('auditSettings');
  return { ...DEFAULT_AUDIT_SETTINGS, ...auditSettings, categories: Array.isArray(auditSettings.categories) ? auditSettings.categories : [...DEFAULT_AUDIT_SETTINGS.categories] };
}

export async function setAuditSettings(storageArea, settings) {
  const value = { ...DEFAULT_AUDIT_SETTINGS, ...settings, categories: [...settings.categories] };
  await storageArea.set({ auditSettings: value });
  return value;
}

export async function listCaptures(storageArea) {
  const { captures = [] } = await storageArea.get('captures');
  return captures;
}

export async function addCapture(storageArea, { url, title }) {
  const norm = normalizeUrl(url);
  if (!norm || !/^https?:\/\//.test(norm)) return null;

  const captures = await listCaptures(storageArea);
  const existingIdx = captures.findIndex(c => normalizeUrl(c.url) === norm);
  
  // Duplicate detection: update title/timestamp instead of creating duplicate entry
  if (existingIdx !== -1) {
    captures[existingIdx] = {
      ...captures[existingIdx],
      title: title || captures[existingIdx].title || norm,
      timestamp: Date.now(),
    };
    await storageArea.set({ captures });
    return { ...captures[existingIdx], isDuplicate: true };
  }

  const capture = { id: uid(), url: norm, title: title || norm, timestamp: Date.now() };
  await storageArea.set({ captures: [...captures, capture] });
  return capture;
}

export async function clearCaptures(storageArea) {
  await storageArea.set({ captures: [] });
}

export async function getLatestReports(storageArea) {
  const { latestReports = [] } = await storageArea.get('latestReports');
  return latestReports;
}

export async function setLatestReports(storageArea, reports) {
  await storageArea.set({ latestReports: reports });
}

export async function clearLatestReports(storageArea) {
  await storageArea.remove('latestReports');
}

export async function getCaptureState(storageArea) {
  const { capturing = null } = await storageArea.get('capturing');
  return capturing;
}

export async function setCaptureState(storageArea, state) {
  await storageArea.set({ capturing: state });
}
