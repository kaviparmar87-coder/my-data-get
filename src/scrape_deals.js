/** Read public deals from the page and let its own UI make signed API requests. */
const path = require('path');
const fs = require('fs');

// Project-local Chrome cache (same as scripts/install-chrome.js)
const PROJECT_ROOT = path.join(__dirname, '..');
const CHROME_CACHE = process.env.PUPPETEER_CACHE_DIR || path.join(PROJECT_ROOT, '.cache', 'puppeteer');
process.env.PUPPETEER_CACHE_DIR = CHROME_CACHE;
process.env.PUPPETEER_SKIP_DOWNLOAD = 'true';

function findChromeExecutable() {
    const pathFile = path.join(PROJECT_ROOT, '.cache', 'chrome-path.txt');
    const candidates = [
        process.env.PUPPETEER_EXECUTABLE_PATH,
        fs.existsSync(pathFile) ? fs.readFileSync(pathFile, 'utf8').trim() : null,
        path.join(CHROME_CACHE, 'chrome', 'linux-131.0.6778.204', 'chrome-linux64', 'chrome'),
        path.join(CHROME_CACHE, 'chrome', 'win64-131.0.6778.204', 'chrome-win64', 'chrome.exe'),
        // system chrome on linux hosts
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium-browser',
        '/usr/bin/chromium',
    ];
    for (const p of candidates) {
        if (p && fs.existsSync(p)) return p;
    }
    try {
        const found = walkForChrome(CHROME_CACHE);
        if (found) return found;
    } catch { /* */ }
    return null;
}

function walkForChrome(root, depth = 0) {
    if (depth > 6 || !fs.existsSync(root)) return null;
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
        const p = path.join(root, e.name);
        if (e.isFile() && (e.name === 'chrome' || e.name === 'chrome.exe')) return p;
        if (e.isDirectory()) {
            const f = walkForChrome(p, depth + 1);
            if (f) return f;
        }
    }
    return null;
}

function ensureChromeSync() {
    let exe = findChromeExecutable();
    if (exe) return exe;
    console.log('[scrape] Chrome missing — running install-chrome.js ...');
    const r = require('child_process').spawnSync(
        process.execPath,
        [path.join(PROJECT_ROOT, 'scripts', 'install-chrome.js')],
        { stdio: 'inherit', env: { ...process.env, PUPPETEER_CACHE_DIR: CHROME_CACHE, PUPPETEER_SKIP_DOWNLOAD: 'true' } }
    );
    console.log('[scrape] install exit =', r.status);
    exe = findChromeExecutable();
    return exe;
}

const puppeteer = require('puppeteer');

function initialDeals(stream) {
    for (const line of stream.split('\n')) {
        const colon = line.indexOf(':');
        if (colon < 0) continue;
        let value;
        try { value = JSON.parse(line.slice(colon + 1)); } catch { continue; }
        const visit = (node) => {
            if (!node || typeof node !== 'object') return null;
            if (Array.isArray(node.initialDeals)) return node;
            for (const child of Object.values(node)) {
                const found = visit(child);
                if (found) return found;
            }
            return null;
        };
        const found = visit(value);
        if (found) return found;
    }
    throw new Error('The deals page no longer contains initialDeals.');
}

function normalize(deal) {
    if (deal.product?._id) return deal;
    if (!deal.productId || !deal.url || !deal.title || !Number.isFinite(deal.rawPrice)) {
        throw new Error('The deals page returned an unsupported product format.');
    }
    return {
        product: { _id: deal.productId, url: deal.url, name: deal.title, slug: deal.id,
            image: deal.image, rating: deal.rating, rating_count: deal.ratingCount },
        store: deal.storeId, price: deal.rawPrice,
        highest_price: Number(String(deal.original).replace(/[^\d.]/g, '')) || deal.rawPrice,
        discount: deal.rawDiscount, deal_score: deal.score,
        updatedAt: deal.priceCheckedAt, is_all_time_low: deal.isAllTimeLow,
        rare: deal.rare, featured: deal.featured,
    };
}

async function scrape(body) {
    const limit = Number(body.limit ?? 28);
    const offset = body.cursor ? Number(String(body.cursor).replace(/^browser:/, '')) : 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 ||
        !Number.isInteger(offset) || offset < 0 || offset > 5000 ||
        (body.cursor && !/^browser:\d+$/.test(body.cursor))) {
        throw new Error('Unsupported browser pagination parameters. Retry from the first page.');
    }
    let executablePath = findChromeExecutable();
    if (!executablePath) {
        executablePath = ensureChromeSync();
    }
    if (!executablePath) {
        throw new Error('Chrome executable not found even after install. cache=' + CHROME_CACHE);
    }
    console.log('[scrape] using Chrome:', executablePath);
    const { withTimeout } = require('./helpers');
    const browser = await withTimeout(
        puppeteer.launch({
            headless: true,
            executablePath,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
            ],
        }),
        60000,
        'puppeteer-launch'
    );
    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 768 });

        let response = null;
        let lastErr = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                response = await page.goto('https://pricehistoryapp.com/latest-deals', {
                    waitUntil: 'domcontentloaded',
                    timeout: 45000,
                });
                break;
            } catch (e) {
                lastErr = e;
                if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
            }
        }
        if (!response) throw lastErr || new Error('Navigation failed after retries');

        // Wait for Next.js flight data / hydration to settle
        await new Promise(r => setTimeout(r, 3000));

        if (!response.ok()) throw new Error('Deals page HTTP ' + response.status());
        const html = await page.content();
        const stream = [...html.matchAll(/self\.__next_f\.push\((\[.*?\])\)<\/script>/gs)]
            .map(match => {
                try {
                    const entry = JSON.parse(match[1]);
                    return entry[0] === 1 && typeof entry[1] === 'string' ? entry[1] : '';
                } catch { return ''; }
            }).join('');
        const initial = initialDeals(stream);
        let deals = initial.initialDeals.map(normalize);
        let more = Boolean(initial.initialCursor);
        const eligible = () => deals.filter(deal => Number(deal.discount ?? 0) >= Number(body.minDiscount || 0));
        for (let pages = 0; eligible().length < offset + limit && more; pages++) {
            if (pages >= 50) throw new Error('Browser pagination limit reached before requested products were found.');
            const pending = page.waitForResponse(r => new URL(r.url()).pathname === '/api/deals'
                && r.request().method() === 'POST', { timeout: 30000 });
            pending.catch(() => {});
            const clicked = await page.evaluate(() => {
                const button = [...document.querySelectorAll('button')]
                    .find(button => button.textContent.trim() === 'Load more' && !button.disabled);
                if (!button) return false;
                button.click();
                return true;
            });
            if (!clicked) throw new Error('The deals page has no available Load more button.');
            const next = await pending;
            if (!next.ok()) throw new Error('Website Load more request failed: HTTP ' + next.status());
            const json = await next.json();
            const rows = json.data ?? json.deals;
            if (!Array.isArray(rows)) throw new Error('Unsupported Load more response.');
            deals.push(...rows.map(normalize));
            more = Boolean(json.nextCursor ?? json.cursor);
            if (!rows.length) more = false;
            if (more) await page.waitForFunction(() => [...document.querySelectorAll('button')]
                .some(button => button.textContent.trim() === 'Load more' && !button.disabled), { timeout: 15000 });
        }
        const filtered = eligible();
        return { data: filtered.slice(offset, offset + limit),
            nextCursor: more || filtered.length > offset + limit ? 'browser:' + (offset + limit) : null };
    } finally {
        await browser.close().catch(() => {});
    }
}

module.exports = { initialDeals, normalize, scrape };
if (require.main === module) {
    Promise.resolve().then(() => scrape(process.argv[2]
        ? JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'))
        : { limit: 28, minDiscount: 0, cursor: null }))
        .then(data => console.log(JSON.stringify(data)))
        .catch(error => { console.log(JSON.stringify({ error: error.message })); process.exitCode = 1; });
}
