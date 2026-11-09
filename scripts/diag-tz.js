require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DATABASE_HOST,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    port: +(process.env.DATABASE_PORT || 3306),
    dateStrings: true,
  });

  // All products touched today
  const [today] = await c.query(
    `SELECT id, title, createdAt, updatedAt, sourceUpdatedAt, seoStatus
     FROM products
     WHERE createdAt >= '2026-11-09 00:00:00' OR updatedAt >= '2026-11-09 00:00:00'
     ORDER BY id`
  );
  console.log('Today rows:', today.length);
  console.table(today);

  // Pattern buckets
  const [p1] = await c.query(
    `SELECT COUNT(*) n FROM products
     WHERE updatedAt < createdAt AND createdAt >= '2026-11-09 00:00:00'`
  );
  console.log('Today: updatedAt < createdAt (IST created, UTC updated):', p1[0].n);

  const [p2] = await c.query(
    `SELECT COUNT(*) n FROM products
     WHERE createdAt >= '2026-11-09 00:00:00' AND createdAt < '2026-11-09 12:00:00'
       AND id >= 33754`
  );
  console.log('Today id>=33754 morning createdAt (UTC created):', p2[0].n);

  // Older bad rows (updatedAt < createdAt before today)
  const [old] = await c.query(
    `SELECT id, createdAt, updatedAt FROM products
     WHERE updatedAt < createdAt AND createdAt < '2026-11-09 00:00:00'
     ORDER BY id DESC LIMIT 20`
  );
  console.log('Older updatedAt < createdAt:', old.length);
  console.table(old);

  // What does latest sort currently show?
  const [latest] = await c.query(
    `SELECT id, title, createdAt FROM products
     WHERE status='active' ORDER BY createdAt DESC, id DESC LIMIT 15`
  );
  console.log('Current Latest Deals order:');
  console.table(latest);

  await c.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
