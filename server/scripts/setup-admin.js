/**
 * Administrator Account Setup Script
 * Sets up administrator account using environment variables or CLI inputs.
 * Default admin password: 1234554321
 */

const { query, close } = require('../database/db');
const { hashPassword } = require('../utils/auth-helpers');

async function setupAdmin(customEmail, customPassword, customName) {
  const email = (customEmail || process.env.ADMIN_EMAIL || 'admin@library.krd').trim().toLowerCase();
  const password = (customPassword || process.env.ADMIN_PASSWORD || '1234554321').trim();
  const name = (customName || process.env.ADMIN_NAME || 'بەڕێوەبەری سەرەکی').trim();

  console.log(`🔒 [Setup Admin] Setting up administrator account for: ${email}`);

  try {
    const passwordHash = await hashPassword(password);

    const checkRes = await query('SELECT id, email, role FROM users WHERE email = $1', [email]);

    if (checkRes.rows.length > 0) {
      await query(
        `UPDATE users 
         SET password_hash = $1, full_name = $2, role = 'admin', grade_level = 13, is_active = true, updated_at = NOW()
         WHERE email = $3`,
        [passwordHash, name, email]
      );
      console.log(`✅ [Setup Admin] Administrator account '${email}' updated successfully with password: ${password}`);
    } else {
      await query(
        `INSERT INTO users (email, password_hash, full_name, role, grade_level, is_active)
         VALUES ($1, $2, $3, 'admin', 13, true)`,
        [email, passwordHash, name]
      );
      console.log(`✅ [Setup Admin] Administrator account '${email}' created successfully with password: ${password}`);
    }

    return { email, role: 'admin' };
  } catch (err) {
    console.error('❌ [Setup Admin] Database error:', err.message);
    throw err;
  }
}


const FAMILY_MEMBERS = [
  { email: 'honya.hiwa@family.krd', fullName: 'هۆنیا هیوا', password: '17102007', gradeLevel: 13 },
  { email: 'nuh.hiwa@family.krd', fullName: 'نوح هیوا', password: '31082010', gradeLevel: 11 },
  { email: 'bavin.keywan@family.krd', fullName: 'باڤین کیوان', password: '19122010', gradeLevel: 10 },
  { email: 'honyar.hunar@family.krd', fullName: 'هۆنیار هونەر', password: '29042011', gradeLevel: 10 },
  { email: 'siver.kochar@family.krd', fullName: 'سیڤەر کۆچەر', password: '15072012', gradeLevel: 9 },
  { email: 'ahmad.keywan@family.krd', fullName: 'احمد کیوان', password: '18072013', gradeLevel: 8 },
  { email: 'sara.kochar@family.krd', fullName: 'سارا کۆچەر', password: '12082014', gradeLevel: 7 },
  { email: 'kozhin.keywan@family.krd', fullName: 'کۆژین کیوان', password: '03092014', gradeLevel: 7 },
  { email: 'nazgul.hunar@family.krd', fullName: 'نازگول هونەر', password: '03122014', gradeLevel: 6 },
  { email: 'hud.hiwa@family.krd', fullName: 'هود هیوا', password: '21032016', gradeLevel: 5 },
  { email: 'hani.halmat@family.krd', fullName: 'هەنی هەڵمەت', password: '29122016', gradeLevel: 4 },
  { email: 'sarin.kochar@family.krd', fullName: 'سارین کۆچەر', password: '08032017', gradeLevel: 4 },
  { email: 'shko.kosrat@family.krd', fullName: 'شکۆ کۆسرەت', password: '19072017', gradeLevel: 4 },
  { email: 'nwan.hunar@family.krd', fullName: 'نوان هونەر', password: '28082019', gradeLevel: 2 },
  { email: 'washan.arkan@family.krd', fullName: 'وەشەن ئەرکان', password: '29092019', gradeLevel: 2 },
];

async function setupFamilyMembers() {
  for (const m of FAMILY_MEMBERS) {
    const existing = await query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) OR full_name = $2', [m.email, m.fullName]);
    if (existing.rows.length === 0) {
      const hash = await hashPassword(m.password);
      await query(
        `INSERT INTO users (email, password_hash, full_name, role, grade_level, is_active)
         VALUES ($1, $2, $3, 'member', $4, true)
         ON CONFLICT (email) DO NOTHING`,
        [m.email, hash, m.fullName, m.gradeLevel]
      );
      console.log(`👨‍👩‍👧 [Setup Family] Added member: ${m.fullName}`);
    }
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const emailArg = args[0];
  const passArg = args[1];
  const nameArg = args[2];

  setupAdmin(emailArg, passArg, nameArg)
    .then(() => close().then(() => process.exit(0)))
    .catch(() => process.exit(1));
}

module.exports = {
  setupAdmin,
  setupFamilyMembers
};
