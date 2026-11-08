const path = require('path');
const dotenv = require('dotenv');

// Load .env from project root (works from any cwd)
dotenv.config({ path: path.join(__dirname, '..', '.env') });

function env(key, fallback = '') {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function envInt(key, fallback) {
  const n = parseInt(env(key, String(fallback)), 10);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(key, fallback = false) {
  const v = env(key, fallback ? 'true' : 'false').toLowerCase();
  return v === 'true' || v === '1';
}

/** Required secret — no hardcoded default. Fail fast if missing. */
function requireEnv(key) {
  const v = process.env[key];
  if (v === undefined || String(v).trim() === '') {
    console.error(
      `\n[FATAL] Missing required env var: ${key}\n` +
        `Set it in .env (local) or Render Dashboard → Environment (production).\n` +
        `See .env.example for all required keys.\n`
    );
    process.exit(1);
  }
  return String(v).trim();
}

// ── Required secrets (must come from .env / Render env — never hardcoded) ──
const DATABASE_HOST = requireEnv('DATABASE_HOST');
const DATABASE_USER = requireEnv('DATABASE_USER');
const DATABASE_PASSWORD = requireEnv('DATABASE_PASSWORD');
const DATABASE_NAME = requireEnv('DATABASE_NAME');
const OPENROUTER_API_KEY = requireEnv('OPENROUTER_API_KEY');

module.exports = {
  db: {
    host: DATABASE_HOST,
    user: DATABASE_USER,
    password: DATABASE_PASSWORD,
    database: DATABASE_NAME,
    port: envInt('DATABASE_PORT', 3306),
    waitForConnections: true,
    connectionLimit: 5,
    connectTimeout: 15000,
  },
  siteUrl: env('SITE_URL', 'https://top9deals.com').replace(/\/+$/, ''),
  adminKey: env('ADMIN_KEY', 'top9deals-admin-2024'),
  syncIntervalSeconds: envInt('SYNC_INTERVAL_SECONDS', 60),
  ingestEnabled: envBool('INGEST_ENABLED', true),
  priceHistory: {
    apiUrl: env('PRICEHISTORY_API_URL', 'https://pricehistoryapp.com/api/deals'),
    pageSize: envInt('PRICEHISTORY_PAGE_SIZE', 28),
    maxPages: envInt('PRICEHISTORY_MAX_PAGES', 1),
    minDiscount: envInt('PRICEHISTORY_MIN_DISCOUNT', 0),
    headers: env('PRICEHISTORY_HEADERS', ''),
  },
  seo: {
    enabled: envBool('SEO_ENABLED', true),
    apiKey: OPENROUTER_API_KEY,
    apiUrl: env('OPENROUTER_API_URL', 'https://openrouter.ai/api/v1/chat/completions'),
    models: env(
      'OPENROUTER_MODELS',
      'meta-llama/llama-3.3-70b-instruct:free,qwen/qwen3-next-80b-a3b-instruct:free,openai/gpt-oss-120b:free,google/gemma-4-31b-it:free,nvidia/nemotron-3-super-120b-a12b:free'
    )
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
    batchSize: envInt('SEO_BATCH_SIZE', 5),
    callDelayMs: envInt('SEO_CALL_DELAY_MS', 800),
    includeAggregateRating: envBool('SEO_INCLUDE_AGGREGATE_RATING', false),
  },
  port: envInt('PORT', 3000),
};

/** Masked config dump for startup logs (never print secrets). */
function maskedSummary() {
  const mask = (s) => (s.length <= 4 ? '****' : `${s.slice(0, 2)}****${s.slice(-2)}`);
  return {
    DATABASE_HOST: config.db.host,
    DATABASE_NAME: config.db.database,
    DATABASE_USER: config.db.user,
    DATABASE_PASSWORD: mask(config.db.password),
    OPENROUTER_API_KEY: mask(config.seo.apiKey),
    SITE_URL: config.siteUrl,
    SYNC_INTERVAL_SECONDS: config.syncIntervalSeconds,
    SEO_ENABLED: config.seo.enabled,
  };
}

const config = module.exports;
module.exports.maskedSummary = maskedSummary;
