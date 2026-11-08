const { query } = require('./db');
const { enrich } = require('./openRouter');
const { nowMysql, sleep } = require('./helpers');
const config = require('./config');
const { log, warn } = require('./logger');

function buildProductSchema(seo, product, input) {
  const priceValidUntil = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const schema = {
    '@context': 'https://schema.org/',
    '@type': 'Product',
    name: seo.title,
    image: product.imageUrl || '',
    description: seo.metaDescription,
    offers: {
      '@type': 'Offer',
      price: input.price,
      priceCurrency: 'INR',
      availability: 'https://schema.org/InStock',
      url: `${config.siteUrl}/product/${product.slug}`,
      priceValidUntil,
    },
  };

  if (config.seo.includeAggregateRating && input.rating && input.ratingCount) {
    schema.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: input.rating,
      reviewCount: input.ratingCount,
      bestRating: '5',
      worstRating: '1',
    };
  }

  return schema;
}

function buildFaqSchema(seo) {
  if (!Array.isArray(seo.faq) || !seo.faq.length) return null;
  const entities = seo.faq.slice(0, 6).map((f) => ({
    '@type': 'Question',
    name: f.question,
    acceptedAnswer: { '@type': 'Answer', text: f.answer },
  }));
  if (!entities.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: entities,
  };
}

async function enrichOne(p, categories) {
  const input = {
    id: Number(p.id),
    sourceName: p.sourceName,
    price: Number(p.price) || 0,
    originalPrice: Number(p.originalPrice) || 0,
    discountPercent: Number(p.discountPercent) || 0,
    marketplace: p.marketplace,
    rating: p.rating != null ? Number(p.rating) : null,
    ratingCount: p.ratingCount != null ? Number(p.ratingCount) : null,
    imageUrl: p.imageUrl,
    affiliateUrl: p.affiliateUrl,
  };

  const { seo, viaAi } = await enrich(input, categories);
  const schemaJson = buildProductSchema(seo, p, input);
  const faqSchema = buildFaqSchema(seo);

  await query(
    `UPDATE products SET title=?, categoryId=?, metaDescription=?, focusKeyword=?,
     secondaryKeywords=?, ogTitle=?, ogDescription=?, schemaJson=?, faqSchema=?,
     seoStatus='done', updatedAt=? WHERE id=?`,
    [
      seo.title,
      seo.categoryId,
      seo.metaDescription,
      seo.focusKeyword,
      JSON.stringify(seo.secondaryKeywords),
      seo.ogTitle,
      seo.ogDescription,
      JSON.stringify(schemaJson),
      faqSchema ? JSON.stringify(faqSchema) : null,
      nowMysql(),
      p.id,
    ]
  );

  return viaAi;
}

async function runSeoBatch() {
  if (!config.seo.enabled || !config.seo.apiKey) {
    return { processed: 0, viaAi: 0 };
  }

  const pending = await query(
    `SELECT id, slug, categoryId, sourceName, price, originalPrice, discountPercent,
     marketplace, rating, ratingCount, imageUrl, affiliateUrl
     FROM products WHERE seoStatus IN ('pending','failed')
     ORDER BY updatedAt ASC LIMIT ?`,
    [config.seo.batchSize]
  );

  if (!pending.length) return { processed: 0, viaAi: 0 };

  const categories = await query('SELECT id, name, slug FROM categories');
  let processed = 0;
  let viaAi = 0;

  for (const p of pending) {
    try {
      const usedAi = await enrichOne(p, categories);
      processed++;
      if (usedAi) viaAi++;
    } catch (e) {
      warn(`SEO failed for product #${p.id}: ${e.message}`);
    }
    if (config.seo.callDelayMs > 0) {
      await sleep(config.seo.callDelayMs);
    }
  }

  log(`SEO enriched ${processed} product(s) (${viaAi} via AI)`);
  return { processed, viaAi };
}

module.exports = { runSeoBatch };
