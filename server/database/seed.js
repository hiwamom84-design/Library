/**
 * Clean Database Initializer
 * Prepares the database with standard reading-grade categories only.
 * No dummy books or example members are added, giving the administrator
 * a clean slate to add real library books and real members.
 */

const { getClient, close } = require('./db');

const GRADE_CATEGORIES = [
  { code: 'G1_3', name_ckb: 'ئاستی پۆلی 1-3', name_en: 'Level of Grade 1-3', min_grade: 1, max_grade: 3, sort: 1 },
  { code: 'G4_6', name_ckb: 'ئاستی پۆلی 4-6', name_en: 'Level of Grade 4-6', min_grade: 4, max_grade: 6, sort: 2 },
  { code: 'G7_9', name_ckb: 'ئاستی پۆلی 7-9', name_en: 'Level of Grade 7-9', min_grade: 7, max_grade: 9, sort: 3 },
  { code: 'G10_12', name_ckb: 'ئاستی پۆلی 10-12', name_en: 'Level of Grade 10-12', min_grade: 10, max_grade: 12, sort: 4 },
  { code: 'ABOVE_12', name_ckb: 'گەورەساڵان', name_en: 'Adults (18+)', min_grade: 13, max_grade: 99, sort: 5 }
];

async function seedDatabase() {
  console.log('🌱 [Database Initializer] Initializing clean library environment...');
  let client;

  try {
    client = await getClient();
    await client.query('BEGIN');

    // Ensure grade categories exist
    console.log('📚 [Database Initializer] Verifying reading-grade categories...');
    for (const cat of GRADE_CATEGORIES) {
      await client.query(
        `INSERT INTO grade_categories (code, name_ckb, name_en, min_grade, max_grade, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (code) DO UPDATE 
         SET name_ckb = EXCLUDED.name_ckb,
             name_en = EXCLUDED.name_en,
             min_grade = EXCLUDED.min_grade,
             max_grade = EXCLUDED.max_grade,
             sort_order = EXCLUDED.sort_order;`,
        [cat.code, cat.name_ckb, cat.name_en, cat.min_grade, cat.max_grade, cat.sort]
      );
    }

    await client.query('COMMIT');
    console.log('✅ [Database Initializer] Clean environment ready. No sample books or fake members added.');
    console.log('👉 To create your real administrator account, run:');
    console.log('   ADMIN_EMAIL="admin@library.krd" ADMIN_PASSWORD="YourPassword123!" npm run setup-admin\n');
    return { success: true };
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    console.error('❌ [Database Initializer] Error:', err.message);
    throw err;
  } finally {
    if (client) client.release();
  }
}

if (require.main === module) {
  seedDatabase()
    .then(() => close().then(() => process.exit(0)))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = {
  seedDatabase
};
