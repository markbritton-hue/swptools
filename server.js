const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const { URL } = require('url');
const { randomUUID } = require('crypto');

const localConfig = (() => {
  try { return require('./local.config.js'); }
  catch { console.warn('Warning: local.config.js not found — copy local.config.example.js to get started.'); return { ffmpeg: '', brave: '', apps: {}, companion: null }; }
})();

const FFMPEG      = localConfig.ffmpeg;
const BRAVE       = localConfig.brave;
const APP_WHITELIST = localConfig.apps || {};
const BRAVE_PROFILE = path.join(__dirname, 'brave-app-profile');
const COMPANION_CFG = localConfig.companion || null; // { host, port } for button polling

let ffmpegProcess = null;
const FRAME_PATH = path.join(__dirname, 'capture-frame.jpg');

// ── Devices store ────────────────────────────────────────────────────────────
const DEVICES_PATH = path.join(__dirname, 'devices.json');
function readDevices() {
  try { return JSON.parse(fs.readFileSync(DEVICES_PATH, 'utf8')); }
  catch { return []; }
}
function writeDevices(arr) {
  fs.writeFileSync(DEVICES_PATH, JSON.stringify(arr, null, 2));
}

// ── Companion push store ──────────────────────────────────────────────────────
let companionState = {}; // key/value pairs pushed from Companion via POST /companion

// ── Companion button polling (HTTP API — buttons only, not connection variables) ──
async function pollCompanionButtons() {
  if (!COMPANION_CFG || !COMPANION_CFG.buttons) return;
  for (const item of COMPANION_CFG.buttons) {
    try {
      await new Promise((resolve) => {
        http.get({ hostname: COMPANION_CFG.host, port: COMPANION_CFG.port || 8000,
          path: `/style/bank/${item.page}/${item.bank}`, timeout: 4000 }, (r) => {
          const chunks = [];
          r.on('data', c => chunks.push(c));
          r.on('end', () => {
            try {
              const data = JSON.parse(Buffer.concat(chunks).toString());
              if (data && data.text !== undefined) companionState[item.key] = data.text;
            } catch {}
            resolve();
          });
        }).on('error', resolve).on('timeout', resolve);
      });
    } catch {}
  }
}

if (COMPANION_CFG && COMPANION_CFG.buttons) {
  pollCompanionButtons();
  setInterval(pollCompanionButtons, 10000);
  console.log(`  Companion button polling: ${COMPANION_CFG.host}:${COMPANION_CFG.port || 8000}`);
}

const PORT = 8080;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

function ping(ip) {
  return new Promise(resolve => {
    exec(`ping -n 1 -w 1000 ${ip}`, (err, stdout) => {
      resolve(!err && stdout.includes('TTL='));
    });
  });
}

function launchApp(appKey) {
  return new Promise((resolve, reject) => {
    const exePath = APP_WHITELIST[appKey];
    if (!exePath) return reject(new Error('App not in whitelist: ' + appKey));

    if (!fs.existsSync(exePath)) return reject(new Error('Executable not found: ' + exePath));

    exec(`start "" "${exePath}"`, (err) => {
      if (err) console.error('Launch error:', err.message);
    });
    resolve();
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  const origin = req.headers.origin || '';
  if (/^https?:\/\/(localhost|127\.0\.0\.1|(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)\d+\.\d+)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  // ── Ping API ──────────────────────────────────────────────────────────────
  if (url.pathname === '/ping') {
    const ip = url.searchParams.get('ip') || '';
    if (!/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)\d{1,3}\.\d{1,3}$/.test(ip)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'invalid ip' }));
    }
    const online = await ping(ip);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ip, online }));
  }

  // ── Launch by path API ────────────────────────────────────────────────────
  if (url.pathname === '/launch-path') {
    const appPath = url.searchParams.get('path') || '';
    // Only allow .exe and .lnk files
    if (!/\.(exe|lnk)$/i.test(appPath)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ launched: false, error: 'Only .exe and .lnk files are allowed.' }));
    }
    // Only allow paths stored in devices.json — reject arbitrary paths
    const knownPaths = readDevices().map(d => d.appPath).filter(Boolean);
    if (!knownPaths.includes(appPath)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ launched: false, error: 'Path not in device list.' }));
    }
    if (!fs.existsSync(appPath)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ launched: false, error: 'File not found: ' + appPath }));
    }
    try {
      // Use Windows 'start' command — handles .lnk shortcuts and paths with spaces
      exec(`start "" "${appPath}"`, (err) => {
        if (err) console.error('Launch error:', err.message);
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ launched: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ launched: false, error: err.message }));
    }
    return;
  }

  // ── Launch by key API ─────────────────────────────────────────────────────
  if (url.pathname === '/launch') {
    const appKey = url.searchParams.get('app') || '';
    try {
      await launchApp(appKey);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ launched: true, app: appKey }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ launched: false, error: err.message }));
    }
    return;
  }

  // ── FFmpeg: list DirectShow devices ──────────────────────────────────────
  if (url.pathname === '/ffmpeg/devices') {
    if (!fs.existsSync(FFMPEG)) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'FFmpeg not found at ' + FFMPEG }));
    }
    exec(`"${FFMPEG}" -list_devices true -f dshow -i dummy`, (err, stdout, stderr) => {
      console.log('--- device scan ---');
      console.log('stdout len:', stdout.length, 'stderr len:', stderr.length);
      console.log('stderr snippet:', stderr.slice(0, 300));
      const output = stderr.length > stdout.length ? stderr : stdout;
      const devices = [];
      const re = /"([^"]+)"\s+\(video\)/g;
      let m;
      while ((m = re.exec(output)) !== null) {
        devices.push(m[1]);
      }
      console.log('devices found:', devices);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ devices }));
    });
    return;
  }

  // ── FFmpeg: start capture ─────────────────────────────────────────────────
  if (url.pathname === '/ffmpeg/start') {
    const device = url.searchParams.get('device') || '';
    if (!device) { res.writeHead(400); return res.end('Missing device'); }
    if (!fs.existsSync(FFMPEG)) { res.writeHead(500); return res.end('FFmpeg not found'); }

    if (ffmpegProcess) { try { ffmpegProcess.kill(); } catch(e) {} ffmpegProcess = null; }

    // Launch FFmpeg in its own console via `start` — DirectShow requires a real Windows session
    const cmd = `start "FFmpeg Capture" "${FFMPEG}" -f dshow -i "video=${device}" -vf scale=1280:-1 -q:v 3 -update 1 -r 15 -y "${FRAME_PATH}"`;
    const proc = exec(cmd, (err) => {
      if (err) console.error('FFmpeg launch error:', err.message);
    });
    ffmpegProcess = proc;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ started: true }));
    return;
  }

  // ── FFmpeg: latest frame ──────────────────────────────────────────────────
  if (url.pathname === '/ffmpeg/frame') {
    if (!fs.existsSync(FRAME_PATH)) { res.writeHead(204); return res.end(); }
    const data = fs.readFileSync(FRAME_PATH);
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' });
    res.end(data);
    return;
  }

  // ── Companion: debug — raw fetch from Companion HTTP API ─────────────────
  if (url.pathname === '/companion/debug') {
    if (!COMPANION_CFG) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No companion config' }));
    }
    const apiPath = url.searchParams.get('path') || '/style/bank/1/1';
    const host = COMPANION_CFG.host;
    const port = COMPANION_CFG.port || 8000;
    const req2 = http.get({ hostname: host, port, path: apiPath, timeout: 4000 }, (r) => {
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`STATUS: ${r.statusCode}\n\nBODY:\n${body}`);
      });
    });
    req2.on('error', e => { res.writeHead(502); res.end('Error: ' + e.message); });
    req2.on('timeout', () => { req2.destroy(); res.writeHead(504); res.end('Timeout'); });
    return;
  }

  // ── Companion: receive pushed values ─────────────────────────────────────
  if (url.pathname === '/companion' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        // Only accept flat string key/value pairs — no nested objects or arrays
        if (typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected a flat JSON object');
        const sanitized = {};
        for (const [k, v] of Object.entries(data)) {
          if (typeof k === 'string' && k.length <= 64 && (typeof v === 'string' || typeof v === 'number')) {
            sanitized[k] = String(v).slice(0, 512);
          }
        }
        Object.assign(companionState, sanitized);
        console.log('Companion push:', data);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // ── Companion: get current state ─────────────────────────────────────────
  if (url.pathname === '/companion') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(companionState));
  }

  // ── Launch Brave app window (no CORS/iframe restrictions) ────────────────
  if (url.pathname === '/launch-browser') {
    const target = url.searchParams.get('url') || '';
    let targetUrl;
    try { targetUrl = new URL(target); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid URL' }));
    }
    // Only allow local IPs
    const host = targetUrl.hostname;
    if (!/^192\.168\.|^10\.|^127\./.test(host)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Only local IPs allowed' }));
    }
    if (!fs.existsSync(BRAVE)) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Brave not found at ' + BRAVE }));
    }
    const cmd = `"${BRAVE}" --disable-web-security --user-data-dir="${BRAVE_PROFILE}" --app="${target}"`;
    exec(`start "" ${cmd}`, (err) => { if (err) console.error('Brave launch error:', err.message); });
    // Give Brave ~1.5s to open then bring it to front
    setTimeout(() => {
      exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${path.join(__dirname, 'focus-brave.ps1')}"`, (err) => { if (err) console.error('Focus error:', err.message); });
    }, 1500);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ launched: true }));
  }

  if (url.pathname === '/focus-browser') {
    exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${path.join(__dirname, 'focus-brave.ps1')}"`, () => {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ focused: true }));
  }

  // ── Proxy: fetch remote page, strip X-Frame-Options ─────────────────────
  if (url.pathname === '/proxy') {
    const target = url.searchParams.get('url') || '';
    let targetUrl;
    try { targetUrl = new URL(target); } catch {
      res.writeHead(400); return res.end('Invalid URL');
    }
    // Only proxy to IPs that are registered in devices.json
    const knownHosts = readDevices().map(d => d.ip).filter(Boolean).map(ip => ip.split(':')[0].split('/')[0]);
    if (!knownHosts.includes(targetUrl.hostname)) {
      res.writeHead(403); return res.end('Proxy target not in device list.');
    }

    function doFetch(fetchUrl, redirectsLeft, respond) {
      const lib2 = fetchUrl.protocol === 'https:' ? https : http;
      const opts = {
        hostname: fetchUrl.hostname,
        port: fetchUrl.port || (fetchUrl.protocol === 'https:' ? 443 : 80),
        path: fetchUrl.pathname + fetchUrl.search,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html,*/*' },
        timeout: 8000,
      };
      const req2 = lib2.request(opts, (r) => {
        // Follow redirects server-side
        if ([301,302,303,307,308].includes(r.statusCode) && r.headers.location && redirectsLeft > 0) {
          r.resume();
          let loc;
          try { loc = new URL(r.headers.location, fetchUrl); } catch { loc = fetchUrl; }
          return doFetch(loc, redirectsLeft - 1, respond);
        }
        respond(r, fetchUrl);
      });
      req2.on('error', (e) => { res.writeHead(502); res.end('Proxy error: ' + e.message); });
      req2.on('timeout', () => { req2.destroy(); res.writeHead(504); res.end('Timeout'); });
      req2.end();
    }

    doFetch(targetUrl, 5, (proxyRes, finalUrl) => {
      const stripped = Object.fromEntries(
        Object.entries(proxyRes.headers).filter(([k]) =>
          !['x-frame-options','content-security-policy','x-content-type-options','transfer-encoding'].includes(k.toLowerCase())
        )
      );
      stripped['access-control-allow-origin'] = '*';
      const contentType = (proxyRes.headers['content-type'] || '').toLowerCase();
      const isHtml = contentType.includes('text/html');
      if (!isHtml) {
        res.writeHead(proxyRes.statusCode, stripped);
        proxyRes.pipe(res, { end: true });
        return;
      }
      // For HTML: inject <base> so relative URLs resolve against the device
      const base = `${finalUrl.protocol}//${finalUrl.host}`;
      const chunks = [];
      proxyRes.on('data', c => chunks.push(c));
      proxyRes.on('end', () => {
        let body = Buffer.concat(chunks).toString('utf8');
        if (/<head[\s>]/i.test(body)) {
          body = body.replace(/(<head[^>]*>)/i, `$1<base href="${base}/">`);
        } else {
          body = `<base href="${base}/">` + body;
        }
        const buf = Buffer.from(body, 'utf8');
        stripped['content-length'] = buf.length;
        res.writeHead(proxyRes.statusCode, stripped);
        res.end(buf);
      });
    });
    return;
  }

  // ── FFmpeg: stop stream ───────────────────────────────────────────────────
  if (url.pathname === '/ffmpeg/stop') {
    exec('taskkill /F /IM ffmpeg.exe 2>nul', () => {});
    ffmpegProcess = null;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ stopped: true }));
    return;
  }

  // ── Fetch CSV (Google Sheets proxy) ──────────────────────────────────────
  if (url.pathname === '/fetch-csv') {
    const target = url.searchParams.get('url') || '';
    let targetUrl;
    try { targetUrl = new URL(target); } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid URL' }));
    }
    if (!targetUrl.hostname.endsWith('google.com')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Only Google Sheets URLs allowed' }));
    }
    const lib2 = https;
    const req2 = lib2.request({
      hostname: targetUrl.hostname,
      path: targetUrl.pathname + targetUrl.search,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    }, (r) => {
      if ([301,302,303,307,308].includes(r.statusCode) && r.headers.location) {
        r.resume();
        res.writeHead(302, { Location: `/fetch-csv?url=${encodeURIComponent(r.headers.location)}` });
        return res.end();
      }
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(Buffer.concat(chunks));
      });
    });
    req2.on('error', e => { res.writeHead(502); res.end(JSON.stringify({ error: e.message })); });
    req2.on('timeout', () => { req2.destroy(); res.writeHead(504); res.end('Timeout'); });
    req2.end();
    return;
  }

  // ── Devices: GET all ─────────────────────────────────────────────────────
  if (url.pathname === '/devices' && req.method === 'GET') {
    const devices = readDevices().sort((a, b) => a.name.localeCompare(b.name));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(devices));
  }

  // ── Devices: POST (create) ────────────────────────────────────────────────
  if (url.pathname === '/devices' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const devices = readDevices();
        const device = { id: randomUUID(), ...data };
        devices.push(device);
        writeDevices(devices);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(device));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── Devices: PUT (update) ─────────────────────────────────────────────────
  const putMatch = url.pathname.match(/^\/devices\/(.+)$/);
  if (putMatch && req.method === 'PUT') {
    const id = putMatch[1];
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const devices = readDevices();
        const idx = devices.findIndex(d => d.id === id);
        if (idx === -1) { res.writeHead(404); return res.end('Not found'); }
        devices[idx] = { ...devices[idx], ...data, id };
        writeDevices(devices);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(devices[idx]));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── Devices: DELETE ───────────────────────────────────────────────────────
  const delMatch = url.pathname.match(/^\/devices\/(.+)$/);
  if (delMatch && req.method === 'DELETE') {
    const id = delMatch[1];
    const devices = readDevices().filter(d => d.id !== id);
    writeDevices(devices);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ deleted: true }));
  }

  // ── Static files ──────────────────────────────────────────────────────────
  const filePath = path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname);
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  GearOps Dashboard`);
  console.log(`  Running at http://localhost:${PORT}\n`);
  console.log(`  Whitelisted apps:`);
  Object.keys(APP_WHITELIST).forEach(k => console.log(`    • ${k}`));
  console.log('');
});
