#!/usr/bin/env node
/* Installs Chrome: uses existing zip if present, else downloads via CLI, then extracts. */
const path = require('path');
const fs = require('fs');
const { execSync, spawnSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const cacheDir = process.env.PUPPETEER_CACHE_DIR || path.join(projectRoot, '.cache', 'puppeteer');
const expectedVersion = '131.0.6778.204';
const pathFile = path.join(projectRoot, '.cache', 'chrome-path.txt');
const chromeRoot = path.join(cacheDir, 'chrome');
const platDir = path.join(chromeRoot, `linux-${expectedVersion}`);
const extractDir = path.join(platDir, 'chrome-linux64');
const zipPath = path.join(chromeRoot, `${expectedVersion}-chrome-linux64.zip`);

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

function listTree(root, prefix = '', depth = 0, maxDepth = 4) {
  if (depth > maxDepth) return;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(root, e.name);
    let size = '';
    try { if (e.isFile()) size = ' (' + fs.statSync(p).size + ')'; } catch {}
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
  let size = 0;
  try { ok = fs.existsSync(p); if (ok) size = fs.statSync(p).size; } catch {}
  log('verify', p, '=>', ok ? 'EXISTS size=' + size : 'MISSING');
  return ok && size > 1000000;
}

function findChromeBinary() {
  const known = path.join(extractDir, 'chrome');
  if (fs.existsSync(known)) return known;
  return walkForChrome(chromeRoot) || walkForChrome(cacheDir);
}

function extractZip() {
  if (!fs.existsSync(zipPath)) return false;
  const zipSize = fs.statSync(zipPath).size;
  log('extracting zip', zipPath, 'size=' + zipSize);
  if (zipSize < 50000000) {
    log('zip too small, deleting and re-downloading');
    fs.rmSync(zipPath, { force: true });
    return false;
  }

  fs.mkdirSync(platDir, { recursive: true });

  // Prefer unzip CLI (linux), fallback to PowerShell (windows)
  let result;
  if (process.platform === 'win32') {
    result = spawnSync('powershell', [
      '-Command',
      `Expand-Archive -Path "${zipPath}" -DestinationPath "${platDir}" -Force`,
    ], { encoding: 'utf8' });
  } else {
    result = spawnSync('unzip', ['-o', '-q', zipPath, '-d', platDir], { encoding: 'utf8' });
  }

  log('extract exit =', result.status);
  if (result.stderr) log('extract stderr:', String(result.stderr).slice(0, 300));

  const bin = findChromeBinary();
  if (bin) {
    try { fs.chmodSync(bin, 0o755); } catch {}
    log('extracted chrome binary:', bin);
    return true;
  }
  log('extract completed but chrome binary not found');
  if (fs.existsSync(extractDir)) listTree(extractDir, '  ');
  return false;
}

function downloadViaCli() {
  log('downloading via npx @puppeteer/browsers ...');
  // Don't delete zip — keep for retry
  const r = spawnSync('npx', [
    '--yes', '@puppeteer/browsers',
    'install', 'chrome@' + expectedVersion,
    '--path', cacheDir,
  ], { stdio: 'inherit', env: { ...process.env, PUPPETEER_CACHE_DIR: cacheDir } });
  log('npx install exit =', r.status);
  return r.status === 0;
}

async function main() {
  log('cwd =', process.cwd());
  log('cacheDir =', cacheDir);
  log('platform =', process.platform);

  try {
    if (process.platform !== 'win32') {
      const { execSync } = require('child_process');
      log('df:', execSync('df -h .', { encoding: 'utf8' }).trim().split('\n').slice(0, 2).join(' | '));
    }
  } catch {}

  // 1) path file valid?
  if (fs.existsSync(pathFile)) {
    const p = fs.readFileSync(pathFile, 'utf8').trim();
    if (verify(p)) return;
    log('stale path file');
  }

  // 2) binary already there?
  const existing = findChromeBinary();
  if (existing && verify(existing)) {
    try { fs.chmodSync(existing, 0o755); } catch {}
    writePathFile(existing);
    return;
  }

  // 3) Have zip? Extract it (DO NOT delete zip)
  if (fs.existsSync(zipPath)) {
    log('zip found, attempting extract...');
    if (extractZip()) {
      const bin = findChromeBinary();
      if (bin && verify(bin)) {
        writePathFile(bin);
        return;
      }
    }
    log('extract failed, will try CLI download');
  }

  // 4) CLI download + extract
  fs.mkdirSync(chromeRoot, { recursive: true });
  downloadViaCli();

  const bin = findChromeBinary();
  if (bin && verify(bin)) {
    try { fs.chmodSync(bin, 0o755); } catch {}
    writePathFile(bin);
    log('DONE OK');
    return;
  }

  // 5) last resort: try extract zip again after CLI download
  if (fs.existsSync(zipPath)) {
    log('retrying zip extract after CLI download');
    extractZip();
    const bin2 = findChromeBinary();
    if (bin2 && verify(bin2)) {
      try { fs.chmodSync(bin2, 0o755); } catch {}
      writePathFile(bin2);
      log('DONE OK');
      return;
    }
  }

  log('cache tree final:');
  if (fs.existsSync(cacheDir)) listTree(cacheDir);
  throw new Error('chrome binary still not found');
}

main().then(() => process.exit(0)).catch((e) => {
  err('FAILED:', e && e.message);
  process.exit(1);
});
