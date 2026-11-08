const config = require('./config');
const { log, warn } = require('./logger');

const SYSTEM_PROMPT =
  'You are an expert SEO specialist for Indian ecommerce price-comparison sites. Reply with ONLY a single valid JSON object. No explanation, no markdown, no code fences.';

function buildPrompt(input, categories) {
  const catList = categories.map((c) => `${c.id}: ${c.name}`).join('\n');
  return `Analyze this Indian ecommerce product and return SEO-optimized data.

RAW PRODUCT NAME: "${input.sourceName}"
PRICE: ₹${input.price}
ORIGINAL PRICE: ₹${input.originalPrice}
STORE: "${input.marketplace}"
DISCOUNT: ${input.discountPercent}%

AVAILABLE CATEGORIES (pick the single best matching id):
${catList}

SEO RULES:
- title: 50-60 chars, brand + model + key feature, no keyword stuffing
- meta_description: 140-155 chars, include the ₹price + discount% + a call to action
- focus_keyword: what Indians actually search on Google
- og_title: max 60 chars, catchy with price
- faq: generate exactly 3 relevant FAQs that Indian shoppers would search for (e.g. price, features, compatibility, where to buy)

Return ONLY this exact JSON shape:
{"categoryId":1,"title":"...","metaDescription":"...","focusKeyword":"...","secondaryKeywords":["..."],"ogTitle":"...","ogDescription":"...","faq":[{"question":"...","answer":"..."},{"question":"...","answer":"..."},{"question":"...","answer":"..."}]}`;
}

function extractJson(text) {
  const fenced = String(text).replace(/```json|```/gi, '');
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return fenced.slice(start, end + 1);
}

function inferCategoryId(name, categories) {
  const { CATEGORY_PATTERNS } = require('./helpers');
  const bySlug = {};
  for (const c of categories) bySlug[c.slug] = Number(c.id);
  for (const [re, slug] of CATEGORY_PATTERNS) {
    if (re.test(name || '') && bySlug[slug] != null) return bySlug[slug];
  }
  return bySlug.electronics ?? (categories[0] ? Number(categories[0].id) : 1);
}

function fallback(input, categories) {
  const name = String(input.sourceName || '').replace(/\s+/g, ' ').trim();
  const short = name.slice(0, 60);
  const mp = input.marketplace;
  const discount = Number(input.discountPercent) || 0;
  const price = Number(input.price) || 0;
  const original = Number(input.originalPrice) || 0;

  return {
    categoryId: inferCategoryId(name, categories),
    title: name.slice(0, 70),
    metaDescription:
      `Buy ${short} at ₹${price}` +
      (discount > 0 ? ` (${discount}% off)` : '') +
      ` on ${mp}. Best price tracked on Top9deals.`,
    focusKeyword: `${short} price`,
    secondaryKeywords: [`${short} offer`, `${short} deal`, `${mp} ${short}`],
    ogTitle: `${short} - ₹${price}`,
    ogDescription: `Track the price of ${short}. Currently ₹${price} on ${mp}.`,
    faq: [
      {
        question: `What is the price of ${short} in India?`,
        answer: `${short} is currently priced at ₹${price} on ${mp}.`,
      },
      {
        question: `What is the discount on ${short}?`,
        answer:
          discount > 0
            ? `${short} is available at ${discount}% off. You save ₹${original - price} on ${mp}.`
            : `${short} is currently available at its regular price of ₹${price} on ${mp}.`,
      },
      {
        question: `Where can I buy ${short}?`,
        answer: `You can buy ${short} from ${mp}. Click the 'Buy on ${mp}' button on this page to go directly to the product page and complete your purchase.`,
      },
    ],
  };
}

function strOr(v, max, fb) {
  return typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : String(fb).slice(0, max);
}

function validate(ai, input, categories) {
  const validIds = categories.map((c) => Number(c.id));
  const categoryId =
    ai.categoryId != null && validIds.includes(Number(ai.categoryId))
      ? Number(ai.categoryId)
      : inferCategoryId(input.sourceName, categories);

  const fb = fallback(input, categories);

  const arr = (v) =>
    Array.isArray(v)
      ? v.slice(0, 8).filter((x) => typeof x === 'string')
      : [];

  let secondary = arr(ai.secondaryKeywords);
  if (!secondary.length) secondary = fb.secondaryKeywords;

  let faq = Array.isArray(ai.faq)
    ? ai.faq
        .slice(0, 6)
        .filter((f) => f && typeof f === 'object' && f.question && f.answer)
        .map((f) => ({ question: String(f.question), answer: String(f.answer) }))
    : [];
  if (!faq.length) faq = fb.faq;

  return {
    categoryId,
    title: strOr(ai.title, 300, fb.title),
    metaDescription: strOr(ai.metaDescription, 255, fb.metaDescription),
    focusKeyword: strOr(ai.focusKeyword, 200, fb.focusKeyword),
    secondaryKeywords: secondary,
    ogTitle: strOr(ai.ogTitle, 160, fb.ogTitle),
    ogDescription: strOr(ai.ogDescription, 255, fb.ogDescription),
    faq,
  };
}

async function callModel(model, input, categories) {
  const payload = {
    model,
    max_tokens: 1200,
    temperature: 0.4,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildPrompt(input, categories) },
    ],
  };

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(config.seo.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.seo.apiKey}`,
        'HTTP-Referer': config.siteUrl,
        'X-Title': 'OfferHatke',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text();

    if (!res.ok) {
      warn(`OpenRouter HTTP ${res.status} (${model}) for #${input.id}: ${text.slice(0, 160)}`);
      return { result: null, rateLimited: res.status === 429 };
    }
    if (!text) return { result: null, rateLimited: false };

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { result: null, rateLimited: false };
    }

    if (data.error) {
      const code = String(data.error.code ?? '');
      warn(`OpenRouter error (${model}) for #${input.id}: ${JSON.stringify(data.error).slice(0, 160)}`);
      return { result: null, rateLimited: code === '429' };
    }

    const content = data.choices?.[0]?.message?.content ?? '';
    const jsonStr = extractJson(content);
    if (!jsonStr) {
      warn(`No JSON in reply (${model}) for #${input.id}: ${content.slice(0, 140)}`);
      return { result: null, rateLimited: false };
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      warn(`JSON parse failed (${model}) for #${input.id}`);
      return { result: null, rateLimited: false };
    }

    if (parsed.title == null) return { result: null, rateLimited: false };
    return { result: parsed, rateLimited: false };
  } catch (e) {
    warn(`Model ${model} failed for #${input.id}: ${e.message}`);
    return { result: null, rateLimited: false };
  } finally {
    clearTimeout(t);
  }
}

async function callAi(input, categories) {
  for (const model of config.seo.models) {
    const { result } = await callModel(model, input, categories);
    if (result !== null) return result;
  }
  return null;
}

async function enrich(input, categories) {
  if (config.seo.enabled && config.seo.apiKey) {
    const ai = await callAi(input, categories);
    if (ai !== null) {
      return { seo: validate(ai, input, categories), viaAi: true };
    }
  }
  return { seo: fallback(input, categories), viaAi: false };
}

module.exports = { enrich, fallback, inferCategoryId, buildPrompt };
