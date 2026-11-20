/**
 * Authentication and Role-Protection Middleware
 */

const { verifyToken } = require('../utils/auth-helpers');
const { query } = require('../database/db');

/**
 * Require valid JWT authentication
 */
async function authenticateToken(req, res, next) {
  let token = null;

  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({
      error: 'تکایە سەرەتا بچۆ ژوورەوە بۆ بەکارهێنانی ئەم تایبەتمەندییە',
      errorEn: 'Authentication required. Please sign in to access this feature.',
      code: 'AUTH_REQUIRED'
    });
  }

  const payload = verifyToken(token);
  if (!payload || !payload.id) {
    return res.status(401).json({
      error: 'بڕوانامەی چوونەژوورەوەت بەسەرچووە یان نادروستە، تکایە دووبارە بچۆ ژوورەوە',
      errorEn: 'Session expired or invalid. Please sign in again.',
      code: 'INVALID_TOKEN'
    });
  }

  try {
    const userRes = await query(
      `SELECT id, email, full_name, role, grade_level, photo_url, phone, is_active 
       FROM users WHERE id = $1`,
      [payload.id]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({
        error: 'هەژماری بەکارهێنەر نەدۆزرایەوە',
        errorEn: 'User account not found.',
        code: 'USER_NOT_FOUND'
      });
    }

    const user = userRes.rows[0];
    if (!user.is_active) {
      return res.status(403).json({
        error: 'هەژمارەکەت ناچالاک کراوە لەلایەن بەڕێوەبەرەوە',
        errorEn: 'Account is deactivated. Please contact the library administrator.',
        code: 'ACCOUNT_DEACTIVATED'
      });
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('❌ [Auth Middleware Error]:', err.message);
    return res.status(500).json({
      error: 'هەڵەیەک لە سەروەردا ڕوویدا لە کاتی پشتڕاستکردنەوە',
      errorEn: 'Internal authentication verification error.'
    });
  }
}

/**
 * Optional authentication: attaches user if token is valid, but allows guest access
 */
async function optionalAuth(req, res, next) {
  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    req.user = null;
    return next();
  }

  const payload = verifyToken(token);
  if (!payload || !payload.id) {
    req.user = null;
    return next();
  }

  try {
    const userRes = await query(
      `SELECT id, email, full_name, role, grade_level, photo_url, phone, is_active 
       FROM users WHERE id = $1 AND is_active = true`,
      [payload.id]
    );
    req.user = userRes.rows.length > 0 ? userRes.rows[0] : null;
  } catch (err) {
    req.user = null;
  }

  next();
}

/**
 * Require Administrator Role
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'تەنها بەڕێوەبەرانی کتێبخانە دەسەڵاتی ئەنجامدانی ئەم کردارەیان هەیە',
      errorEn: 'Access forbidden: administrator privileges required.',
      code: 'ADMIN_REQUIRED'
    });
  }
  next();
}

module.exports = {
  authenticateToken,
  optionalAuth,
  requireAdmin
};
