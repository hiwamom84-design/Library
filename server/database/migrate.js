/**
 * Database Migration Script
 * Reads and applies schema.sql to the Railway PostgreSQL database.
 * Sets up mandatory grade categories and registers migration state.
 */

const fs = require('fs');
const path = require('path');
const { getClient, close } = require('./db');

const INITIAL_CATEGORIES = [
  { code: 'G1_3', name_ckb: 'پۆلی ١–٣', name_en: 'Grades 1–3', min: 1, max: 3, sort: 1 },
  { code: 'G4_6', name_ckb: 'پۆلی ٤–٦', name_en: 'Grades 4–6', min: 4, max: 6, sort: 2 },
  { code: 'G7_9', name_ckb: 'پۆلی ٧–٩', name_en: 'Grades 7–9', min: 7, max: 9, sort: 3 },
  { code: 'G10_12', name_ckb: 'پۆلی ١٠–١٢', name_en: 'Grades 10–12', min: 10, max: 12, sort: 4 },
  { code: 'ABOVE_12', name_ckb: 'سەروو پۆلی ١٢', name_en: 'Above grade 12', min: 13, max: 99, sort: 5 }
];

async function runMigrations() {
  console.log('🚀 [Migrations] Starting PostgreSQL database migrations...');
  let schemaSql;
  try {
    schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  } catch (_) {
    schemaSql = require('./schema-sql').SCHEMA_SQL;
  }

  let client;
  try {
    client = await getClient();
  } catch (err) {
    console.error('❌ [Migrations] Failed to connect to database for migrations:', err.message);
    throw err;
  }

  try {
    await client.query('BEGIN');

    console.log('📄 [Migrations] Executing schema.sql tables, constraints, and indexes...');
    await client.query(schemaSql);
    await client.query("ALTER TABLE books ADD COLUMN IF NOT EXISTS page_count INTEGER DEFAULT NULL;");
    await client.query("ALTER TABLE books ADD COLUMN IF NOT EXISTS book_type VARCHAR(60) DEFAULT 'other';");

    // Seed default grade categories if not already present
    console.log('📚 [Migrations] Verifying reading grade categories...');
    for (const cat of INITIAL_CATEGORIES) {
      await client.query(
        `INSERT INTO grade_categories (code, name_ckb, name_en, min_grade, max_grade, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (code) DO UPDATE 
         SET name_ckb = EXCLUDED.name_ckb,
             name_en = EXCLUDED.name_en,
             min_grade = EXCLUDED.min_grade,
             max_grade = EXCLUDED.max_grade,
             sort_order = EXCLUDED.sort_order;`,
        [cat.code, cat.name_ckb, cat.name_en, cat.min, cat.max, cat.sort]
      );
    }

    // Record migration in schema_migrations
    await client.query(
      `INSERT INTO schema_migrations (version, description)
       VALUES ('001_initial_schema', 'Initial database schema with books, users, copies, and loans')
       ON CONFLICT (version) DO NOTHING;`
    );

    await client.query('COMMIT');
    console.log('✅ [Migrations] Database migrations applied successfully.');
    return { success: true };
  } catch (err) {
    if (client) {
      await client.query('ROLLBACK');
    }
    console.error('❌ [Migrations] Error applying migrations:', err.message);
    throw err;
  } finally {
    if (client) {
      client.release();
    }
  }
}

// Allow direct CLI execution: node server/database/migrate.js
if (require.main === module) {
  runMigrations()
    .then(() => {
      close().then(() => process.exit(0));
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = {
  runMigrations
};
