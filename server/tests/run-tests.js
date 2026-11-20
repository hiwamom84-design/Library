/**
 * Comprehensive Test Suite
 * Tests business logic, security helpers, grade-based borrowing rules,
 * database schema integrity, and live PostgreSQL integration when available.
 */

const fs = require('fs');
const path = require('path');
const { evaluateBorrowPermission, getAllowedCategoryCodes, formatGradeLabel } = require('../utils/grade-rules');
const { hashPassword, comparePassword, generateToken, verifyToken } = require('../utils/auth-helpers');
const { maskDatabaseUrl } = require('../config/config');
const { checkHealth } = require('../database/db');

let passedTests = 0;
let failedTests = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    failedTests++;
  }
}

async function runTestSuite() {
  console.log('====================================================');
  console.log('🧪 RUNNING COMPREHENSIVE LIBRARY TEST SUITE');
  console.log('====================================================\n');

  // TEST SUITE 1: Reading Grade Borrowing Rules Engine
  console.log('📋 [Test Suite 1] Reading Grade Access Control:');
  
  // Grade 1-3 can borrow ONLY G1_3
  assert(evaluateBorrowPermission(2, 'G1_3').allowed === true, 'Grade 2 member CAN borrow G1_3 books');
  assert(evaluateBorrowPermission(2, 'G4_6').allowed === false, 'Grade 2 member CANNOT borrow G4_6 books');
  assert(evaluateBorrowPermission(3, 'ABOVE_12').allowed === false, 'Grade 3 member CANNOT borrow Above Grade 12 books');

  // Grade 4-6 can borrow G1_3 and G4_6
  assert(evaluateBorrowPermission(5, 'G1_3').allowed === true, 'Grade 5 member CAN borrow G1_3 books');
  assert(evaluateBorrowPermission(5, 'G4_6').allowed === true, 'Grade 5 member CAN borrow G4_6 books');
  assert(evaluateBorrowPermission(5, 'G7_9').allowed === false, 'Grade 5 member CANNOT borrow G7_9 books');

  // Grade 7-9 can borrow G1_3, G4_6, and G7_9
  assert(evaluateBorrowPermission(8, 'G1_3').allowed === true, 'Grade 8 member CAN borrow G1_3 books');
  assert(evaluateBorrowPermission(8, 'G4_6').allowed === true, 'Grade 8 member CAN borrow G4_6 books');
  assert(evaluateBorrowPermission(8, 'G7_9').allowed === true, 'Grade 8 member CAN borrow G7_9 books');
  assert(evaluateBorrowPermission(8, 'G10_12').allowed === false, 'Grade 8 member CANNOT borrow G10_12 books');

  // Grade 10-12 can borrow G1_3, G4_6, G7_9, and G10_12 (ALL except ABOVE_12)
  assert(evaluateBorrowPermission(11, 'G1_3').allowed === true, 'Grade 11 member CAN borrow G1_3 books');
  assert(evaluateBorrowPermission(11, 'G4_6').allowed === true, 'Grade 11 member CAN borrow G4_6 books');
  assert(evaluateBorrowPermission(11, 'G7_9').allowed === true, 'Grade 11 member CAN borrow G7_9 books');
  assert(evaluateBorrowPermission(11, 'G10_12').allowed === true, 'Grade 11 member CAN borrow G10_12 books');
  assert(evaluateBorrowPermission(11, 'ABOVE_12').allowed === false, 'Grade 11 member CANNOT borrow Above Grade 12 books');

  // Grade 13 (Above Grade 12) can borrow EVERY category
  assert(evaluateBorrowPermission(13, 'G1_3').allowed === true, 'Adult (Grade 13) CAN borrow G1_3 books');
  assert(evaluateBorrowPermission(13, 'G4_6').allowed === true, 'Adult (Grade 13) CAN borrow G4_6 books');
  assert(evaluateBorrowPermission(13, 'G7_9').allowed === true, 'Adult (Grade 13) CAN borrow G7_9 books');
  assert(evaluateBorrowPermission(13, 'G10_12').allowed === true, 'Adult (Grade 13) CAN borrow G10_12 books');
  assert(evaluateBorrowPermission(13, 'ABOVE_12').allowed === true, 'Adult (Grade 13) CAN borrow Above Grade 12 books');

  // Kurdish Grade Label Formatting
  assert(formatGradeLabel(5).ckb === 'پۆلی ٥', 'Kurdish grade label formatted correctly for school grade');
  assert(formatGradeLabel(13).ckb.includes('سەروو پۆلی ١٢'), 'Kurdish grade label formatted correctly for Above Grade 12');

  console.log('\n🔒 [Test Suite 2] Security & Authentication Helpers:');
  const testPassword = 'SecureSecretPassword2026!';
  const hash = await hashPassword(testPassword);
  assert(typeof hash === 'string' && hash.length > 20, 'Password hashed successfully');
  
  const correctMatch = await comparePassword(testPassword, hash);
  assert(correctMatch === true, 'Password comparison succeeds with correct password');

  const wrongMatch = await comparePassword('WrongPassword123!', hash);
  assert(wrongMatch === false, 'Password comparison safely fails with incorrect password');

  // Token Generation & Verification
  const tokenPayload = { id: 42, email: 'member@family.krd', role: 'member' };
  const token = generateToken(tokenPayload);
  assert(typeof token === 'string' && token.split('.').length === 3, 'JWT token generated with 3 segments');

  const decoded = verifyToken(token);
  assert(decoded && decoded.id === 42 && decoded.email === 'member@family.krd', 'JWT token verified and payload extracted');

  const invalidToken = verifyToken('header.payload.invalidsignature');
  assert(invalidToken === null, 'Tampered token rejected by verifyToken');

  console.log('\n📄 [Test Suite 3] Schema & Constraint Integrity:');
  const schemaSql = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8');
  assert(schemaSql.includes('CREATE TABLE IF NOT EXISTS users'), 'Schema includes users table');
  assert(schemaSql.includes('CREATE TABLE IF NOT EXISTS books'), 'Schema includes books table');
  assert(schemaSql.includes('CREATE TABLE IF NOT EXISTS book_copies'), 'Schema includes book_copies table');
  assert(schemaSql.includes('CREATE TABLE IF NOT EXISTS loans'), 'Schema includes loans table');
  assert(schemaSql.includes('idx_unique_active_loan_copy'), 'Schema includes partial unique index constraint idx_unique_active_loan_copy');
  assert(schemaSql.includes('WHERE returned_at IS NULL'), 'Partial index enforces uniqueness only for active (unreturned) loans');

  console.log('\n🌐 [Test Suite 4] Configuration & URL Masking:');
  const sampleUrl = 'postgres://admin_user:super_secret_password_123@postgres.railway.internal:5432/railway';
  const masked = maskDatabaseUrl(sampleUrl);
  assert(!masked.includes('super_secret_password_123'), 'Database URL password is masked in logs');
  assert(masked.includes('admin_user:******@'), 'Masked URL format is correct');

  console.log('\n🔌 [Test Suite 5] PostgreSQL Live Health Check:');
  const health = await checkHealth();
  if (health.healthy) {
    console.log(`  ✅ Connected to PostgreSQL database: ${health.database} (${health.version})`);
    passedTests++;
  } else {
    console.log(`  ℹ️ Live PostgreSQL status: ${health.status} (${health.message})`);
    console.log('     (Normal in local sandbox when external Railway PostgreSQL is not attached)');
  }

  console.log('\n====================================================');
  console.log(`📊 TEST RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('====================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  runTestSuite().catch(err => {
    console.error('Test suite error:', err);
    process.exit(1);
  });
}

module.exports = { runTestSuite };
