const { query } = require('./db');
const { runIngestion } = require('./ingestion');
const { runSeoBatch } = require('./seoWorker');
const { log, warn, error } = require('./logger');

let running = false;
let lastRun = null;
const logLines = [];

function pushLog(line) {
  const ts = new Date().toTimeString().slice(0, 8);
  const entry = `[${ts}] ${line}`;
  logLines.push(entry);
  if (logLines.length > 200) logLines.shift();
  log(entry);
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
    pushLog('Sync already running — skipped');
    return { skipped: true };
  }

  running = true;
  const started = Date.now();
  pushLog('Starting full sync (deals + SEO)...');

  try {
    const ingestion = await runIngestion();
    pushLog(
      `Deals: ${ingestion.created} created, ${ingestion.updated} updated, ${ingestion.skipped} skipped`
    );

    let seo = { processed: 0, viaAi: 0 };
    if (require('./config').seo.enabled && require('./config').seo.apiKey) {
      seo = await runSeoBatch();
      pushLog(`SEO enriched ${seo.processed} product(s)`);
    }

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
  }
}

module.exports = { runFullSync, getStatus };
