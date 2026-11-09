const { query } = require('./db');
const { runIngestion } = require('./ingestion');
const { runSeoBatch } = require('./seoWorker');
const { log, warn, error } = require('./logger');
const { withTimeout } = require('./helpers');

let running = false;
let startedAt = 0;
let lastRun = null;
const logLines = [];

// If a run somehow never settles, force-unlock after this long
const RUN_STALE_MS = 8 * 60 * 1000;
// Hard cap on one full sync (ingest + SEO)
const RUN_TIMEOUT_MS = 6 * 60 * 1000;

function pushLog(line) {
  const ts = new Date().toTimeString().slice(0, 8);
  const entry = `[${ts}] ${line}`;
  logLines.push(entry);
  if (logLines.length > 200) logLines.shift();
  log(entry);
}

function isStale() {
  return running && startedAt > 0 && Date.now() - startedAt > RUN_STALE_MS;
}

async function getStatus() {
  const stats = await getOneRow(
    `SELECT COUNT(*) AS total,
      SUM(seoStatus='done') AS seo_done,
      SUM(seoStatus='pending') AS seo_pending,
      SUM(seoStatus='failed') AS seo_failed
     FROM products`
  );
  return {
    total: Number(stats?.total || 0),
    seo_done: Number(stats?.seo_done || 0),
    seo_pending: Number(stats?.seo_pending || 0),
    seo_failed: Number(stats?.seo_failed || 0),
    running,
    runningForSec: running && startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0,
    lastRun,
    log: logLines.slice(-50),
  };
}

async function getOneRow(sql) {
  const { getOne } = require('./db');
  return getOne(sql);
}

async function runFullSync() {
  if (running) {
    if (isStale()) {
      warn(`Sync stale after ${Math.round((Date.now() - startedAt) / 1000)}s — force unlock`);
      pushLog(`Force-unlock stale sync (ran ${Math.round((Date.now() - startedAt) / 1000)}s)`);
      running = false;
    } else {
      pushLog('Sync already running — skipped');
      return { skipped: true };
    }
  }

  running = true;
  startedAt = Date.now();
  const started = startedAt;
  pushLog('Starting full sync (deals + SEO)...');

  try {
    const result = await withTimeout(
      (async () => {
        const ingestion = await runIngestion();
        pushLog(
          `Deals: ${ingestion.created} created, ${ingestion.updated} updated, ${ingestion.skipped} skipped`
        );

        let seo = { processed: 0, viaAi: 0 };
        if (require('./config').seo.enabled && require('./config').seo.apiKey) {
          seo = await runSeoBatch();
          pushLog(`SEO enriched ${seo.processed} product(s)`);
        }

        return { ingestion, seo };
      })(),
      RUN_TIMEOUT_MS,
      'full-sync'
    );

    const { ingestion, seo } = result;
    const elapsed = ((Date.now() - started) / 1000).toFixed(2);
    const status = await getStatus();
    pushLog(
      `Done in ${elapsed}s | Pending: ${status.seo_pending + status.seo_failed} | Done: ${status.seo_done}`
    );

    lastRun = {
      at: new Date().toISOString(),
      elapsedSec: Number(elapsed),
      ingestion,
      seo,
      stats: status,
    };

    return { ok: true, ingestion, seo, elapsed: Number(elapsed), stats: status };
  } catch (e) {
    error(`Sync failed: ${e.message}`);
    pushLog(`ERROR: ${e.message}`);
    lastRun = { at: new Date().toISOString(), error: e.message };
    return { ok: false, error: e.message };
  } finally {
    running = false;
    startedAt = 0;
  }
}

module.exports = { runFullSync, getStatus };
