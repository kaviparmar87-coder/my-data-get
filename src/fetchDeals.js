const config = require('./config');
const { log, warn } = require('./logger');
const { scrape } = require('./scrape_deals');
const { withTimeout } = require('./helpers');

// Browser scrape must never hang the scheduler forever
const SCRAPE_TIMEOUT_MS = 150000;

async function httpPost(url, body, headers, timeoutMs = 30000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    if (!text) return { ok: false, error: 'empty response' };
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, error: `invalid JSON: ${text.slice(0, 200)}` };
    }
    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

async function fetchLatest(cursor = null) {
  const { apiUrl, pageSize, minDiscount, headers: extraHeader } = config.priceHistory;
  const body = {
    limit: pageSize,
    minDiscount,
    cursor,
    stores: null,
    categoryIds: null,
    isAllTimeLow: null,
    rare: null,
    featured: null,
    sortByScore: null,
  };

  if (cursor !== null && String(cursor).startsWith('browser:')) {
    return scrapeViaPuppeteer(body);
  }

  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Top9deals/1.0 (+https://top9deals.com)',
  };
  if (extraHeader) {
    // PRICEHISTORY_HEADERS format: "Header-Name: value"
    const idx = extraHeader.indexOf(':');
    if (idx > 0) {
      headers[extraHeader.slice(0, idx).trim()] = extraHeader.slice(idx + 1).trim();
    }
  }

  const result = await httpPost(apiUrl, body, headers, 30000);
  if (!result.ok) {
    log(`API fetch failed (${result.error}), falling back to browser scraper...`);
    return scrapeViaPuppeteer(body);
  }

  const json = result.data;
  if (!json || !Array.isArray(json.data)) {
    warn('PriceHistory returned invalid deals response, trying browser scraper...');
    return scrapeViaPuppeteer(body);
  }

  return { data: json.data, nextCursor: json.nextCursor ?? null };
}

async function scrapeViaPuppeteer(body) {
  const result = await withTimeout(scrape(body), SCRAPE_TIMEOUT_MS, 'puppeteer-scrape');
  if (!result || !Array.isArray(result.data)) {
    throw new Error(`Browser fallback failed: ${result?.error || 'invalid deals response'}`);
  }
  log(`Puppeteer fallback fetched ${result.data.length} deals`);
  return { data: result.data, nextCursor: result.nextCursor ?? null };
}

module.exports = { fetchLatest };
