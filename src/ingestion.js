const { query, getOne } = require('./db');
const { fetchLatest } = require('./fetchDeals');
const {
  normaliseStore,
  inferCategorySlug,
  slugify,
  truncate,
  nowMysql,
} = require('./helpers');
const config = require('./config');
const { log, warn } = require('./logger');

let categoryCache = null;

async function loadCategories() {
  if (categoryCache) return categoryCache;
  const rows = await query('SELECT id, slug FROM categories');
  categoryCache = {};
  for (const r of rows) categoryCache[r.slug] = Number(r.id);
  return categoryCache;
}

function inferCategoryId(name, catMap) {
  const slug = inferCategorySlug(name);
  if (catMap[slug] != null) return catMap[slug];
  return catMap.electronics ?? 1;
}

async function upsertDeal(deal, catMap) {
  const p = deal.product || {};
  if (!p._id || !p.url || !p.name) return 'skipped';

  const marketplace = normaliseStore(deal.store || '');
  const rawStore = deal.store || '';
  const price = Math.round(Number(deal.price) || 0);
  const highestPrice = Math.round(Number(deal.highest_price ?? deal.price) || 0);
  const originalPrice = Math.max(highestPrice, price);
  const discountPercent = Math.round(Number(deal.discount) || 0);
  const dealScore = deal.deal_score != null ? Math.round(Number(deal.deal_score)) : null;
  const rating = p.rating != null && Number(p.rating) > 0 ? Number(p.rating) : null;
  const ratingCount = p.rating_count != null && Number(p.rating_count) > 0 ? Math.round(Number(p.rating_count)) : null;
  const sourceName = truncate(p.name, 300);
  const imageUrl = p.image || '';
  const sourceUrl = p.url;
  const sourceUpdatedAt = deal.updatedAt ? new Date(deal.updatedAt) : null;
  const isAllTimeLow = deal.is_all_time_low ? 1 : 0;
  const rare = deal.rare ? 1 : 0;
  const featured = deal.featured ? 1 : 0;
  const now = nowMysql();

  const existing = await getOne('SELECT id FROM products WHERE externalProductId = ?', [p._id]);

  if (existing) {
    await query(
      `UPDATE products SET sourceName=?, imageUrl=?, marketplace=?, store=?, price=?,
       originalPrice=?, discountPercent=?, highestPrice=?, rating=?, ratingCount=?,
       dealScore=?, isAllTimeLow=?, rare=?, featured=?, sourceUrl=?, sourceUpdatedAt=?,
       status='active', updatedAt=? WHERE id=?`,
      [
        sourceName, imageUrl, marketplace, rawStore, price,
        originalPrice, discountPercent, highestPrice, rating, ratingCount,
        dealScore, isAllTimeLow, rare, featured, sourceUrl, sourceUpdatedAt,
        now, existing.id,
      ]
    );
    return 'updated';
  }

  const categoryId = inferCategoryId(p.name, catMap);
  const slug = slugify(p.slug ?? p.name, String(p._id).slice(-6));
  const description = `${sourceName} - currently ₹${price} on ${marketplace}. Prices and availability are subject to change on the merchant site.`;
  const viewCount = 200 + Math.floor(Math.random() * 302);

  const insertSql = `INSERT INTO products
    (title, slug, sourceName, description, imageUrl, marketplace, store, categoryId,
     price, originalPrice, discountPercent, highestPrice, rating, ratingCount, dealScore,
     isAllTimeLow, rare, featured, affiliateUrl, sourceUrl, viewCount, status, seoStatus,
     externalProductId, sourceUpdatedAt, createdAt, updatedAt)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

  const insertParams = [
    sourceName, slug, sourceName, description, imageUrl, marketplace, rawStore, categoryId,
    price, originalPrice, discountPercent, highestPrice, rating, ratingCount, dealScore,
    isAllTimeLow, rare, featured, sourceUrl, sourceUrl, viewCount, 'active', 'pending',
    p._id, sourceUpdatedAt, now, now,
  ];

  try {
    await query(insertSql, insertParams);
    return 'created';
  } catch (e) {
    // Slug collision or duplicate — retry with longer suffix once
    try {
      const slug2 = slugify(p.name, String(p._id).slice(-10));
      insertParams[1] = slug2;
      await query(insertSql, insertParams);
      return 'created';
    } catch (e2) {
      if (e2.code === 'ER_DUP_ENTRY') return 'skipped';
      warn(`upsert failed for ${p._id}: ${e2.message}`);
      return 'skipped';
    }
  }
}

async function runIngestion() {
  if (!config.ingestEnabled) {
    log('Ingestion disabled (INGEST_ENABLED=false)');
    return { created: 0, updated: 0, skipped: 0 };
  }

  const catMap = await loadCategories();
  let created = 0, updated = 0, skipped = 0;
  let cursor = null;

  for (let page = 0; page < config.priceHistory.maxPages; page++) {
    const result = await fetchLatest(cursor);
    if (!result.data || !result.data.length) break;

    for (const deal of result.data) {
      const r = await upsertDeal(deal, catMap);
      if (r === 'created') created++;
      else if (r === 'updated') updated++;
      else skipped++;
    }

    cursor = result.nextCursor;
    if (!cursor) break;
  }

  return { created, updated, skipped };
}

module.exports = { runIngestion, loadCategories, inferCategoryId };
