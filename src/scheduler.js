const config = require('./config');
const { runFullSync, getStatus } = require('./sync');
const { log } = require('./logger');

let timer = null;
let started = false;
let ticks = 0;

async function tick() {
  ticks++;
  try {
    const st = await getStatus().catch(() => null);
    log(
      `[scheduler] tick #${ticks} every=${config.syncIntervalSeconds}s running=${st?.running ?? '?'} lastRun=${st?.lastRun?.at ?? 'never'}`
    );
    await runFullSync();
  } catch (e) {
    console.error('Scheduler tick error:', e);
  }
}

function startScheduler() {
  if (started) return;
  started = true;

  const intervalMs = Math.max(15, config.syncIntervalSeconds) * 1000;
  log(`Auto-sync scheduler started: every ${config.syncIntervalSeconds}s`);

  // First run shortly after boot (give DB a moment)
  setTimeout(tick, 3000);

  timer = setInterval(tick, intervalMs);
  // Keep the interval alive even if nothing else holds the event loop
  if (timer.unref) timer.unref();
}

function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

module.exports = { startScheduler, stopScheduler };
