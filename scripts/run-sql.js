// scripts/run-sql.js — Run a SQL file via Cloud SQL Proxy (no psql required).
// Reads DATABASE_URL from .env.local automatically.
//
// Usage:
//   node scripts/run-sql.js db/seed.sql
//   node scripts/run-sql.js data/wards_real.sql
//   node scripts/run-sql.js db/ward_population.sql
//   node scripts/run-sql.js db/rls_policies.sql   ← injects WEB_PASSWORD from env

'use strict';
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Basic manual parsing of .env.local
function loadEnv() {
  const envPath = path.join(__dirname, '../.env.local');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!match) return;
    const key = match[1];
    let value = (match[2] || '').trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  });
}

// Extract password from a postgres connection URL
function extractPassword(url) {
  try { return new URL(url).password; } catch { return ''; }
}

async function run() {
  loadEnv();

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('❌ DATABASE_URL not found in .env.local'); process.exit(1); }

  const sqlFile = process.argv[2];
  if (!sqlFile) { console.error('❌ Usage: node scripts/run-sql.js <file.sql>'); process.exit(1); }

  const sqlFilePath = path.join(__dirname, '../', sqlFile);
  if (!fs.existsSync(sqlFilePath)) { console.error(`❌ Not found: ${sqlFilePath}`); process.exit(1); }

  console.log(`🔌 Connecting to ${dbUrl.replace(/:([^:@]+)@/, ':***@')} ...`);
  const client = new Client({ connectionString: dbUrl });

  try {
    await client.connect();
    console.log(`✓ Connected`);

    // For rls_policies.sql: inject web_password as a session GUC so
    // current_setting('web_password', true) resolves inside the DO block.
    if (sqlFile.includes('rls_policies')) {
      const webPwd = extractPassword(process.env.WEB_DATABASE_URL || '') || extractPassword(dbUrl);
      if (!webPwd) { console.error('❌ Cannot determine web_password — check WEB_DATABASE_URL in .env.local'); process.exit(1); }
      await client.query(`SET "app.web_password" = '${webPwd.replace(/'/g, "''")}'`);
      console.log(`✓ web_password GUC set`);
    }

    console.log(`📖 Executing ${sqlFile} ...`);
    const sql = fs.readFileSync(sqlFilePath, 'utf-8');
    await client.query(sql);
    console.log(`✅ Done: ${sqlFile}`);
  } catch (err) {
    console.error(`❌ Error:`, err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
