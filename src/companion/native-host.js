#!/usr/bin/env node

/**
 * ScanForge Native Messaging Host (Pure Node.js)
 * Bridges browser extension commands to launch the headless companion server.
 */

import './perf-patch.js';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCompanionToken } from './security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_SCRIPT = path.join(__dirname, 'companion-server.js');
const HEALTH_URL = 'http://127.0.0.1:3210/health';
const SHUTDOWN_URL = 'http://127.0.0.1:3210/control/shutdown';

async function isServerRunning() {
  try {
    const res = await fetch(HEALTH_URL, { headers: { 'x-scanforge-token': getCompanionToken() }, signal: AbortSignal.timeout(1000) });
    const data = await res.json();
    return res.ok && data?.service === 'ScanForge Companion';
  } catch {
    return false;
  }
}

async function startHeadlessServer() {
  if (await isServerRunning()) {
    return { ok: true, state: 'ready', message: 'Companion is already running.' };
  }

  const child = spawn(process.execPath, [SERVER_SCRIPT], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env },
  });

  child.unref();

  // Wait for server to become healthy
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 200));
    if (await isServerRunning()) {
      return { ok: true, state: 'ready' };
    }
  }

  return { ok: false, error: 'Timed out waiting for ScanForge companion to start.' };
}

async function stopServer() {
  if (!(await isServerRunning())) {
    return { ok: true, state: 'offline' };
  }
  try {
    await fetch(SHUTDOWN_URL, { method: 'POST', headers: { 'x-scanforge-token': getCompanionToken() }, signal: AbortSignal.timeout(2000) });
  } catch {
    // Expected during shutdown
  }
  return { ok: true, state: 'offline' };
}

async function restartServer() {
  await stopServer();
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 150));
    if (!(await isServerRunning())) break;
  }
  return await startHeadlessServer();
}

async function handleMessage(msg) {
  const action = msg?.action || 'status';
  if (action === 'start') {
    return { ...await startHeadlessServer(), token: getCompanionToken() };
  }
  if (action === 'stop') {
    return { ...await stopServer(), token: getCompanionToken() };
  }
  if (action === 'restart') {
    return { ...await restartServer(), token: getCompanionToken() };
  }
  if (action === 'status') {
    const running = await isServerRunning();
    return { ok: true, state: running ? 'ready' : 'offline', token: getCompanionToken() };
  }
  return { ok: false, error: `Unknown action: ${action}` };
}

function readMessage(input) {
  return new Promise((resolve, reject) => {
    let header = null;
    let messageLength = null;
    let chunks = [];
    let receivedBytes = 0;

    function onReadable() {
      if (header === null) {
        header = input.read(4);
        if (!header) return;
        messageLength = header.readUInt32LE(0);
        if (messageLength <= 0 || messageLength > 10 * 1024 * 1024) {
          return reject(new Error('Invalid message length: ' + messageLength));
        }
      }

      while (receivedBytes < messageLength) {
        const chunk = input.read(messageLength - receivedBytes);
        if (!chunk) break;
        chunks.push(chunk);
        receivedBytes += chunk.length;
      }

      if (receivedBytes === messageLength) {
        input.removeListener('readable', onReadable);
        const fullBuffer = Buffer.concat(chunks);
        try {
          resolve(JSON.parse(fullBuffer.toString('utf8')));
        } catch (e) {
          reject(e);
        }
      }
    }

    input.on('readable', onReadable);
    input.on('end', () => {
      if (receivedBytes < messageLength) {
        reject(new Error('Stream ended prematurely'));
      }
    });
    onReadable();
  });
}

function writeMessage(output, msg) {
  const payload = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  output.write(header);
  output.write(payload);
}

async function main() {
  try {
    const msg = await readMessage(process.stdin);
    const response = await handleMessage(msg);
    writeMessage(process.stdout, response);
  } catch (error) {
    writeMessage(process.stdout, { ok: false, error: error.message });
  }
}

main().then(() => {
  process.exitCode = 0;
}).catch(() => {
  process.exitCode = 1;
});
