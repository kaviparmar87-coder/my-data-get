const config = require('./config');
const { runFullSync } = require('./sync');
const { log } = require('./logger');

let timer = null;
let started = false;

async function tick() {
  try {
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

  // Don't keep process alive solely for the timer if server handles that
  if (timer.unref) timer.unref();
}

function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

module.exports = { startScheduler, stopScheduler };
