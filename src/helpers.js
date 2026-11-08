const STORE_MAP = {
  'amazon-in': 'amazon',
  amazon: 'amazon',
  flipkart: 'flipkart',
  myntra: 'myntra',
  ajio: 'ajio',
  meesho: 'meesho',
  croma: 'croma',
};

const CATEGORY_PATTERNS = [
  [/\b(5g|smartphone|redmi|galaxy|iphone|oneplus|vivo|oppo|realme|poco|moto|motorola|nokia|iqoo|narzo)\b/i, 'mobiles'],
  [/\b(laptop|notebook|ideapad|vivobook|macbook|ryzen|core i[3579])\b/i, 'laptops'],
  [/\b(tablet|\btab\b|ipad)\b/i, 'tablets'],
  [/\b(\btv\b|television|led tv|smart tv|google tv)\b/i, 'television'],
  [/\b(watch|smartwatch|colorfit|fire-?boltt|noise|boult|amoled)\b/i, 'smart-watches'],
  [/\b(headphone|earbud|earphone|neckband|airdopes|buds|speaker|soundbar|rockerz)\b/i, 'audio-video'],
  [/\b(shoe|sneaker|running shoes|loafers|sandal)\b/i, 'footwear'],
  [/\b(t-?shirt|jeans|shirt|kurta|dress|jacket|trouser|polo)\b/i, 'clothing'],
  [/\b(face wash|serum|shampoo|cream|lipstick|trimmer|straightener|perfume|fragrance)\b/i, 'personal-care'],
  [/\b(mixer|grinder|\bfan\b|refrigerator|washing machine|microwave|exhaust|appliance)\b/i, 'large-appliances'],
  [/\b(dal|atta|rice|grocery|masala|coffee|\btea\b|snack)\b/i, 'grocery'],
  [/\b(cable|charger|power ?bank|adapter|mouse|keyboard|bulb|led|\bssd\b|hard drive|pendrive|plug)\b/i, 'electronics'],
];

function normaliseStore(store) {
  if (STORE_MAP[store]) return STORE_MAP[store];
  return String(store || '').split('-')[0] || store || '';
}

function inferCategorySlug(name) {
  for (const [re, slug] of CATEGORY_PATTERNS) {
    if (re.test(name || '')) return slug;
  }
  return 'electronics';
}

function slugify(base, suffix) {
  let s = String(base || 'product')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  s = s.slice(0, 70);
  return `${s}-${suffix}`;
}

function truncate(str, max) {
  return String(str ?? '').slice(0, max);
}

function nowMysql() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = {
  STORE_MAP,
  CATEGORY_PATTERNS,
  normaliseStore,
  inferCategorySlug,
  slugify,
  truncate,
  nowMysql,
  sleep,
};
