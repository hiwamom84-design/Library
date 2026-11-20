/**
 * Community Library Management Server
 * Express application entry point designed for Railway deployment with PostgreSQL.
 * Automatically runs migrations and ensures admin account exists on startup.
 */

const path = require('path');
const http = require('http');
const { config, maskDatabaseUrl } = require('./config/config');
const { checkHealth, close: closeDb } = require('./database/db');
const { runMigrations } = require('./database/migrate');
const { setupAdmin, setupFamilyMembers } = require('./scripts/setup-admin');
const apiRoutes = require('./routes/api');

let app;
let isExpress = false;

try {
  const express = require('express');
  app = express();
  isExpress = true;

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      if (req.path.startsWith('/api') && req.path !== '/api/health') {
        console.log(`📡 [${req.method}] ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
      }
    });
    next();
  });

  app.use('/api', apiRoutes);

  const publicPath = path.join(__dirname, '../public');
  app.use(express.static(publicPath));

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({
        error: 'خاڵی پەیوەندی داواکراو نەدۆزرایەوە',
        errorEn: 'API endpoint not found.'
      });
    }
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  app.use((err, req, res, next) => {
    console.error('❌ [Unhandled Server Error]:', err.stack || err.message);
    return res.status(500).json({
      error: 'هەڵەیەکی چاوەڕواننەکراو لە سەروەردا ڕوویدا',
      errorEn: 'An unexpected internal server error occurred.'
    });
  });
} catch (e) {
  const { createMiniApp, staticMiddleware } = require('./utils/mini-express');
  app = createMiniApp();
  const publicPath = path.join(__dirname, '../public');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });

  app.use('/api', apiRoutes);
  app.use(staticMiddleware(publicPath));

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({
        error: 'خاڵی پەیوەندی داواکراو نەدۆزرایەوە',
        errorEn: 'API endpoint not found.'
      });
    }
    res.sendFile(path.join(publicPath, 'index.html'));
  });
}

let server;


let initPromise = null;
let initDone = false;
async function ensureInitialized() {
  if (initDone) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (config.databaseUrl) {
      try {
        console.log('⚙️ [Startup] Running automatic database migrations...');
        await runMigrations();
        await setupAdmin(config.initialAdminEmail, config.initialAdminPassword, config.initialAdminName);
        await setupFamilyMembers();
        initDone = true;
      } catch (migErr) {
        console.warn('⚠️ [Startup] Auto-migration error:', migErr.message);
        initPromise = null;
      }
    }
  })();
  return initPromise;
}

async function startServer() {
  console.log('====================================================');
  console.log('🏛️  کتێبخانەی خێزانی و کۆمەڵایەتی | Community Library');
  console.log('====================================================');
  console.log(`🌍 Environment: ${config.nodeEnv} (Engine: ${isExpress ? 'Express' : 'Node Standard HTTP'})`);
  console.log(`🔌 Database URL: ${maskDatabaseUrl(config.databaseUrl)}`);

  if (process.env.AUTO_MIGRATE === 'true' || (config.isProduction && config.databaseUrl)) {
    try {
      console.log('⚙️ [Startup] Running automatic database migrations...');
      await runMigrations();
      await setupAdmin(config.initialAdminEmail, config.initialAdminPassword, config.initialAdminName);
      await setupFamilyMembers();
    } catch (migErr) {
      console.warn('⚠️ [Startup] Auto-migration skipped or encountered an error:', migErr.message);
    }
  }

  const health = await checkHealth();
  if (health.healthy) {
    console.log(`✅ [Startup] Database connected successfully to: ${health.database}`);
  } else {
    console.warn(`⚠️ [Startup] Database connection status: ${health.status} (${health.message || 'No DB'})`);
  }

  server = http.createServer(app);
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`🚀 [Startup] Server is running on port ${config.port} (http://localhost:${config.port})`);
    console.log('====================================================');
  });

  return server;
}

async function handleShutdown(signal) {
  console.log(`\n🛑 [Shutdown] Received ${signal}. Closing server and database connections...`);
  if (server) {
    server.close(() => {
      console.log('🚪 [Shutdown] HTTP server closed.');
    });
  }
  await closeDb();
  process.exit(0);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

if (require.main === module) {
  startServer().catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer,
  ensureInitialized
};
