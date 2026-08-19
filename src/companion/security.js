import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { resolve4, resolve6 } from 'node:dns/promises';
import os from 'node:os';
import path from 'node:path';

const DATA_DIR = process.env.SCANFORGE_DATA_DIR || path.join(process.env.APPDATA || os.homedir(), 'ScanForge');
const TOKEN_FILE = path.join(DATA_DIR, 'companion-token');

function privateIp(address) {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (family === 6) {
    const value = address.toLowerCase();
    return value === '::1' || value === '::' || value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd');
  }
  return false;
}

export function getCompanionToken() {
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const token = readFileSync(TOKEN_FILE, 'utf8').trim();
      if (/^[a-f0-9]{64}$/.test(token)) return token;
    } catch {}
    const token = randomBytes(32).toString('hex');
    try {
      writeFileSync(TOKEN_FILE, `${token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      return token;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Could not read the companion credential.');
}

export function validCompanionToken(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(getCompanionToken()));
}

export async function assertSafeAuditUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid audit URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only plain HTTP(S) URLs without credentials can be audited.');
  if (process.env.SCANFORGE_ALLOW_PRIVATE_NETWORKS === '1') return url.toString();
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (privateIp(host) || host === 'localhost' || host.endsWith('.localhost')) throw new Error('Private, loopback, and link-local targets are blocked. Set SCANFORGE_ALLOW_PRIVATE_NETWORKS=1 only for intentional internal audits.');
  if (isIP(host)) return url.toString();
  let addresses;
  try {
    addresses = [...await resolve4(host).catch(() => []), ...await resolve6(host).catch(() => [])];
  } catch {}
  if (!addresses?.length) throw new Error('Audit host could not be resolved safely.');
  if (addresses.some(privateIp)) throw new Error('Audit host resolves to a private, loopback, or link-local address.');
  return url.toString();
}
