/**
 * Loans, Returns, and Member Inventory Controller
 * Utilizes PostgreSQL ACID transactions and row-level locks
 * Enforces reading-grade authorization and active loan limits
 */

const { query, getClient } = require('../database/db');
const { config } = require('../config/config');
const { evaluateBorrowPermission } = require('../utils/grade-rules');

/**
 * Borrow a book
 * Atomic transaction with SELECT ... FOR UPDATE to prevent race conditions
 */

async function autoReturnExpiredLoans() {
  try {
    const expired = await query(
      `UPDATE loans
       SET returned_at = borrowed_at + INTERVAL '7 days', status = 'returned'
       WHERE returned_at IS NULL AND borrowed_at <= NOW() - INTERVAL '7 days'
       RETURNING copy_id`
    );
    if (expired.rows.length > 0) {
      const copyIds = expired.rows.map(r => r.copy_id);
      await query(`UPDATE book_copies SET status = 'available' WHERE id = ANY($1::int[])`, [copyIds]);
    }
  } catch (e) {
    console.error('autoReturnExpiredLoans error:', e.message);
  }
}

async function borrowBook(req, res) {
  await autoReturnExpiredLoans();
  const { bookId, customDueDays, notes } = req.body;
  const userId = req.user.id;

  if (!bookId) {
    return res.status(400).json({
      error: 'تکایە ناسنامەی کتێب دیاری بکە',
      errorEn: 'Book ID is required.'
    });
  }

  const client = await getClient();

  try {
    await client.query('BEGIN');

    // 1. Fetch user data with lock to ensure accurate active loan count
    const userRes = await client.query(
      `SELECT id, full_name, email, role, grade_level, is_active 
       FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );

    if (userRes.rows.length === 0 || !userRes.rows[0].is_active) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'هەژماری بەکارهێنەر ناچالاکە یان بوونی نییە',
        errorEn: 'User account is inactive or not found.'
      });
    }
    const member = userRes.rows[0];

    // 2. Fetch book details and reading-grade category
    const bookRes = await client.query(
      `SELECT b.id, b.title, b.author, b.is_archived, gc.code as category_code, gc.name_ckb as category_name
       FROM books b
       JOIN grade_categories gc ON b.grade_category_id = gc.id
       WHERE b.id = $1`,
      [bookId]
    );

    if (bookRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'کتێبەکە نەدۆزرایەوە',
        errorEn: 'Book not found.'
      });
    }

    const book = bookRes.rows[0];
    if (book.is_archived) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'ئەم کتێبە ئەرشیڤ کراوە و بۆ خواستن بەردەست نییە',
        errorEn: 'This book is archived and cannot be borrowed.'
      });
    }

    // 3. SERVER-SIDE READING-GRADE PERMISSION CHECK (Strict Enforcement)
    const permission = evaluateBorrowPermission(member.grade_level, book.category_code);
    if (!permission.allowed) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: `پۆلەکەت (${member.grade_level}) دەسەڵاتی خواستنی ئەم کتێبەی نییە. ${permission.reasonCkb}`,
        errorEn: `Grade permission denied. ${permission.reasonEn}`,
        code: 'GRADE_RESTRICTION'
      });
    }

    // 4. Check if member already has an active loan for this book title
    const existingTitleLoan = await client.query(
      `SELECT id FROM loans WHERE user_id = $1 AND book_id = $2 AND returned_at IS NULL`,
      [userId, bookId]
    );

    if (existingTitleLoan.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'تۆ لە ئێستادا نوسخەیەکت لەم کتێبە خوازتووە و هێشتا نەگەڕاندووەتەوە',
        errorEn: 'You already have an active loan for this book.'
      });
    }

    // 5. Enforce 1 Book Per Week Rule (7-day cooldown per member, admins exempt)
    if (member.role !== 'admin') {
      const weeklyLoanRes = await client.query(
        `SELECT id, borrowed_at,
                CEIL(EXTRACT(EPOCH FROM ((borrowed_at + INTERVAL '7 days') - NOW())) / 86400)::int as days_until_next
         FROM loans 
         WHERE user_id = $1 AND borrowed_at >= NOW() - INTERVAL '7 days'
         ORDER BY borrowed_at DESC
         LIMIT 1`,
        [userId]
      );

      if (weeklyLoanRes.rows.length > 0) {
        const daysLeft = Math.max(1, weeklyLoanRes.rows[0].days_until_next || 1);
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `هەر ئەندامێک تەنها دەتوانێت لە هەفتەیەکدا یەک کتێب بخوازێت. تکایە دوای ${daysLeft} ڕۆژی تر هەوڵبدەرەوە.`,
          errorEn: `Weekly limit reached: You can only borrow 1 book per week. Please try again in ${daysLeft} day(s).`,
          code: 'WEEKLY_LIMIT_REACHED',
          daysUntilNext: daysLeft
        });
      }
    }

    // 5b. Check active loans limit
    const activeLoansCountRes = await client.query(
      `SELECT COUNT(*)::int as count FROM loans WHERE user_id = $1 AND returned_at IS NULL`,
      [userId]
    );
    const currentActiveCount = activeLoansCountRes.rows[0].count;

    if (currentActiveCount >= config.maxActiveLoansPerMember && member.role !== 'admin') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `گەیشتوویتە بەرزترین ژمارەی ڕێگەپێدراوی کتێبی خوازراو (${config.maxActiveLoansPerMember} کتێب). تکایە سەرەتا کتێبێک بگێڕەوە.`,
        errorEn: `Loan limit reached (${config.maxActiveLoansPerMember} books maximum). Please return a book first.`
      });
    }

    // 6. Find an available physical copy with ROW LOCK to prevent concurrent duplicate loans
    const copyRes = await client.query(
      `SELECT id, copy_number 
       FROM book_copies 
       WHERE book_id = $1 AND status = 'available' 
       ORDER BY copy_number ASC 
       LIMIT 1 
       FOR UPDATE`,
      [bookId]
    );

    if (copyRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'هیچ نوسخەیەکی فیزیکی بەردەست نییە لەم کتێبە لە ئێستادا',
        errorEn: 'No physical copies of this book are currently available.'
      });
    }

    const copy = copyRes.rows[0];

    // 7. Calculate due date
    const loanDays = parseInt(customDueDays, 10) || config.loanPeriodDays;

    // 8. Update copy status to 'borrowed'
    await client.query(
      `UPDATE book_copies SET status = 'borrowed' WHERE id = $1`,
      [copy.id]
    );

    // 9. Insert loan record
    const loanRes = await client.query(
      `INSERT INTO loans (copy_id, book_id, user_id, borrowed_at, due_at, status, notes)
       VALUES ($1, $2, $3, NOW(), NOW() + ($4 || ' days')::INTERVAL, 'active', $5)
       RETURNING id, borrowed_at, due_at, status;`,
      [copy.id, book.id, userId, loanDays, notes ? notes.trim() : null]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      message: `کتێبی «${book.title}» بە سەرکەوتوویی خوازرا. کاتی گەڕاندنەوە دوای ${loanDays} ڕۆژە.`,
      messageEn: `"${book.title}" borrowed successfully. Due in ${loanDays} days.`,
      loan: {
        id: loanRes.rows[0].id,
        bookTitle: book.title,
        bookAuthor: book.author,
        copyNumber: copy.copy_number,
        borrowedAt: loanRes.rows[0].borrowed_at,
        dueAt: loanRes.rows[0].due_at,
        status: loanRes.rows[0].status
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ [BorrowBook Error]:', err.message);

    // Check PostgreSQL constraint violation (partial unique index)
    if (err.code === '23505' && err.constraint === 'idx_unique_active_loan_copy') {
      return res.status(409).json({
        error: 'ئەم نوسخەیە لە هەمان کاتدا لەلایەن کەسێکی ترەوە خوازراوە',
        errorEn: 'This physical copy was just borrowed by another user.'
      });
    }

    return res.status(500).json({
      error: 'هەڵە لە تۆمارکردنی خواستنی کتێب',
      errorEn: 'Error processing book loan.'
    });
  } finally {
    client.release();
  }
}

/**
 * Return a book
 * Atomic transaction: updates loan return timestamp and makes copy available
 */
async function returnBook(req, res) {
  const { loanId, notes } = req.body;
  const user = req.user;

  if (!loanId) {
    return res.status(400).json({
      error: 'تکایە ناسنامەی خواستن (Loan ID) دیاری بکە',
      errorEn: 'Loan ID is required.'
    });
  }

  const client = await getClient();

  try {
    await client.query('BEGIN');

    // 1. Lock loan record for update
    const loanRes = await client.query(
      `SELECT l.id, l.copy_id, l.book_id, l.user_id, l.returned_at, l.status,
              b.title as book_title, bc.copy_number, u.full_name as member_name
       FROM loans l
       JOIN books b ON l.book_id = b.id
       JOIN book_copies bc ON l.copy_id = bc.id
       JOIN users u ON l.user_id = u.id
       WHERE l.id = $1
       FOR UPDATE`,
      [loanId]
    );

    if (loanRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'تۆماری خواستنەکە نەدۆزرایەوە',
        errorEn: 'Loan record not found.'
      });
    }

    const loan = loanRes.rows[0];

    // 2. Authorization check: member can return their own book; admin can return/confirm any book
    if (loan.user_id !== user.id && user.role !== 'admin') {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: 'تۆ ناتوانیت کتێبی ئەندامێکی تر بگێڕیتەوە',
        errorEn: 'You cannot return a book borrowed by another member.'
      });
    }

    // 3. Check if already returned
    if (loan.returned_at !== null || loan.status === 'returned') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'ئەم کتێبە پێشتر گەڕێندراوەتەوە',
        errorEn: 'This book has already been returned.'
      });
    }

    // 4. Update loan record: set returned_at = NOW(), status = 'returned'
    // Permanent loan history is strictly preserved!
    const returnNotes = notes ? notes.trim() : (user.role === 'admin' ? 'گەڕاندنەوە لەلایەن بەڕێوەبەرەوە تۆمارکرا' : 'گەڕاندنەوە لەلایەن ئەندامەوە تۆمارکرا');
    const updateLoanRes = await client.query(
      `UPDATE loans 
       SET returned_at = NOW(), 
           status = 'returned', 
           notes = CASE WHEN notes IS NULL THEN $1 ELSE notes || ' | ' || $1 END,
           updated_at = NOW()
       WHERE id = $2
       RETURNING id, returned_at, status;`,
      [returnNotes, loanId]
    );

    // 5. Update physical copy status back to 'available'
    await client.query(
      `UPDATE book_copies 
       SET status = 'available' 
       WHERE id = $1;`,
      [loan.copy_id]
    );

    await client.query('COMMIT');

    return res.json({
      message: `کتێبی «${loan.book_title}» بە سەرکەوتوویی گەڕێندرایەوە و ئێستا لە کتێبخانە بەردەستە`,
      messageEn: `"${loan.book_title}" returned successfully and is now available in catalog.`,
      returnedLoan: {
        id: loan.id,
        bookTitle: loan.book_title,
        copyNumber: loan.copy_number,
        memberName: loan.member_name,
        returnedAt: updateLoanRes.rows[0].returned_at,
        status: updateLoanRes.rows[0].status
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ [ReturnBook Error]:', err.message);
    return res.status(500).json({
      error: 'هەڵە لە تۆمارکردنی گەڕاندنەوەی کتێب',
      errorEn: 'Error returning book.'
    });
  } finally {
    client.release();
  }
}

/**
 * Get current member's inventory (active loans) and personal borrowing history
 */
async function getMyLoans(req, res) {
  await autoReturnExpiredLoans();
  const userId = req.user.id;

  try {
    // Current Active Loans
    const activeRes = await query(
      `SELECT 
        l.id as loan_id,
        l.borrowed_at,
        l.due_at,
        l.status,
        b.id as book_id,
        b.title,
        b.author,
        b.cover_url,
        gc.name_ckb as category_name_ckb,
        gc.name_en as category_name_en,
        bc.copy_number,
        ROUND(EXTRACT(EPOCH FROM (l.due_at - NOW())) / 86400)::int as days_remaining,
        CASE WHEN NOW() > l.due_at THEN true ELSE false END as is_overdue
       FROM loans l
       JOIN books b ON l.book_id = b.id
       JOIN grade_categories gc ON b.grade_category_id = gc.id
       JOIN book_copies bc ON l.copy_id = bc.id
       WHERE l.user_id = $1 AND l.returned_at IS NULL
       ORDER BY l.due_at ASC`,
      [userId]
    );

    // Completed Past Loans
    const pastRes = await query(
      `SELECT 
        l.id as loan_id,
        l.borrowed_at,
        l.due_at,
        l.returned_at,
        l.status,
        b.id as book_id,
        b.title,
        b.author,
        b.cover_url,
        gc.name_ckb as category_name_ckb,
        gc.name_en as category_name_en,
        bc.copy_number
       FROM loans l
       JOIN books b ON l.book_id = b.id
       JOIN grade_categories gc ON b.grade_category_id = gc.id
       JOIN book_copies bc ON l.copy_id = bc.id
       WHERE l.user_id = $1 AND l.returned_at IS NOT NULL
       ORDER BY l.returned_at DESC`,
      [userId]
    );

    return res.json({
      activeLoansCount: activeRes.rows.length,
      currentInventory: activeRes.rows,
      pastLoansCount: pastRes.rows.length,
      pastLoans: pastRes.rows
    });
  } catch (err) {
    console.error('❌ [GetMyLoans Error]:', err.message);
    return res.status(500).json({
      error: 'هەڵە لە هێنانی مێژووی خواستنەکانی بەکارهێنەر',
      errorEn: 'Error loading loan history.'
    });
  }
}

/**
 * Get all loans across the library (Admin only)
 * Filters by status, search by member/book, date sorting
 */
async function getAllLoans(req, res) {
  await autoReturnExpiredLoans();
  const { status, q, user_id, book_id } = req.query;

  try {
    let whereClauses = [];
    let params = [];
    let idx = 1;

    if (status === 'active') {
      whereClauses.push('l.returned_at IS NULL');
    } else if (status === 'returned') {
      whereClauses.push('l.returned_at IS NOT NULL');
    } else if (status === 'overdue') {
      whereClauses.push('l.returned_at IS NULL AND NOW() > l.due_at');
    }

    if (user_id) {
      whereClauses.push(`l.user_id = $${idx++}`);
      params.push(user_id);
    }

    if (book_id) {
      whereClauses.push(`l.book_id = $${idx++}`);
      params.push(book_id);
    }

    if (q && q.trim()) {
      whereClauses.push(`(b.title ILIKE $${idx} OR u.full_name ILIKE $${idx} OR u.email ILIKE $${idx} OR bc.copy_number ILIKE $${idx})`);
      params.push(`%${q.trim()}%`);
      idx++;
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const loansQuery = `
      SELECT 
        l.id as loan_id,
        l.borrowed_at,
        l.due_at,
        l.returned_at,
        l.status,
        l.notes,
        b.id as book_id,
        b.title as book_title,
        b.author as book_author,
        b.cover_url as book_cover,
        bc.id as copy_id,
        bc.copy_number,
        u.id as user_id,
        u.full_name as member_name,
        u.email as member_email,
        u.grade_level as member_grade,
        u.photo_url as member_photo,
        CASE WHEN l.returned_at IS NULL AND NOW() > l.due_at THEN true ELSE false END as is_overdue
      FROM loans l
      JOIN books b ON l.book_id = b.id
      JOIN book_copies bc ON l.copy_id = bc.id
      JOIN users u ON l.user_id = u.id
      ${whereSql}
      ORDER BY l.borrowed_at DESC;
    `;

    const resLoans = await query(loansQuery, params);

    return res.json({
      total: resLoans.rows.length,
      loans: resLoans.rows
    });
  } catch (err) {
    console.error('❌ [GetAllLoans Error]:', err.message);
    return res.status(500).json({
      error: 'هەڵە لە هێنانی تۆمارەکانی خواستن',
      errorEn: 'Error loading library loan logs.'
    });
  }
}

/**
 * Get a specific member's complete borrowing history (Admin or self)
 */
async function getMemberLoanHistory(req, res) {
  const { userId } = req.params;

  // Authorization: must be admin or viewing own profile
  if (req.user.role !== 'admin' && req.user.id !== parseInt(userId, 10)) {
    return res.status(403).json({
      error: 'دەسەڵاتی بینینی مێژووی ئەم ئەندامەت نییە',
      errorEn: 'Access forbidden: cannot view another member\'s loan history.'
    });
  }

  try {
    const userRes = await query('SELECT id, full_name, email, grade_level, photo_url, role FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'ئەندامەکە نەدۆزرایەوە', errorEn: 'Member not found.' });
    }

    const member = userRes.rows[0];

    const historyRes = await query(
      `SELECT 
        l.id as loan_id,
        l.borrowed_at,
        l.due_at,
        l.returned_at,
        l.status,
        l.notes,
        b.id as book_id,
        b.title as book_title,
        b.author as book_author,
        b.cover_url as book_cover,
        bc.copy_number,
        gc.name_ckb as category_name_ckb,
        gc.name_en as category_name_en,
        CASE WHEN l.returned_at IS NULL AND NOW() > l.due_at THEN true ELSE false END as is_overdue
       FROM loans l
       JOIN books b ON l.book_id = b.id
       JOIN grade_categories gc ON b.grade_category_id = gc.id
       JOIN book_copies bc ON l.copy_id = bc.id
       WHERE l.user_id = $1
       ORDER BY l.borrowed_at DESC`,
      [userId]
    );

    const activeLoans = historyRes.rows.filter(r => r.returned_at === null);
    const completedLoans = historyRes.rows.filter(r => r.returned_at !== null);

    return res.json({
      member,
      totalLoansCount: historyRes.rows.length,
      activeLoansCount: activeLoans.length,
      completedLoansCount: completedLoans.length,
      activeLoans,
      completedLoans,
      allLoans: historyRes.rows
    });
  } catch (err) {
    console.error('❌ [GetMemberLoanHistory Error]:', err.message);
    return res.status(500).json({
      error: 'هەڵە لە هێنانی مێژووی ئەندام',
      errorEn: 'Error loading member borrowing history.'
    });
  }
}

module.exports = {
  borrowBook,
  returnBook,
  getMyLoans,
  getAllLoans,
  getMemberLoanHistory
};
