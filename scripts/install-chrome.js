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
  if (depth > 6) return null;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isFile() && (e.name === 'chrome' || e.name === 'chrome.exe')) return p;
    if (e.isDirectory()) {
      const found = walkForChrome(p, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function writePathFile(p) {
  fs.mkdirSync(path.dirname(pathFile), { recursive: true });
  fs.writeFileSync(pathFile, p, 'utf8');
  log('pathFile written:', pathFile, '=>', p);
}

function verify(p) {
  const ok = p && fs.existsSync(p);
  log('verify', p, '=>', ok ? 'EXISTS' : 'MISSING');
  return ok;
}

async function main() {
  log('cwd =', process.cwd());
  log('cacheDir =', cacheDir);
  log('platform =', process.platform);

  // 1) path file already valid?
  if (fs.existsSync(pathFile)) {
    const p = fs.readFileSync(pathFile, 'utf8').trim();
    if (verify(p)) return;
    log('stale path file, ignoring');
  }

  // 2) scan cache
  const scanned = walkForChrome(cacheDir);
  if (scanned) {
    try { fs.chmodSync(scanned, 0o755); } catch {}
    writePathFile(scanned);
    if (verify(scanned)) return;
  }

  // 3) clean partial + install
  const chromeRoot = path.join(cacheDir, 'chrome');
  if (fs.existsSync(chromeRoot)) {
    log('cleaning', chromeRoot);
    fs.rmSync(chromeRoot, { recursive: true, force: true });
  }

  const { install, detectBrowserPlatform, Browser } = require('@puppeteer/browsers');
  const platform = detectBrowserPlatform();
  log('installing chrome@' + expectedVersion, 'platform=' + platform, '...');

  const result = await install({
    browser: Browser.CHROME,
    buildId: expectedVersion,
    cacheDir,
    platform,
  });
  log('install() executablePath =', result.executablePath);

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
}

main().then(() => {
  log('DONE OK');
  process.exit(0);
}).catch((e) => {
  err('FAILED:', e && e.message);
  process.exit(1);
});
