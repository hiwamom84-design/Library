/**
 * Lightweight Express-Compatible Fallback Engine
 * Provides an Express-like API using only Node.js standard libraries (http, fs, path, url)
 * Used when 'express' package has not yet been installed via npm.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function createMiniApp() {
  const middlewares = [];
  const routes = {
    GET: [],
    POST: [],
    PUT: [],
    DELETE: []
  };

  const app = function (req, res, parentNext) {
    handleRequest(req, res, parentNext);
  };

  function enhanceResponse(res) {
    if (res.__enhanced) return;
    res.__enhanced = true;

    res.status = function (code) {
      res.statusCode = code;
      return res;
    };

    res.json = function (data) {
      if (!res.headersSent) {
        res.setHeader('Content-Type', 'application/json; charset=UTF-8');
      }
      res.end(JSON.stringify(data));
      return res;
    };

    res.sendFile = function (filePath) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      fs.readFile(filePath, (err, content) => {
        if (err) {
          res.statusCode = 404;
          if (!res.headersSent) res.setHeader('Content-Type', 'text/plain');
          res.end('File Not Found');
          return;
        }
        if (!res.headersSent) res.setHeader('Content-Type', contentType);
        res.end(content);
      });
      return res;
    };
  }

  function matchRoute(routePath, reqPath) {
    if (routePath === '*' || routePath === reqPath) {
      return { match: true, params: {} };
    }

    const routeParts = routePath.split('/').filter(Boolean);
    const reqParts = reqPath.split('/').filter(Boolean);

    if (routeParts.length !== reqParts.length) {
      return { match: false, params: {} };
    }

    const params = {};
    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) {
        const paramName = routeParts[i].slice(1);
        params[paramName] = reqParts[i];
      } else if (routeParts[i] !== reqParts[i]) {
        return { match: false, params: {} };
      }
    }

    return { match: true, params };
  }

  function handleRequest(req, res, parentNext) {
    enhanceResponse(res);

    if (!req.originalUrl) {
      const parsedUrl = url.parse(req.url, true);
      req.path = parsedUrl.pathname;
      req.query = parsedUrl.query || {};
      req.params = {};
      req.originalUrl = req.url;
    }

    // Process body if not already parsed
    const proceed = () => {
      let idx = 0;
      function next(err) {
        if (err) {
          console.error('Middleware Error:', err);
          return res.status(500).json({ error: 'Internal Server Error' });
        }

        if (idx < middlewares.length) {
          const mw = middlewares[idx++];
          return mw(req, res, next);
        }

        // Match routes
        const methodRoutes = routes[req.method] || [];
        for (const r of methodRoutes) {
          const matchResult = matchRoute(r.path, req.path);
          if (matchResult.match) {
            req.params = matchResult.params;
            return r.handler(req, res, next);
          }
        }

        // If sub-app, hand back to parent
        if (typeof parentNext === 'function') {
          return parentNext();
        }

        // 404
        if (!res.headersSent) {
          res.status(404).json({ error: 'Endpoint Not Found', errorEn: 'Endpoint Not Found' });
        }
      }

      next();
    };

    if (req.body !== undefined || req.method === 'GET' || req.method === 'HEAD') {
      req.body = req.body || {};
      proceed();
    } else {
      let bodyData = '';
      req.on('data', chunk => {
        bodyData += chunk;
      });
      req.on('end', () => {
        if (bodyData) {
          try {
            req.body = JSON.parse(bodyData);
          } catch (e) {
            req.body = {};
          }
        } else {
          req.body = {};
        }
        proceed();
      });
    }
  }

  app.use = function (fn) {
    if (typeof fn === 'function') {
      middlewares.push(fn);
    } else if (typeof fn === 'string' && typeof arguments[1] === 'function') {
      const prefix = fn;
      const subHandler = arguments[1];
      middlewares.push((req, res, next) => {
        if (req.path.startsWith(prefix)) {
          const originalPath = req.path;
          req.path = req.path.slice(prefix.length) || '/';
          subHandler(req, res, () => {
            req.path = originalPath;
            next();
          });
        } else {
          next();
        }
      });
    }
    return app;
  };

  app.get = function (pathStr, handler) {
    routes.GET.push({ path: pathStr, handler });
    return app;
  };

  app.post = function (pathStr, handler) {
    routes.POST.push({ path: pathStr, handler });
    return app;
  };

  app.put = function (pathStr, handler) {
    routes.PUT.push({ path: pathStr, handler });
    return app;
  };

  app.delete = function (pathStr, handler) {
    routes.DELETE.push({ path: pathStr, handler });
    return app;
  };

  app.listen = function (port, host, callback) {
    const server = http.createServer(app);
    return server.listen(port, host, callback);
  };

  return app;
}

function staticMiddleware(staticDir) {
  return function (req, res, next) {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api')) return next();

    let reqFile = req.path === '/' ? 'index.html' : req.path;
    const safePath = path.normalize(path.join(staticDir, reqFile));

    if (!safePath.startsWith(staticDir)) {
      return next();
    }

    fs.stat(safePath, (err, stats) => {
      if (err || !stats.isFile()) {
        return next();
      }
      res.sendFile(safePath);
    });
  };
}

module.exports = {
  createMiniApp,
  staticMiddleware
};
