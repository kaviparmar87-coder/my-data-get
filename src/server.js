const express = require('express');
const config = require('./config');
const { runFullSync, getStatus } = require('./sync');
const { startScheduler } = require('./scheduler');
const { log, error } = require('./logger');

const app = express();

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
  startScheduler();
});

process.on('unhandledRejection', (e) => {
  error('Unhandled rejection:', e);
});
process.on('uncaughtException', (e) => {
  error('Uncaught exception:', e);
});
