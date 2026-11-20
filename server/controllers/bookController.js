/**
 * Book Catalog, Reviews, Favorites, and Copy Management Controller
 */

const { query, getClient } = require('../database/db');
const { evaluateBorrowPermission, formatGradeLabel } = require('../utils/grade-rules');

/**
 * Get all books with search, filters, ratings, favorites, and user-specific borrow permissions
 */
async function getBooks(req, res) {
  const { q, category, available_only, favorites_only, include_archived } = req.query;

  try {
    let whereClauses = [];
    let params = [];
    let idx = 1;

    const isAdmin = req.user && req.user.role === 'admin';
    if (!isAdmin || include_archived !== 'true') {
      whereClauses.push('b.is_archived = false');
    }

    if (q && q.trim()) {
      whereClauses.push(`(b.title ILIKE $${idx} OR b.author ILIKE $${idx} OR b.isbn ILIKE $${idx})`);
      params.push(`%${q.trim()}%`);
      idx++;
    }

    if (category && category.trim()) {
      whereClauses.push(`(gc.code = $${idx} OR gc.id::text = $${idx})`);
      params.push(category.trim());
      idx++;
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const booksQuery = `
      SELECT 
        b.id,
        b.title,
        b.author,
        b.isbn,
        b.description,
        b.cover_url,
        b.grade_category_id,
        b.is_archived,
        b.created_at,
        gc.code as category_code,
        gc.name_ckb as category_name_ckb,
        gc.name_en as category_name_en,
        gc.min_grade as category_min_grade,
        gc.max_grade as category_max_grade,
        COUNT(DISTINCT bc.id)::int as total_copies,
        COUNT(DISTINCT bc.id) FILTER (WHERE bc.status = 'available')::int as available_copies,
        COUNT(DISTINCT bc.id) FILTER (WHERE bc.status = 'borrowed')::int as borrowed_copies,
        COUNT(DISTINCT l.id)::int as total_loans_count,
        COUNT(DISTINCT l.user_id)::int as unique_readers_count,
        COALESCE(ROUND(AVG(br.rating), 1), 0)::float as avg_rating,
        COUNT(DISTINCT br.id)::int as reviews_count,
        MAX(CASE WHEN l.returned_at IS NULL THEN u_borrow.full_name END) as active_borrower_name
      FROM books b
      JOIN grade_categories gc ON b.grade_category_id = gc.id
      LEFT JOIN book_copies bc ON b.id = bc.book_id
      LEFT JOIN loans l ON b.id = l.book_id
      LEFT JOIN users u_borrow ON l.user_id = u_borrow.id
      LEFT JOIN book_reviews br ON b.id = br.book_id
      ${whereSql}
      GROUP BY b.id, gc.id
      ORDER BY b.created_at DESC;
    `;

    const result = await query(booksQuery, params);

    let userActiveLoanBookIds = new Set();
    let userFavoriteBookIds = new Set();
    if (req.user) {
      const [activeRes, favRes] = await Promise.all([
        query(`SELECT DISTINCT book_id FROM loans WHERE user_id = $1 AND returned_at IS NULL`, [req.user.id]),
        query(`SELECT book_id FROM favorites WHERE user_id = $1`, [req.user.id])
      ]);
      activeRes.rows.forEach(r => userActiveLoanBookIds.add(r.book_id));
      favRes.rows.forEach(r => userFavoriteBookIds.add(r.book_id));
    }

    const books = result.rows
      .filter(b => {
        if (available_only === 'true' && b.available_copies <= 0) return false;
        if (favorites_only === 'true' && !userFavoriteBookIds.has(b.id)) return false;
        return true;
      })
      .map(book => {
        let canBorrow = false;
        let gradeAllowed = false;
        let permissionReasonCkb = '';
        let permissionReasonEn = '';
        const userHasActiveLoan = req.user ? userActiveLoanBookIds.has(book.id) : false;
        const isFavorited = req.user ? userFavoriteBookIds.has(book.id) : false;

        if (!req.user) {
          canBorrow = false;
          gradeAllowed = false;
          permissionReasonCkb = 'پێویستە سەرەتا بچیتە ژوورەوە بۆ خواستنی کتێب';
          permissionReasonEn = 'Please sign in to borrow books.';
        } else if (userHasActiveLoan) {
          canBorrow = false;
          gradeAllowed = true;
          permissionReasonCkb = 'ئەم کتێبە لە ئێستادا لای خۆتە بۆ خوێندنەوە';
          permissionReasonEn = 'You currently have this book borrowed.';
        } else {
          const evalRes = evaluateBorrowPermission(req.user.grade_level, book.category_code);
          gradeAllowed = evalRes.allowed;

          if (!gradeAllowed) {
            canBorrow = false;
            permissionReasonCkb = evalRes.reasonCkb;
            permissionReasonEn = evalRes.reasonEn;
          } else if (book.available_copies <= 0) {
            canBorrow = false;
            permissionReasonCkb = 'هیچ نوسخەیەکی بەردەست نییە لە ئێستادا';
            permissionReasonEn = 'All copies are currently borrowed.';
          } else {
            canBorrow = true;
            permissionReasonCkb = 'دەتوانیت ئەم کتێبە بخوازیت';
            permissionReasonEn = 'Available for you to borrow.';
          }
        }

        return {
          ...book,
          canBorrow,
          gradeAllowed,
          permissionReasonCkb,
          permissionReasonEn,
          userHasActiveLoan,
          isFavorited
        };
      });

    return res.json({ count: books.length, books });
  } catch (err) {
    console.error('❌ [GetBooks Error]:', err.message);
    return res.status(500).json({
      error: 'هەڵەیەک ڕوویدا لە هێنانی لیستی کتێبەکان',
      errorEn: 'Error loading books catalog.'
    });
  }
}

/**
 * Get detailed book view with reviews, copies, and borrowing history (for admin)
 */
async function getBookById(req, res) {
  const { id } = req.params;

  try {
    const bookRes = await query(
      `SELECT 
        b.*,
        gc.code as category_code,
        gc.name_ckb as category_name_ckb,
        gc.name_en as category_name_en,
        COUNT(DISTINCT l.id)::int as total_loans_count,
        COUNT(DISTINCT l.user_id)::int as unique_readers_count,
        COALESCE(ROUND(AVG(br.rating), 1), 0)::float as avg_rating,
        COUNT(DISTINCT br.id)::int as reviews_count
      FROM books b
      JOIN grade_categories gc ON b.grade_category_id = gc.id
      LEFT JOIN loans l ON b.id = l.book_id
      LEFT JOIN book_reviews br ON b.id = br.book_id
      WHERE b.id = $1
      GROUP BY b.id, gc.id`,
      [id]
    );

    if (bookRes.rows.length === 0) {
      return res.status(404).json({ error: 'کتێبەکە نەدۆزرایەوە', errorEn: 'Book not found.' });
    }

    const book = bookRes.rows[0];

    const [copiesRes, reviewsRes] = await Promise.all([
      query(`SELECT id, copy_number, status, condition FROM book_copies WHERE book_id = $1 ORDER BY copy_number ASC`, [id]),
      query(
        `SELECT br.id, br.rating, br.comment, br.created_at, u.full_name as user_name, u.grade_level as user_grade
         FROM book_reviews br
         JOIN users u ON br.user_id = u.id
         WHERE br.book_id = $1
         ORDER BY br.created_at DESC`,
        [id]
      )
    ]);

    book.copies = copiesRes.rows;
    book.availableCopies = copiesRes.rows.filter(c => c.status === 'available').length;
    book.totalCopies = copiesRes.rows.length;
    book.reviews = reviewsRes.rows;

    if (req.user) {
      const evalRes = evaluateBorrowPermission(req.user.grade_level, book.category_code);
      book.gradeAllowed = evalRes.allowed;
      book.canBorrow = evalRes.allowed && book.availableCopies > 0;
      book.permissionReasonCkb = evalRes.reasonCkb;
      book.permissionReasonEn = evalRes.reasonEn;
    }

    if (req.user && req.user.role === 'admin') {
      const historyRes = await query(
        `SELECT l.id as loan_id, l.borrowed_at, l.due_at, l.returned_at, l.status as loan_status,
                bc.copy_number, u.full_name as user_name, u.grade_level as user_grade
         FROM loans l
         JOIN book_copies bc ON l.copy_id = bc.id
         JOIN users u ON l.user_id = u.id
         WHERE l.book_id = $1
         ORDER BY l.borrowed_at DESC`,
        [id]
      );
      book.borrowingHistory = historyRes.rows;
    }

    return res.json({ book });
  } catch (err) {
    console.error('❌ [GetBookById Error]:', err.message);
    return res.status(500).json({ error: 'هەڵە لە هێنانی زانیاری کتێب', errorEn: 'Error loading book details.' });
  }
}

/**
 * Add or update a book review and star rating (Signed-in members)
 */
async function addReview(req, res) {
  const { id } = req.params;
  const { rating, comment } = req.body;
  const numRating = parseInt(rating, 10);

  if (!numRating || numRating < 1 || numRating > 5) {
    return res.status(400).json({
      error: 'تکایە هەڵسەنگاندن لە ١ بۆ ٥ ئەستێرە هەڵبژێرە',
      errorEn: 'Rating must be between 1 and 5 stars.'
    });
  }

  try {
    await query(
      `INSERT INTO book_reviews (book_id, user_id, rating, comment)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (book_id, user_id) DO UPDATE
       SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, created_at = NOW()`,
      [id, req.user.id, numRating, comment ? comment.trim() : null]
    );

    return res.status(201).json({
      message: 'هەڵسەنگاندنەکەت بە سەرکەوتوویی تۆمارکرا ⭐',
      messageEn: 'Your review has been saved!'
    });
  } catch (err) {
    console.error('❌ [AddReview Error]:', err.message);
    return res.status(500).json({ error: 'هەڵە لە تۆمارکردنی هەڵسەنگاندن', errorEn: 'Error saving review.' });
  }
}

/**
 * Toggle favorite / wishlist for a book (Signed-in members)
 */
async function toggleFavorite(req, res) {
  const { id } = req.params;

  try {
    const existing = await query(`SELECT id FROM favorites WHERE book_id = $1 AND user_id = $2`, [id, req.user.id]);

    if (existing.rows.length > 0) {
      await query(`DELETE FROM favorites WHERE book_id = $1 AND user_id = $2`, [id, req.user.id]);
      return res.json({
        favorited: false,
        message: 'لە لیستی دڵخوازەکان لادرا',
        messageEn: 'Removed from favorites.'
      });
    } else {
      await query(`INSERT INTO favorites (book_id, user_id) VALUES ($1, $2)`, [id, req.user.id]);
      return res.json({
        favorited: true,
        message: 'زیادکرا بۆ لیستی دڵخوازەکان ❤️',
        messageEn: 'Added to favorites!'
      });
    }
  } catch (err) {
    console.error('❌ [ToggleFavorite Error]:', err.message);
    return res.status(500).json({ error: 'هەڵە لە گۆڕینی دڵخوازەکان', errorEn: 'Error toggling favorite.' });
  }
}

/**
 * Get Top Readers Leaderboard
 */
async function getLeaderboard(req, res) {
  try {
    const resBoard = await query(`
      SELECT 
        u.id,
        u.full_name,
        u.grade_level,
        u.photo_url,
        COUNT(l.id)::int as total_loans,
        COUNT(l.id) FILTER (WHERE l.returned_at IS NOT NULL)::int as completed_books
      FROM users u
      JOIN loans l ON u.id = l.user_id
      WHERE u.is_active = true
      GROUP BY u.id
      HAVING COUNT(l.id) > 0
      ORDER BY completed_books DESC, total_loans DESC
      LIMIT 10;
    `);

    const leaders = resBoard.rows.map((row, idx) => ({
      rank: idx + 1,
      id: row.id,
      fullName: row.full_name,
      gradeLevel: row.grade_level,
      gradeLabel: formatGradeLabel(row.grade_level),
      photoUrl: row.photo_url,
      totalLoans: row.total_loans,
      completedBooks: row.completed_books
    }));

    return res.json({ leaders });
  } catch (err) {
    console.error('❌ [Leaderboard Error]:', err.message);
    return res.status(500).json({ error: 'هەڵە لە هێنانی ڕیزبەندی خوێنەران', errorEn: 'Error loading leaderboard.' });
  }
}

async function createBook(req, res) {
  const { title, author, gradeCategoryId, categoryCode, coverUrl, description, copiesCount } = req.body;

  if (!title || !author) {
    return res.status(400).json({ error: 'تکایە ناوی کتێب و نووسەر دیاری بکە', errorEn: 'Title and author are required.' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    let targetCatId = gradeCategoryId;
    if (!targetCatId && categoryCode) {
      const catCheck = await client.query('SELECT id FROM grade_categories WHERE code = $1', [categoryCode]);
      if (catCheck.rows.length > 0) targetCatId = catCheck.rows[0].id;
    }

    if (!targetCatId) {
      const defaultCat = await client.query('SELECT id FROM grade_categories ORDER BY sort_order ASC LIMIT 1');
      targetCatId = defaultCat.rows[0].id;
    }

    const bookRes = await client.query(
      `INSERT INTO books (title, author, cover_url, description, grade_category_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, author, cover_url, description, grade_category_id, created_at;`,
      [title.trim(), author.trim(), coverUrl ? coverUrl.trim() : null, description ? description.trim() : null, targetCatId]
    );

    const book = bookRes.rows[0];
    const initialCopies = Math.max(1, parseInt(copiesCount, 10) || 1);

    const copies = [];
    for (let i = 1; i <= initialCopies; i++) {
      const copyNum = `BK-${book.id}-C${i}`;
      const copyRes = await client.query(
        `INSERT INTO book_copies (book_id, copy_number, status, condition)
         VALUES ($1, $2, 'available', 'good')
         RETURNING id, copy_number, status, condition;`,
        [book.id, copyNum]
      );
      copies.push(copyRes.rows[0]);
    }

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'کتێبەکە بە سەرکەوتوویی پاشەکەوت کرا',
      messageEn: 'Book saved permanently.',
      book: { ...book, copies }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ [CreateBook Error]:', err.message);
    return res.status(500).json({ error: 'هەڵە لە زیادکردنی کتێب', errorEn: 'Error creating book record.' });
  } finally {
    client.release();
  }
}

async function deleteBook(req, res) {
  const { id } = req.params;

  try {
    const checkRes = await query('SELECT id, title FROM books WHERE id = $1', [id]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: 'کتێبەکە نەدۆزرایەوە', errorEn: 'Book not found.' });
    }

    const bookTitle = checkRes.rows[0].title;
    await query('DELETE FROM books WHERE id = $1', [id]);

    return res.json({
      message: `کتێبی «${bookTitle}» بە هەمیشەیی سڕدرایەوە`,
      messageEn: `Book "${bookTitle}" permanently deleted.`,
      deletedBookId: id
    });
  } catch (err) {
    console.error('❌ [DeleteBook Error]:', err.message);
    return res.status(500).json({ error: 'هەڵە لە سڕینەوەی کتێب', errorEn: 'Error deleting book.' });
  }
}

async function updateBook(req, res) {
  const { id } = req.params;
  const { title, author, isbn, description, coverUrl, gradeCategoryId, isArchived } = req.body;

  try {
    let updateFields = [];
    let params = [];
    let idx = 1;

    if (title && title.trim()) { updateFields.push(`title = $${idx++}`); params.push(title.trim()); }
    if (author && author.trim()) { updateFields.push(`author = $${idx++}`); params.push(author.trim()); }
    if (isbn !== undefined) { updateFields.push(`isbn = $${idx++}`); params.push(isbn ? isbn.trim() : null); }
    if (description !== undefined) { updateFields.push(`description = $${idx++}`); params.push(description ? description.trim() : null); }
    if (coverUrl !== undefined) { updateFields.push(`cover_url = $${idx++}`); params.push(coverUrl ? coverUrl.trim() : null); }
    if (gradeCategoryId !== undefined) { updateFields.push(`grade_category_id = $${idx++}`); params.push(gradeCategoryId); }
    if (isArchived !== undefined) { updateFields.push(`is_archived = $${idx++}`); params.push(Boolean(isArchived)); }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'هیچ زانیارییەک دابین نەکراوە', errorEn: 'No update data provided.' });
    }

    updateFields.push(`updated_at = NOW()`);
    params.push(id);

    const resUpdate = await query(
      `UPDATE books SET ${updateFields.join(', ')} WHERE id = $${idx} RETURNING *;`,
      params
    );

    if (resUpdate.rows.length === 0) {
      return res.status(404).json({ error: 'کتێبەکە نەدۆزرایەوە', errorEn: 'Book not found.' });
    }

    return res.json({ message: 'کتێبەکە نوێکرایەوە', messageEn: 'Book updated.', book: resUpdate.rows[0] });
  } catch (err) {
    console.error('❌ [UpdateBook Error]:', err.message);
    return res.status(500).json({ error: 'هەڵە لە نوێکردنەوەی کتێب', errorEn: 'Error updating book.' });
  }
}

async function addCopy(req, res) {
  const { id } = req.params;
  const { copyNumber, condition } = req.body;

  try {
    let targetCopyNumber = copyNumber ? copyNumber.trim() : null;
    if (!targetCopyNumber) {
      const countRes = await query('SELECT COUNT(*)::int as count FROM book_copies WHERE book_id = $1', [id]);
      targetCopyNumber = `BK-${id}-C${(countRes.rows[0].count || 0) + 1}`;
    }

    const insertRes = await query(
      `INSERT INTO book_copies (book_id, copy_number, status, condition)
       VALUES ($1, $2, 'available', $3) RETURNING *;`,
      [id, targetCopyNumber, condition || 'good']
    );

    return res.status(201).json({ message: 'نوسخەی نوێ زیادکرا', messageEn: 'Copy added.', copy: insertRes.rows[0] });
  } catch (err) {
    console.error('❌ [AddCopy Error]:', err.message);
    return res.status(500).json({ error: 'هەڵە لە زیادکردنی نوسخە', errorEn: 'Error adding copy.' });
  }
}

module.exports = {
  getBooks,
  getBookById,
  addReview,
  toggleFavorite,
  getLeaderboard,
  createBook,
  deleteBook,
  updateBook,
  addCopy
};
