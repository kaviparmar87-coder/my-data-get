/** Read public deals from the page and let its own UI make signed API requests. */
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
    const browser = await puppeteer.launch({ headless: true });
    try {
        const page = await browser.newPage();
        const response = await page.goto('https://pricehistoryapp.com/latest-deals', {
            waitUntil: 'networkidle2', timeout: 45000,
        });
        if (!response.ok()) throw new Error('Deals page HTTP ' + response.status());
        // Next.js can consume and clear its runtime queue during hydration.
        // Read the original inline JSON records without executing page scripts.
        const html = await response.text();
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
        await browser.close();
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
