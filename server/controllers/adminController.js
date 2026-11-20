/**
 * Administrator Dashboard and Member Management Controller
 * Includes full profile inspection, role assignment, reader analytics, and member deletion
 */

const { query } = require('../database/db');
const { formatGradeLabel, getAllowedCategoryCodes } = require('../utils/grade-rules');

/**
 * Get comprehensive administrator dashboard statistics
 */
async function getDashboardStats(req, res) {
  try {
    const statsRes = await query(`
      SELECT 
        (SELECT COUNT(*)::int FROM books WHERE is_archived = false) as total_books,
        (SELECT COUNT(*)::int FROM book_copies) as total_copies,
        (SELECT COUNT(*)::int FROM book_copies WHERE status = 'available') as available_copies,
        (SELECT COUNT(*)::int FROM book_copies WHERE status = 'borrowed') as borrowed_copies,
        (SELECT COUNT(*)::int FROM users WHERE role = 'member' AND is_active = true) as active_members,
        (SELECT COUNT(*)::int FROM users WHERE role = 'admin') as admin_count,
        (SELECT COUNT(*)::int FROM users) as total_profiles_count,
        (SELECT COUNT(*)::int FROM loans WHERE returned_at IS NULL) as active_loans,
        (SELECT COUNT(*)::int FROM loans WHERE returned_at IS NOT NULL) as completed_loans,
        (SELECT COUNT(*)::int FROM loans WHERE returned_at IS NULL AND NOW() > due_at) as overdue_loans;
    `);

    const catBreakdownRes = await query(`
      SELECT 
        gc.id,
        gc.code,
        gc.name_ckb,
        gc.name_en,
        COUNT(b.id)::int as books_count,
        COUNT(bc.id)::int as copies_count
      FROM grade_categories gc
      LEFT JOIN books b ON gc.id = b.grade_category_id AND b.is_archived = false
      LEFT JOIN book_copies bc ON b.id = bc.book_id
      GROUP BY gc.id
      ORDER BY gc.sort_order ASC;
    `);

    // Most read books
    const topReadBooksRes = await query(`
      SELECT 
        b.id,
        b.title,
        b.author,
        gc.name_ckb as category_name,
        COUNT(l.id)::int as times_read_count,
        COUNT(DISTINCT l.user_id)::int as unique_readers_count
      FROM books b
      JOIN grade_categories gc ON b.grade_category_id = gc.id
      LEFT JOIN loans l ON b.id = l.book_id
      GROUP BY b.id, gc.id
      ORDER BY times_read_count DESC
      LIMIT 5;
    `);

    return res.json({
      stats: statsRes.rows[0],
      categoryBreakdown: catBreakdownRes.rows,
      topReadBooks: topReadBooksRes.rows
    });
  } catch (err) {
    console.error('❌ [DashboardStats Error]:', err.message);
    return res.status(500).json({
      error: 'هەڵە لە هێنانی ئامارەکان',
      errorEn: 'Error loading admin stats.'
    });
  }
}

/**
 * Get all registered profiles with full details (Admin can see everyone who logged in/signed up)
 */
async function getMembers(req, res) {
  const { q, grade, role, active } = req.query;

  try {
    let whereClauses = [];
    let params = [];
    let idx = 1;

    if (q && q.trim()) {
      whereClauses.push(`(u.full_name ILIKE $${idx} OR u.email ILIKE $${idx} OR u.phone ILIKE $${idx})`);
      params.push(`%${q.trim()}%`);
      idx++;
    }

    if (grade) {
      whereClauses.push(`u.grade_level = $${idx++}`);
      params.push(parseInt(grade, 10));
    }

    if (role) {
      whereClauses.push(`u.role = $${idx++}`);
      params.push(role);
    }

    if (active !== undefined && active !== '') {
      whereClauses.push(`u.is_active = $${idx++}`);
      params.push(active === 'true');
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const membersQuery = `
      SELECT 
        u.id,
        u.email,
        u.full_name,
        u.role,
        u.grade_level,
        u.photo_url,
        u.phone,
        u.is_active,
        u.created_at,
        u.updated_at,
        COUNT(l.id) FILTER (WHERE l.returned_at IS NULL)::int as active_loans_count,
        COUNT(l.id) FILTER (WHERE l.returned_at IS NOT NULL)::int as completed_loans_count,
        COUNT(l.id)::int as total_books_read_count
      FROM users u
      LEFT JOIN loans l ON u.id = l.user_id
      ${whereSql}
      GROUP BY u.id
      ORDER BY u.created_at DESC;
    `;

    const result = await query(membersQuery, params);

    const members = result.rows.map(m => ({
      ...m,
      gradeLabel: formatGradeLabel(m.grade_level),
      allowedCategories: getAllowedCategoryCodes(m.grade_level)
    }));

    return res.json({
      total: members.length,
      members
    });
  } catch (err) {
    console.error('❌ [GetMembers Error]:', err.message);
    return res.status(500).json({
      error: 'هەڵە لە هێنانی پڕۆفایلەکان',
      errorEn: 'Error loading profiles.'
    });
  }
}

/**
 * Update member account details, role assignment, or grade
 */
async function updateMember(req, res) {
  const { id } = req.params;
  const { fullName, gradeLevel, role, isActive, phone, photoUrl } = req.body;

  try {
    let updateFields = [];
    let params = [];
    let idx = 1;

    if (fullName && fullName.trim()) {
      updateFields.push(`full_name = $${idx++}`);
      params.push(fullName.trim());
    }

    if (gradeLevel !== undefined) {
      const g = parseInt(gradeLevel, 10);
      if (g >= 1 && g <= 13) {
        updateFields.push(`grade_level = $${idx++}`);
        params.push(g);
      }
    }

    // Role assignment: admin can add/grant or remove admin role
    if (role && (role === 'admin' || role === 'member')) {
      updateFields.push(`role = $${idx++}`);
      params.push(role);
    }

    if (isActive !== undefined) {
      updateFields.push(`is_active = $${idx++}`);
      params.push(Boolean(isActive));
    }

    if (phone !== undefined) {
      updateFields.push(`phone = $${idx++}`);
      params.push(phone ? phone.trim() : null);
    }

    if (photoUrl !== undefined) {
      updateFields.push(`photo_url = $${idx++}`);
      params.push(photoUrl ? photoUrl.trim() : null);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'هیچ زانیارییەک دیاری نەکراوە', errorEn: 'No update fields.' });
    }

    updateFields.push('updated_at = NOW()');
    params.push(id);

    const updateQuery = `
      UPDATE users 
      SET ${updateFields.join(', ')} 
      WHERE id = $${idx}
      RETURNING id, email, full_name, role, grade_level, photo_url, phone, is_active, updated_at;
    `;

    const resUpdate = await query(updateQuery, params);
    if (resUpdate.rows.length === 0) {
      return res.status(404).json({ error: 'ئەندامەکە نەدۆزرایەوە', errorEn: 'Member not found.' });
    }

    const updated = resUpdate.rows[0];
    return res.json({
      message: 'زانیاری و ڕۆڵی ئەندام بە سەرکەوتوویی نوێکرایەوە',
      messageEn: 'Member details and role updated successfully.',
      member: {
        ...updated,
        gradeLabel: formatGradeLabel(updated.grade_level)
      }
    });
  } catch (err) {
    console.error('❌ [UpdateMember Error]:', err.message);
    return res.status(500).json({
      error: 'هەڵە لە نوێکردنەوەی هەژماری ئەندام',
      errorEn: 'Error updating member account.'
    });
  }
}

/**
 * Permanently Delete Member Profile (Admin only)
 * Completely deletes the profile and all their loan records from PostgreSQL
 */
async function deleteMember(req, res) {
  const { id } = req.params;

  // Prevent admin from deleting themselves accidentally
  if (req.user.id === parseInt(id, 10)) {
    return res.status(400).json({
      error: 'ناتوانیت هەژماری بەڕێوەبەریی خۆت بسڕیتەوە',
      errorEn: 'You cannot delete your own admin account.'
    });
  }

  try {
    const userCheck = await query('SELECT id, full_name, email FROM users WHERE id = $1', [id]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'هەژمارەکە نەدۆزرایەوە', errorEn: 'User not found.' });
    }

    const userName = userCheck.rows[0].full_name;

    // Delete user from PostgreSQL (CASCADE handles loans)
    await query('DELETE FROM users WHERE id = $1', [id]);

    console.log(`🗑️ [Database] Member profile permanently deleted: ID ${id} (${userName})`);

    return res.json({
      message: `پڕۆفایلی «${userName}» بە هەمیشەیی لە بنکەدراوە سڕدرایەوە`,
      messageEn: `Profile "${userName}" permanently deleted from database.`,
      deletedUserId: id
    });
  } catch (err) {
    console.error('❌ [DeleteMember Error]:', err.message);
    return res.status(500).json({
      error: 'هەڵە لە سڕینەوەی هەژمار',
      errorEn: 'Error deleting member.'
    });
  }
}

/**
 * Get all Grade Categories metadata
 */
async function getCategories(req, res) {
  try {
    const resCats = await query(`
      SELECT 
        id, code, name_ckb, name_en, min_grade, max_grade, sort_order,
        (SELECT COUNT(*)::int FROM books WHERE grade_category_id = grade_categories.id AND is_archived = false) as active_books_count
      FROM grade_categories 
      ORDER BY sort_order ASC;
    `);

    return res.json({ categories: resCats.rows });
  } catch (err) {
    console.error('❌ [GetCategories Error]:', err.message);
    return res.status(500).json({
      error: 'هەڵە لە هێنانی پۆلەکان',
      errorEn: 'Error loading categories.'
    });
  }
}

module.exports = {
  getDashboardStats,
  getMembers,
  updateMember,
  deleteMember,
  getCategories
};
