#!/usr/bin/env node
/**
 * Installs Chrome for Puppeteer into project-local .cache/puppeteer
 * so it persists from Render build → runtime.
 */
const path = require('path');
const fs = require('fs');

const projectRoot = path.join(__dirname, '..');
const cacheDir = path.join(projectRoot, '.cache', 'puppeteer');
const expectedVersion = '131.0.6778.204';
const chromeRel = path.join(
  'chrome',
  `linux-${expectedVersion}`,
  'chrome-linux64',
  'chrome'
);
const chromePath = path.join(cacheDir, chromeRel);

process.env.PUPPETEER_CACHE_DIR = cacheDir;
process.env.PUPPETEER_SKIP_DOWNLOAD = 'true';

function log(...args) {
  console.log('[install-chrome]', ...args);
}

async function main() {
  log('cacheDir =', cacheDir);

  if (fs.existsSync(chromePath)) {
    fs.chmodSync(chromePath, 0o755);
    log('Chrome already present at', chromePath);
    return;
  }

  // Clean partial/corrupt folder if any
  const versionDir = path.dirname(path.dirname(chromePath));
  if (fs.existsSync(versionDir)) {
    log('Removing incomplete folder:', versionDir);
    fs.rmSync(versionDir, { recursive: true, force: true });
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

  log('installed:', result.executablePath);

  if (!fs.existsSync(result.executablePath)) {
    throw new Error('Install reported success but executable missing: ' + result.executablePath);
  }
  fs.chmodSync(result.executablePath, 0o755);
  log('OK →', result.executablePath);
}

main().catch((err) => {
  console.error('[install-chrome] FAILED:', err.message);
  process.exit(1);
});
