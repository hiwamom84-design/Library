/**
 * Authentication and Security Helpers
 * Uses bcryptjs and jsonwebtoken when available, with secure Node.js crypto fallbacks.
 */

const crypto = require('crypto');
const { config } = require('../config/config');

// Try loading bcryptjs, fallback to PBKDF2 if unavailable
let bcrypt;
try {
  bcrypt = require('bcryptjs');
} catch (e) {
  bcrypt = null;
}

// Try loading jsonwebtoken, fallback to HMAC SHA-256 JWT if unavailable
let jwt;
try {
  jwt = require('jsonwebtoken');
} catch (e) {
  jwt = null;
}

/**
 * Hash a password securely
 */
async function hashPassword(password) {
  if (bcrypt) {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
  }

  // Pure Node.js crypto fallback (PBKDF2 with 100,000 iterations)
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `pbkdf2$100000$${salt}$${derivedKey}`;
}

/**
 * Compare plain password against hash
 */
async function comparePassword(password, hash) {
  if (!hash || !password) return false;

  if (hash.startsWith('$2a$') || hash.startsWith('$2b$')) {
    if (!bcrypt) {
      throw new Error('bcryptjs is required to verify bcrypt hashes. Run npm install.');
    }
    return bcrypt.compare(password, hash);
  }

  if (hash.startsWith('pbkdf2$')) {
    const parts = hash.split('$');
    const iterations = parseInt(parts[1], 10);
    const salt = parts[2];
    const originalKey = parts[3];
    const derivedKey = crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(derivedKey, 'hex'), Buffer.from(originalKey, 'hex'));
  }

  // Fallback if bcrypt is present and can handle it
  if (bcrypt) {
    try {
      return await bcrypt.compare(password, hash);
    } catch (err) {
      return false;
    }
  }

  return false;
}

/**
 * Base64URL encoding/decoding for custom JWT fallback
 */
function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64').toString('utf8');
}

/**
 * Generate a JWT token
 */
function generateToken(payload) {
  if (jwt) {
    return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
  }

  // Pure crypto fallback JWT implementation
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7 days
  const tokenPayload = { ...payload, exp };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(tokenPayload));
  const signature = crypto
    .createHmac('sha256', config.jwtSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Verify a JWT token
 */
function verifyToken(token) {
  if (!token) return null;

  if (jwt) {
    try {
      return jwt.verify(token, config.jwtSecret);
    } catch (err) {
      return null;
    }
  }

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signature] = parts;
    const expectedSig = crypto
      .createHmac('sha256', config.jwtSecret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return null;
    }

    const payload = JSON.parse(base64UrlDecode(payloadB64));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return null; // Expired
    }

    return payload;
  } catch (err) {
    return null;
  }
}

module.exports = {
  hashPassword,
  comparePassword,
  generateToken,
  verifyToken
};
