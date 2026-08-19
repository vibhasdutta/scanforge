import './perf-patch.js';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { globalCompanionBus, writePidFile, cleanPidFile, closeChromeSilently, getHardwareLimits } from './companion-bus.js';
import { getCompanionToken, validCompanionToken } from './security.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = Number(process.env.SCANFORGE_PORT || 3210);
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_STATUS_CLIENTS = 10;

function corsHeaders(request) {
  const origin = request.headers.origin || '';
  return /^(chrome-extension:\/\/bnmloegglgcibagjdhhnlagclcfbmcia|moz-extension:\/\/[^/]+)$/.test(origin)
    ? { 'access-control-allow-origin': origin, vary: 'origin', 'access-control-allow-headers': 'content-type, x-scanforge-token', 'access-control-allow-methods': 'GET,PUT,POST,DELETE,OPTIONS' }
    : {};
}

function send(request, response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...corsHeaders(request),
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const declared = Number(request.headers['content-length'] || 0);
  if (declared > MAX_REQUEST_BYTES) throw new Error('Request body is too large.');
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export function createCompanionServer({ bus = globalCompanionBus, host = DEFAULT_HOST, port = DEFAULT_PORT, silent = false } = {}) {
  const statusClients = new Set();

  const handleBusStatus = ({ status }) => {
    const payload = `data: ${JSON.stringify({ type: 'status', status })}\n\n`;
    for (const client of statusClients) client.write(payload);
  };

  const handleBusSettings = ({ settings }) => {
    const payload = `data: ${JSON.stringify({ type: 'settings', settings })}\n\n`;
    for (const client of statusClients) client.write(payload);
  };

  bus.on('status', handleBusStatus);
  bus.on('settings', handleBusSettings);

  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === 'OPTIONS') return send(request, response, 204, {});
      if (!validCompanionToken(request.headers['x-scanforge-token'])) return send(request, response, 401, { error: 'Unauthorized companion request.' });
      const url = new URL(request.url, `http://${host}:${port}`);

      if (request.method === 'GET' && url.pathname === '/events') {
        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          ...corsHeaders(request),
        });
        if (statusClients.size >= MAX_STATUS_CLIENTS) return response.end();
        statusClients.add(response);
        response.write(`data: ${JSON.stringify({ type: 'status', status: bus.getStatus() })}\n\n`);
        response.write(`data: ${JSON.stringify({ type: 'settings', settings: bus.getSettings() })}\n\n`);
        request.on('close', () => statusClients.delete(response));
        return;
      }

      if (request.method === 'GET' && url.pathname === '/health') {
        return send(request, response, 200, { ok: true, service: 'ScanForge Companion', version: '1.0.0', ...bus.getStatus() });
      }

      if (request.method === 'GET' && url.pathname === '/settings') {
        return send(request, response, 200, { ok: true, settings: bus.getSettings(), hardwareLimits: getHardwareLimits() });
      }

      if (request.method === 'PUT' && url.pathname === '/settings') {
        return send(request, response, 200, { ok: true, settings: bus.saveSettings(await readJson(request)) });
      }

      if (request.method === 'POST' && url.pathname === '/control/stop') {
        const stoppedRuns = await bus.stopActiveRuns();
        return send(request, response, 200, { ok: true, stoppedRuns, ...bus.getStatus() });
      }

      if (request.method === 'POST' && url.pathname === '/control/shutdown') {
        const stoppedRuns = await bus.stopActiveRuns();
        send(request, response, 202, { ok: true, shuttingDown: true, stoppedRuns });
        setTimeout(() => server.close(() => process.exit(0)), 75);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/control/restart') {
        const stoppedRuns = await bus.stopActiveRuns();
        send(request, response, 202, { ok: true, restarting: true, stoppedRuns });
        setTimeout(() => server.close(() => process.exit(0)), 75);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/runs') {
        const payload = await readJson(request);
        const run = bus.createRun({ ...payload, source: payload.source || 'ext' });
        return send(request, response, 202, bus.publicRun(run));
      }

      const match = url.pathname.match(/^\/runs\/([^/]+)$/);
      if (match && request.method === 'GET') {
        const run = bus.runs.get(match[1]);
        return run ? send(request, response, 200, bus.publicRun(run)) : send(request, response, 404, { error: 'Run not found.' });
      }

      if (match && request.method === 'DELETE') {
        const run = bus.runs.get(match[1]);
        if (!run) return send(request, response, 404, { error: 'Run not found.' });
        run.cancelled = true;
        run.state = 'stopped';
        for (const child of run.children || []) {
          try { child.send?.({ type: 'cancel' }); } catch {}
          try { child.kill?.(); } catch {}
        }
        await Promise.all([...(run.launchers || [])].map(chrome => closeChromeSilently(chrome)));
        bus.broadcastStatus(true);
        return send(request, response, 200, { ok: true, state: 'stopped' });
      }

      send(request, response, 404, { error: 'Not found.' });
    } catch (error) {
      send(request, response, 400, { error: error.message });
    }
  });

  server.on('close', () => {
    bus.removeListener('status', handleBusStatus);
    bus.removeListener('settings', handleBusSettings);
  });

  return { server, bus, host, port };
}

export function startCompanionServer(options = {}) {
  const { server, host, port } = createCompanionServer(options);
  const silent = options.silent ?? false;

  return new Promise((resolve, reject) => {
    server.on('error', async error => {
      if (error.code === 'EADDRINUSE') {
        try {
          const res = await fetch(`http://${host}:${port}/health`, { headers: { 'x-scanforge-token': getCompanionToken() } });
          const data = await res.json();
          if (res.ok && data?.service === 'ScanForge Companion') {
            if (!silent) console.log(`ScanForge Companion already active on http://${host}:${port}`);
            return resolve(server);
          }
        } catch {}
      }
      reject(error);
    });

    server.listen(port, host, () => {
      writePidFile(port);
      process.on('exit', cleanPidFile);
      process.on('SIGINT', () => { cleanPidFile(); process.exit(0); });
      process.on('SIGTERM', () => { cleanPidFile(); process.exit(0); });

      if (!silent) {
        console.log(`\n  🟢 ScanForge Companion running on http://${host}:${port} (PID: ${process.pid})`);
      }
      resolve(server);
    });
  });
}

// Auto-run if executed directly or spawned
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startCompanionServer({ silent: false }).catch(err => {
    console.error('Failed to start companion server:', err.message);
    process.exit(1);
  });
}
