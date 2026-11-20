/**
 * Authentication and User Profile Controller
 */

const { query } = require('../database/db');
const { hashPassword, comparePassword, generateToken } = require('../utils/auth-helpers');
const { getAllowedCategoryCodes, formatGradeLabel } = require('../utils/grade-rules');

/**
 * Sign In
 */
async function getPublicMembers(req, res) {
  try {
    const result = await query(
      `SELECT id, full_name, grade_level FROM users WHERE is_active = true AND role = 'member' ORDER BY grade_level DESC, id ASC`
    );
    if (result.rows.length === 0) {
      const { setupAdmin, setupFamilyMembers } = require('../scripts/setup-admin');
      await setupAdmin();
      await setupFamilyMembers();
      const retry = await query(
        "SELECT id, full_name, grade_level FROM users WHERE is_active = true AND role = 'member' ORDER BY grade_level DESC, id ASC"
      );
      return res.status(200).json({ members: retry.rows });
    }
    return res.status(200).json({ members: result.rows });
  } catch (err) {
    if (err.code === '42P01') {
      try {
        const { runMigrations } = require('../database/migrate');
        const { setupAdmin, setupFamilyMembers } = require('../scripts/setup-admin');
        await runMigrations();
        await setupAdmin();
        await setupFamilyMembers();
        const retry = await query(
          `SELECT id, full_name, grade_level FROM users WHERE is_active = true AND role = 'member' ORDER BY grade_level DESC, id ASC`
        );
        return res.status(200).json({ members: retry.rows });
      } catch (migErr) {
        return res.status(500).json({ error: 'هەڵەیەک ڕوویدا', details: migErr.message });
      }
    }
    console.error('getPublicMembers error:', err);
    return res.status(500).json({ error: 'هەڵەیەک ڕوویدا', details: err.message });
  }
}

async function login(req, res) {
  const { userId, email, adminName, password } = req.body;

  if ((!userId && !email && !adminName) || !password) {
    return res.status(400).json({
      error: 'تکایە ناو یان ئیمەیڵ و تێپەڕەوشە بنووسە',
      errorEn: 'Name/email and password are required.'
    });
  }

  try {
    let userRes;
    if (userId) {
      userRes = await query(
        `SELECT id, email, password_hash, full_name, role, grade_level, photo_url, phone, is_active 
         FROM users WHERE id = $1`,
        [parseInt(userId, 10)]
      );
    } else if (adminName) {
      const secret = (process.env.ADMIN_PASSWORD || '1234554321').trim();
      if (password !== secret) {
        return res.status(401).json({ error: 'تێپەڕەوشەی بەڕێوەبەر هەڵەیە', errorEn: 'Invalid admin password.' });
      }
      const cleanName = adminName.trim();
      userRes = await query(
        `SELECT id, email, password_hash, full_name, role, grade_level, photo_url, phone, is_active 
         FROM users WHERE role = 'admin' AND LOWER(full_name) = LOWER($1)`,
        [cleanName]
      );
      if (userRes.rows.length === 0) {
        const genEmail = `${cleanName.replace(/\s+/g, '').toLowerCase() || 'admin'}@library.krd`;
        const hash = await hashPassword(secret);
        userRes = await query(
          `INSERT INTO users (email, password_hash, full_name, role, grade_level, is_active)
           VALUES ($1, $2, $3, 'admin', 13, true)
           ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name, role = 'admin', password_hash = EXCLUDED.password_hash
           RETURNING id, email, password_hash, full_name, role, grade_level, photo_url, phone, is_active`,
          [genEmail, hash, cleanName]
        );
      }
    } else {
      userRes = await query(
        `SELECT id, email, password_hash, full_name, role, grade_level, photo_url, phone, is_active 
         FROM users WHERE LOWER(email) = LOWER($1)`,
        [email.trim()]
      );
    }

    if (userRes.rows.length === 0) {
      return res.status(401).json({
        error: 'ئیمەیڵ یان تێپەڕەوشە هەڵەیە',
        errorEn: 'Invalid email or password.'
      });
    }

    const user = userRes.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        error: 'هەژمارەکەت ناچالاک کراوە، تکایە پەیوەندی بە بەڕێوەبەری کتێبخانەوە بکە',
        errorEn: 'Your account has been deactivated. Please contact the library administrator.'
      });
    }

    const isMatch = await comparePassword(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({
        error: 'ئیمەیڵ یان تێپەڕەوشە هەڵەیە',
        errorEn: 'Invalid email or password.'
      });
    }

    // Generate JWT token
    const token = generateToken({
      id: user.id,
      email: user.email,
      role: user.role
    });

    // Count currently borrowed books
    const loanCountRes = await query(
      `SELECT COUNT(*)::int as count FROM loans WHERE user_id = $1 AND returned_at IS NULL`,
      [user.id]
    );

    const safeUser = {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      gradeLevel: user.grade_level,
      gradeLabel: formatGradeLabel(user.grade_level),
      photoUrl: user.photo_url,
      phone: user.phone,
      activeLoansCount: loanCountRes.rows[0].count,
      allowedCategories: getAllowedCategoryCodes(user.grade_level)
    };

    return res.json({
      message: 'بە سەرکەوتوویی چوویتە ژوورەوە',
      messageEn: 'Signed in successfully.',
      token,
      user: safeUser
    });
  } catch (err) {
    console.error('❌ [Login Error]:', err.message);
    return res.status(500).json({
      error: 'هەڵەیەک لە سەروەردا ڕوویدا لە کاتی چوونەژوورەوە',
      errorEn: 'Internal server error during authentication.'
    });
  }
}

/**
 * Register Member (Controlled Account Creation)
 * Only signed-in administrators can create new member accounts.
 */
async function registerMember(req, res) {
  const { email, password, fullName, gradeLevel, photoUrl, phone, role } = req.body;

  if (!email || !password || !fullName) {
    return res.status(400).json({
      error: 'تکایە هەموو زانیارییە پێویستەکان پڕبکەرەوە (ناو، ئیمەیڵ، تێپەڕەوشە)',
      errorEn: 'Full name, email, and password are required.'
    });
  }

  const grade = parseInt(gradeLevel, 10) || 1;
  if (grade < 1 || grade > 13) {
    return res.status(400).json({
      error: 'پۆلی خوێندن دەبێت لەنێوان ١ بۆ ١٢ بێت، یان ١٣ بۆ سەروو پۆلی ١٢',
      errorEn: 'Grade level must be between 1 and 12, or 13 for Above Grade 12.'
    });
  }

  if (password.length < 6) {
    return res.status(400).json({
      error: 'تێپەڕەوشە دەبێت بەلایەنی کەمەوە ٦ پیت یان ژمارە بێت',
      errorEn: 'Password must be at least 6 characters long.'
    });
  }

  try {
    const existing = await query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email.trim()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'ئەم ئیمەیڵە پێشتر بەکارهاتووە، تکایە ئیمەیڵێکی تر هەڵبژێرە',
        errorEn: 'An account with this email already exists.'
      });
    }

    const passwordHash = await hashPassword(password);
    const assignedRole = role === 'admin' ? 'admin' : 'member';

    const insertRes = await query(
      `INSERT INTO users (email, password_hash, full_name, role, grade_level, photo_url, phone, is_active)
       VALUES (LOWER($1), $2, $3, $4, $5, $6, $7, true)
       RETURNING id, email, full_name, role, grade_level, photo_url, phone, created_at;`,
      [email.trim(), passwordHash, fullName.trim(), assignedRole, grade, photoUrl || null, phone || null]
    );

    const newUser = insertRes.rows[0];

    return res.status(201).json({
      message: 'هەژماری ئەندام بە سەرکەوتوویی دروستکرا',
      messageEn: 'Member account created successfully.',
      member: {
        id: newUser.id,
        email: newUser.email,
        fullName: newUser.full_name,
        role: newUser.role,
        gradeLevel: newUser.grade_level,
        gradeLabel: formatGradeLabel(newUser.grade_level),
        photoUrl: newUser.photo_url,
        phone: newUser.phone,
        createdAt: newUser.created_at
      }
    });
  } catch (err) {
    console.error('❌ [Register Error]:', err.message);
    return res.status(500).json({
      error: 'هەڵەیەک ڕوویدا لە دروستکردنی هەژمار',
      errorEn: 'Database error creating user account.'
    });
  }
}

/**
 * Get current authenticated user profile
 */
async function getMe(req, res) {
  try {
    const loanCountRes = await query(
      `SELECT COUNT(*)::int as count FROM loans WHERE user_id = $1 AND returned_at IS NULL`,
      [req.user.id]
    );

    return res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        fullName: req.user.full_name,
        role: req.user.role,
        gradeLevel: req.user.grade_level,
        gradeLabel: formatGradeLabel(req.user.grade_level),
        photoUrl: req.user.photo_url,
        phone: req.user.phone,
        activeLoansCount: loanCountRes.rows[0].count,
        allowedCategories: getAllowedCategoryCodes(req.user.grade_level)
      }
    });
  } catch (err) {
    console.error('❌ [GetMe Error]:', err.message);
    return res.status(500).json({
      error: 'هەڵەیەک ڕوویدا لە هێنانی زانیاری هەژمار',
      errorEn: 'Error retrieving profile.'
    });
  }
}

/**
 * Update current user profile (photo, phone, full_name)
 */
async function updateMe(req, res) {
  const { fullName, photoUrl, phone, password } = req.body;

  try {
    let updateFields = [];
    let params = [];
    let idx = 1;

    if (fullName && fullName.trim()) {
      updateFields.push(`full_name = $${idx++}`);
      params.push(fullName.trim());
    }

    if (photoUrl !== undefined) {
      updateFields.push(`photo_url = $${idx++}`);
      params.push(photoUrl ? photoUrl.trim() : null);
    }

    if (phone !== undefined) {
      updateFields.push(`phone = $${idx++}`);
      params.push(phone ? phone.trim() : null);
    }

    if (password && password.trim().length >= 6) {
      const passwordHash = await hashPassword(password.trim());
      updateFields.push(`password_hash = $${idx++}`);
      params.push(passwordHash);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        error: 'هیچ زانیارییەک بۆ نوێکردنەوە دیاری نەکراوە',
        errorEn: 'No update data provided.'
      });
    }

    updateFields.push(`updated_at = NOW()`);
    params.push(req.user.id);

    const updateQuery = `
      UPDATE users 
      SET ${updateFields.join(', ')} 
      WHERE id = $${idx}
      RETURNING id, email, full_name, role, grade_level, photo_url, phone;
    `;

    const resUpdate = await query(updateQuery, params);
    const updated = resUpdate.rows[0];

    return res.json({
      message: 'پڕۆفایلەکەت بە سەرکەوتوویی نوێکرایەوە',
      messageEn: 'Profile updated successfully.',
      user: {
        id: updated.id,
        email: updated.email,
        fullName: updated.full_name,
        role: updated.role,
        gradeLevel: updated.grade_level,
        gradeLabel: formatGradeLabel(updated.grade_level),
        photoUrl: updated.photo_url,
        phone: updated.phone,
        allowedCategories: getAllowedCategoryCodes(updated.grade_level)
      }
    });
  } catch (err) {
    console.error('❌ [UpdateMe Error]:', err.message);
    return res.status(500).json({
      error: 'هەڵە لە نوێکردنەوەی پڕۆفایل',
      errorEn: 'Error updating profile.'
    });
  }
}

module.exports = {
  getPublicMembers,
  login,
  registerMember,
  getMe,
  updateMe
};
