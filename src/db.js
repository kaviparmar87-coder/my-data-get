const mysql = require('mysql2/promise');
const config = require('./config');

// Force Asia/Kolkata for any Date→string conversion (matches PHP site timezone)
const pool = mysql.createPool({
  ...config.db,
  timezone: '+05:30',
  dateStrings: true,
});

async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function getOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

module.exports = { pool, query, getOne };
