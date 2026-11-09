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

/** MySQL datetime string always in Asia/Kolkata — never process-local TZ. */
function nowMysql(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  // hour12:false can yield "24" for midnight in some engines
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
}

/** Convert any Date/ISO string to Asia/Kolkata MySQL datetime (for sourceUpdatedAt etc). */
function toMysqlIst(value) {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return nowMysql(d);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout(promise, ms, label = 'operation') {
  let t;
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

module.exports = {
  STORE_MAP,
  CATEGORY_PATTERNS,
  normaliseStore,
  inferCategorySlug,
  slugify,
  truncate,
  nowMysql,
  toMysqlIst,
  sleep,
  withTimeout,
};
