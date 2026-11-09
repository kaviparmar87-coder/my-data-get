#!/usr/bin/env node
/**
 * Installs Chrome for Puppeteer into project-local .cache/puppeteer
 * and writes the actual executable path to .cache/chrome-path.txt
 */
const path = require('path');
const fs = require('fs');

const projectRoot = path.join(__dirname, '..');
const cacheDir = process.env.PUPPETEER_CACHE_DIR || path.join(projectRoot, '.cache', 'puppeteer');
const expectedVersion = '131.0.6778.204';
const pathFile = path.join(projectRoot, '.cache', 'chrome-path.txt');

process.env.PUPPETEER_CACHE_DIR = cacheDir;
process.env.PUPPETEER_SKIP_DOWNLOAD = 'true';

function log(...args) {
  console.log('[install-chrome]', ...args);
}

function findExistingChrome() {
  const roots = [cacheDir, path.join(projectRoot, '.cache', 'puppeteer')];
  for (const root of roots) {
    const chromeRoot = path.join(root, 'chrome');
    if (!fs.existsSync(chromeRoot)) continue;
    for (const ver of fs.readdirSync(chromeRoot)) {
      const verDir = path.join(chromeRoot, ver);
      if (!fs.statSync(verDir).isDirectory()) continue;
      for (const plat of fs.readdirSync(verDir)) {
        const platDir = path.join(verDir, plat);
        if (!fs.statSync(platDir).isDirectory()) continue;
        for (const bin of ['chrome', 'chrome.exe']) {
          const p = path.join(platDir, bin);
          if (fs.existsSync(p)) return p;
        }
        // nested e.g. chrome-linux64/chrome
        for (const sub of fs.readdirSync(platDir)) {
          const subDir = path.join(platDir, sub);
          if (!fs.statSync(subDir).isDirectory()) continue;
          for (const bin of ['chrome', 'chrome.exe']) {
            const p = path.join(subDir, bin);
            if (fs.existsSync(p)) return p;
          }
        }
      }
    }
  }
  return null;
}

async function main() {
  log('cacheDir =', cacheDir);

  const existing = findExistingChrome();
  if (existing) {
    try { fs.chmodSync(existing, 0o755); } catch { /* */ }
    fs.mkdirSync(path.dirname(pathFile), { recursive: true });
    fs.writeFileSync(pathFile, existing);
    log('Chrome already present at', existing);
    return;
  }

  // Clean partial folders under chrome/
  const chromeRoot = path.join(cacheDir, 'chrome');
  if (fs.existsSync(chromeRoot)) {
    log('Removing incomplete chrome folder:', chromeRoot);
    fs.rmSync(chromeRoot, { recursive: true, force: true });
  }

  const { install, detectBrowserPlatform, Browser } = require('@puppeteer/browsers');
  const platform = detectBrowserPlatform();
  log('platform =', platform, 'installing chrome@' + expectedVersion, '...');

  const result = await install({
    browser: Browser.CHROME,
    buildId: expectedVersion,
    cacheDir,
    platform,
  });

  log('install() returned:', result.executablePath);

  if (!fs.existsSync(result.executablePath)) {
    // Fallback scan
    const scanned = findExistingChrome();
    if (scanned) {
      log('install() path missing but found via scan:', scanned);
      try { fs.chmodSync(scanned, 0o755); } catch { /* */ }
      fs.mkdirSync(path.dirname(pathFile), { recursive: true });
      fs.writeFileSync(pathFile, scanned);
      log('OK (scan) →', scanned);
      return;
    }
    throw new Error('Install reported success but executable missing: ' + result.executablePath);
  }

  try { fs.chmodSync(result.executablePath, 0o755); } catch { /* */ }
  fs.mkdirSync(path.dirname(pathFile), { recursive: true });
  fs.writeFileSync(pathFile, result.executablePath);
  log('OK →', result.executablePath);
}

main().catch((err) => {
  console.error('[install-chrome] FAILED:', err.message);
  process.exit(1);
});
