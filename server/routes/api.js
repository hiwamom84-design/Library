/**
 * API Router
 * Defines and mounts all endpoints for authentication, books, reviews, favorites, leaderboard, loans, and admin operations.
 */

let router;
try {
  const express = require('express');
  router = express.Router();
} catch (e) {
  const { createMiniApp } = require('../utils/mini-express');
  router = createMiniApp();
}

const { checkHealth } = require('../database/db');
const { authenticateToken, optionalAuth, requireAdmin } = require('../middleware/auth');

const authController = require('../controllers/authController');
const bookController = require('../controllers/bookController');
const loanController = require('../controllers/loanController');
const adminController = require('../controllers/adminController');

// 1. Health check & Diagnostics
router.get('/health', async (req, res) => {
  const dbHealth = await checkHealth();
  const statusCode = dbHealth.healthy ? 200 : 503;
  return res.status(statusCode).json({
    status: dbHealth.healthy ? 'ok' : 'degraded',
    service: 'Community Library API',
    timestamp: new Date().toISOString(),
    database: dbHealth,
    environment: process.env.NODE_ENV || 'development'
  });
});

// 2. Categories & Leaderboard
router.get('/categories', adminController.getCategories);
router.get('/leaderboard', bookController.getLeaderboard);

// 3. Authentication & Member Profile
router.get('/auth/members', authController.getPublicMembers);
router.post('/auth/login', authController.login);
router.post('/auth/register-request', authController.requestMembership);
router.get('/auth/me', authenticateToken, authController.getMe);
router.put('/auth/profile', authenticateToken, authController.updateMe);
router.post('/auth/members', authenticateToken, requireAdmin, authController.registerMember);

// 4. Books Catalog, Reviews, Favorites & Permanent Deletion
router.get('/books', optionalAuth, bookController.getBooks);
router.get('/books/:id', optionalAuth, bookController.getBookById);
router.post('/books/:id/reviews', authenticateToken, bookController.addReview);
router.post('/books/:id/favorite', authenticateToken, bookController.toggleFavorite);
router.post('/books', authenticateToken, requireAdmin, bookController.createBook);
router.put('/books/:id', authenticateToken, requireAdmin, bookController.updateBook);
router.delete('/books/:id', authenticateToken, requireAdmin, bookController.deleteBook);
router.post('/books/:id/copies', authenticateToken, requireAdmin, bookController.addCopy);

// 5. Loans, Returns & Member Inventory
router.post('/loans/borrow', authenticateToken, loanController.borrowBook);
router.post('/loans/return', authenticateToken, loanController.returnBook);
router.get('/loans/my-inventory', authenticateToken, loanController.getMyLoans);
router.get('/loans/all', authenticateToken, requireAdmin, loanController.getAllLoans);
router.get('/loans/member/:userId', authenticateToken, loanController.getMemberLoanHistory);

// 6. Admin Area
router.get('/admin/dashboard', authenticateToken, requireAdmin, adminController.getDashboardStats);
router.get('/admin/members', authenticateToken, requireAdmin, adminController.getMembers);
router.put('/admin/members/:id', authenticateToken, requireAdmin, adminController.updateMember);
router.delete('/admin/members/:id', authenticateToken, requireAdmin, adminController.deleteMember);
router.get('/admin/requests', authenticateToken, requireAdmin, adminController.getPendingRequests);
router.post('/admin/requests/:id/approve', authenticateToken, requireAdmin, adminController.approveMemberRequest);
router.delete('/admin/requests/:id', authenticateToken, requireAdmin, adminController.rejectMemberRequest);

module.exports = router;
