require('dotenv').config();
const mysql = require('mysql2/promise');

const IST = 'INTERVAL 5 HOUR + INTERVAL 30 MINUTE';
const dry = process.argv.includes('--dry');

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DATABASE_HOST,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    port: +(process.env.DATABASE_PORT || 3306),
    dateStrings: true,
  });

  const steps = [
    {
      label: 'A) id>=33754 today: createdAt+updatedAt+sourceUpdatedAt UTC→IST',
      select: `SELECT COUNT(*) n FROM products WHERE id >= 33754 AND createdAt >= '2026-11-09 00:00:00' AND createdAt < '2026-11-09 12:00:00'`,
      update: `UPDATE products SET createdAt = createdAt + ${IST}, updatedAt = updatedAt + ${IST}, sourceUpdatedAt = CASE WHEN sourceUpdatedAt IS NOT NULL THEN sourceUpdatedAt + ${IST} ELSE NULL END WHERE id >= 33754 AND createdAt >= '2026-11-09 00:00:00' AND createdAt < '2026-11-09 12:00:00'`,
    },
    {
      label: 'B) id 33718-33753 today updatedAt<createdAt: updatedAt+sourceUpdatedAt UTC→IST',
      select: `SELECT COUNT(*) n FROM products WHERE id BETWEEN 33718 AND 33753 AND createdAt >= '2026-11-09 00:00:00' AND updatedAt < createdAt`,
      update: `UPDATE products SET updatedAt = updatedAt + ${IST}, sourceUpdatedAt = CASE WHEN sourceUpdatedAt IS NOT NULL THEN sourceUpdatedAt + ${IST} ELSE NULL END WHERE id BETWEEN 33718 AND 33753 AND createdAt >= '2026-11-09 00:00:00' AND updatedAt < createdAt`,
    },
    {
      label: 'C) remaining updatedAt < createdAt: updatedAt UTC→IST',
      select: `SELECT COUNT(*) n FROM products WHERE updatedAt < createdAt`,
      update: `UPDATE products SET updatedAt = updatedAt + ${IST} WHERE updatedAt < createdAt`,
    },
    {
      label: 'D) today id<33718 sourceUpdatedAt morning UTC→IST',
      select: `SELECT COUNT(*) n FROM products WHERE sourceUpdatedAt >= '2026-11-09 00:00:00' AND sourceUpdatedAt < '2026-11-09 12:00:00' AND id < 33718`,
      update: `UPDATE products SET sourceUpdatedAt = sourceUpdatedAt + ${IST} WHERE sourceUpdatedAt >= '2026-11-09 00:00:00' AND sourceUpdatedAt < '2026-11-09 12:00:00' AND id < 33718`,
    },
  ];

  for (const s of steps) {
    const [cnt] = await c.query(s.select);
    const n = cnt[0].n;
    if (dry) {
      console.log(`[dry] ${s.label}: would affect ${n}`);
    } else if (n === 0) {
      console.log(`${s.label}: 0 rows — skip`);
    } else {
      const [res] = await c.query(s.update);
      console.log(`${s.label}: affected=${res.affectedRows}`);
    }
  }

  const [bad] = await c.query('SELECT COUNT(*) n FROM products WHERE updatedAt < createdAt');
  console.log('\nVerify updatedAt < createdAt:', bad[0].n);

  const [latest] = await c.query(
    `SELECT id, title, createdAt, updatedAt, sourceUpdatedAt
     FROM products WHERE status='active'
     ORDER BY createdAt DESC, id DESC LIMIT 15`
  );
  console.log('\nLatest Deals order:');
  console.table(latest);

  const [recent] = await c.query(
    'SELECT id, createdAt, updatedAt, sourceUpdatedAt FROM products WHERE id >= 33743 ORDER BY id'
  );
  console.log('id>=33743:');
  console.table(recent);

  await c.end();
  console.log(dry ? '\n[DRY RUN — no writes]' : '\n[Done]');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
