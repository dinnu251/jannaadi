// scripts/truncate-db.js — truncate all tables so SQL files can be re-run cleanly.
// Usage: node scripts/truncate-db.js
'use strict';
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadEnv() {
  const p = path.join(__dirname, '../.env.local');
  if (!fs.existsSync(p)) return;
  fs.readFileSync(p, 'utf-8').split('\n').forEach(line => {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"#\n]*)"?/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
}

async function run() {
  loadEnv();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('✓ Connected');

  const tables = [
    'audit_events',
    'deadletters',
    'submissions',
    'clusters',
    'ward_population_staging',
    'wards',
  ];

  for (const t of tables) {
    try {
      await client.query(`TRUNCATE ${t} CASCADE`);
      console.log(`  ✓ truncated ${t}`);
    } catch (e) {
      // table may not exist yet — skip
      console.log(`  – skipped ${t} (${e.message.split('\n')[0]})`);
    }
  }

  await client.end();
  console.log('\nDone. Re-run your SQL files now.');
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
