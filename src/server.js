const express = require('express');
const config = require('./config');
const { runFullSync, getStatus } = require('./sync');
const { startScheduler } = require('./scheduler');
const { log, error } = require('./logger');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();

function walkForChrome(root, depth = 0) {
  if (depth > 6 || !fs.existsSync(root)) return null;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isFile() && (e.name === 'chrome' || e.name === 'chrome.exe')) return p;
    if (e.isDirectory()) {
      const f = walkForChrome(p, depth + 1);
      if (f) return f;
    }
  }
  return null;
}

function ensureChrome() {
  try {
    const cacheDir = process.env.PUPPETEER_CACHE_DIR || path.join(__dirname, '..', '.cache', 'puppeteer');
    const pathFile = path.join(__dirname, '..', '.cache', 'chrome-path.txt');
    const trySet = (p) => {
      if (p && fs.existsSync(p)) {
        process.env.PUPPETEER_EXECUTABLE_PATH = p;
        log('Chrome found:', p);
        return true;
      }
      return false;
    };

    if (fs.existsSync(pathFile) && trySet(fs.readFileSync(pathFile, 'utf8').trim())) return;
    if (trySet(walkForChrome(cacheDir))) return;

    log('Chrome missing — running install-chrome.js ...');
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'install-chrome.js')], {
      stdio: 'inherit',
      env: { ...process.env, PUPPETEER_CACHE_DIR: cacheDir, PUPPETEER_SKIP_DOWNLOAD: 'true' },
    });
    log('install exit =', r.status);

    if (fs.existsSync(pathFile) && trySet(fs.readFileSync(pathFile, 'utf8').trim())) return;
    if (trySet(walkForChrome(cacheDir))) return;
    error('Chrome still missing after install — browser fallback will not work');
  } catch (e) {
    error('ensureChrome error:', e.message);
  }
}

function checkKey(req, res) {
  const key = req.query.key;
  if (key !== config.adminKey) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return false;
  }
  return true;
}

app.get('/', (req, res) => {
  res.json({
    ok: true,
    service: 'offerhatke-sync',
    autoSync: config.ingestEnabled,
    intervalSeconds: config.syncIntervalSeconds,
    seoEnabled: config.seo.enabled && !!config.seo.apiKey,
  });
});

app.get('/health', (req, res) => {
  res.status(200).send('ok');
});

app.get('/status', async (req, res) => {
  if (!checkKey(req, res)) return;
  try {
    const status = await getStatus();
    res.json({ ok: true, ...status });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/sync', async (req, res) => {
  if (!checkKey(req, res)) return;
  const result = await runFullSync();
  res.status(result.ok === false ? 500 : 200).json(result);
});

app.listen(config.port, '0.0.0.0', () => {
  log(`Sync server listening on port ${config.port}`);
  log('Loaded env:', JSON.stringify(config.maskedSummary()));
  ensureChrome();
  startScheduler();
});

process.on('unhandledRejection', (e) => {
  error('Unhandled rejection:', e);
});
process.on('uncaughtException', (e) => {
  error('Uncaught exception:', e);
});
