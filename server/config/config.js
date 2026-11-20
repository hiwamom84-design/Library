/**
 * Application Configuration
 * Reads configuration from environment variables with sensible defaults.
 */

const path = require('path');

const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  
  // Database configuration from Railway environment
  databaseUrl: process.env.DATABASE_URL || '',
  
  // Security
  jwtSecret: process.env.JWT_SECRET || 'library-secure-jwt-secret-replace-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  
  // Default Admin creation credentials
  initialAdminEmail: process.env.ADMIN_EMAIL || 'admin@library.krd',
  initialAdminPassword: process.env.ADMIN_PASSWORD || '1234554321',
  initialAdminName: process.env.ADMIN_NAME || 'نوح هیوا عومەر',
  
  // WhatsApp Support Contact (+964 750 170 1136)
  contactWhatsApp: '07501701136',
  contactWhatsAppUrl: 'https://wa.me/9647501701136',
  
  // Library Loan policy
  loanPeriodDays: parseInt(process.env.LOAN_PERIOD_DAYS || '14', 10),
  maxActiveLoansPerMember: parseInt(process.env.MAX_ACTIVE_LOANS || '5', 10),
  
  // Static files
  publicDir: path.join(__dirname, '../../public')
};

function maskDatabaseUrl(url) {
  if (!url) return 'NOT_CONFIGURED';
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '******';
    }
    return parsed.toString();
  } catch (err) {
    return url.replace(/:\/\/(.*?):(.*?)@/, '://$1:******@');
  }
}

module.exports = {
  config,
  maskDatabaseUrl
};
