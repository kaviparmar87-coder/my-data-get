#!/usr/bin/env node
/* Installs Chrome into project-local .cache and writes .cache/chrome-path.txt */
const path = require('path');
const fs = require('fs');

const projectRoot = path.join(__dirname, '..');
const cacheDir = process.env.PUPPETEER_CACHE_DIR || path.join(projectRoot, '.cache', 'puppeteer');
const expectedVersion = '131.0.6778.204';
const pathFile = path.join(projectRoot, '.cache', 'chrome-path.txt');

process.env.PUPPETEER_CACHE_DIR = cacheDir;
process.env.PUPPETEER_SKIP_DOWNLOAD = 'true';

const log = (...a) => console.log('[install-chrome]', ...a);
const err = (...a) => console.error('[install-chrome]', ...a);

function walkForChrome(root, depth = 0) {
  if (depth > 8) return null;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isFile() && (e.name === 'chrome' || e.name === 'chrome.exe' || e.name === 'headless_shell')) return p;
    if (e.isDirectory()) {
      const found = walkForChrome(p, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function listTree(root, prefix = '', depth = 0, maxDepth = 5) {
  if (depth > maxDepth) return;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(root, e.name);
    let size = '';
    try { if (e.isFile()) size = ' (' + fs.statSync(p).size + ' bytes)'; } catch {}
    console.log('[tree]', prefix + e.name + (e.isDirectory() ? '/' : '') + size);
    if (e.isDirectory()) listTree(p, prefix + '  ', depth + 1, maxDepth);
  }
}

function writePathFile(p) {
  fs.mkdirSync(path.dirname(pathFile), { recursive: true });
  fs.writeFileSync(pathFile, p, 'utf8');
  log('pathFile written:', p);
}

function verify(p) {
  let ok = false;
  let stat = null;
  try { ok = fs.existsSync(p); if (ok) stat = fs.statSync(p); } catch {}
  log('verify', p, '=>', ok ? 'EXISTS size=' + (stat && stat.size) : 'MISSING');
  return ok;
}

async function main() {
  log('cwd =', process.cwd());
  log('cacheDir =', cacheDir);
  log('platform =', process.platform, 'arch =', process.arch);

  // disk space (linux)
  try {
    const { execSync } = require('child_process');
    log('df:', execSync('df -h ' + JSON.stringify(path.dirname(cacheDir)) + ' 2>/dev/null || df -h .', { encoding: 'utf8' }).trim());
  } catch { /* */ }

  // 1) path file already valid?
  if (fs.existsSync(pathFile)) {
    const p = fs.readFileSync(pathFile, 'utf8').trim();
    if (verify(p)) return;
    log('stale path file, ignoring');
  }

  // 2) scan cache
  if (fs.existsSync(cacheDir)) {
    log('cache tree BEFORE install:');
    listTree(cacheDir);
    const scanned = walkForChrome(cacheDir);
    if (scanned) {
      try { fs.chmodSync(scanned, 0o755); } catch {}
      writePathFile(scanned);
      if (verify(scanned)) return;
    }
  } else {
    log('cacheDir does not exist yet, creating');
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  // 3) clean partial + install
  const chromeRoot = path.join(cacheDir, 'chrome');
  if (fs.existsSync(chromeRoot)) {
    log('cleaning', chromeRoot);
    fs.rmSync(chromeRoot, { recursive: true, force: true });
  }

  const { install, detectBrowserPlatform, Browser, computeExecutablePath } = require('@puppeteer/browsers');
  const platform = detectBrowserPlatform();
  log('installing chrome@' + expectedVersion, 'platform=' + platform, '...');

  const started = Date.now();
  const result = await install({
    browser: Browser.CHROME,
    buildId: expectedVersion,
    cacheDir,
    platform,
  });
  log('install() took', Math.round((Date.now() - started) / 1000) + 's');
  log('install() executablePath =', result.executablePath);

  // Also show what puppeteer/@puppeteer/browsers thinks the path should be
  try {
    const expected = computeExecutablePath({ browser: Browser.CHROME, buildId: expectedVersion, cacheDir, platform });
    log('computeExecutablePath =', expected);
  } catch (e) { log('computeExecutablePath error:', e.message); }

  // tree AFTER install
  if (fs.existsSync(cacheDir)) {
    log('cache tree AFTER install:');
    listTree(cacheDir);
  }

  const execPath = result.executablePath;
  if (!verify(execPath)) {
    const alt = walkForChrome(cacheDir);
    log('install() path missing, scan =', alt);
    if (!alt) throw new Error('chrome not found after install');
    try { fs.chmodSync(alt, 0o755); } catch {}
    writePathFile(alt);
    if (!verify(alt)) throw new Error('scan path also missing');
    return;
  }

  try { fs.chmodSync(execPath, 0o755); } catch {}
  writePathFile(execPath);

  // final sanity: file is executable and non-empty
  const st = fs.statSync(execPath);
  if (st.size < 1000000) {
    throw new Error('chrome binary suspiciously small: ' + st.size + ' bytes');
  }
  log('binary size OK:', st.size, 'bytes');
}

main().then(() => {
  log('DONE OK');
  process.exit(0);
}).catch((e) => {
  err('FAILED:', e && e.message);
  process.exit(1);
});
