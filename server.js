const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const { URL } = require('url');

const localConfig = (() => {
  try { return require('./local.config.js'); }
  catch { console.warn('Warning: local.config.js not found — copy local.config.example.js to get started.'); return { ffmpeg: '', brave: '', apps: {} }; }
})();

const FFMPEG      = localConfig.ffmpeg;
const BRAVE       = localConfig.brave;
const APP_WHITELIST = localConfig.apps || {};
const BRAVE_PROFILE = path.join(__dirname, 'brave-app-profile');

let ffmpegProcess = null;
const FRAME_PATH = path.join(__dirname, 'capture-frame.jpg');

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

  res.setHeader('Access-Control-Allow-Origin', '*');

  // ── Ping API ──────────────────────────────────────────────────────────────
  if (url.pathname === '/ping') {
    const ip = url.searchParams.get('ip') || '';
    if (!/^192\.168\.\d{1,3}\.\d{1,3}$/.test(ip)) {
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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ launched: true }));
  }

  // ── Proxy: fetch remote page, strip X-Frame-Options ─────────────────────
  if (url.pathname === '/proxy') {
    const target = url.searchParams.get('url') || '';
    let targetUrl;
    try { targetUrl = new URL(target); } catch {
      res.writeHead(400); return res.end('Invalid URL');
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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  Streamwave Equipment Dashboard`);
  console.log(`  Running at http://localhost:${PORT}\n`);
  console.log(`  Whitelisted apps:`);
  Object.keys(APP_WHITELIST).forEach(k => console.log(`    • ${k}`));
  console.log('');
});
