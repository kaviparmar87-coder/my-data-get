function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

const log = (...args) => console.log(`[${ts()}]`, ...args);
const warn = (...args) => console.warn(`[${ts()}] WARN`, ...args);
const error = (...args) => console.error(`[${ts()}] ERROR`, ...args);

module.exports = { log, warn, error };
