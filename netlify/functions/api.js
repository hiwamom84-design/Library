const serverless = require('serverless-http');
const { app, ensureInitialized } = require('../../server/index');

const handler = serverless(app);

exports.handler = async (event, context) => {
  await ensureInitialized();
  if (event.path && event.path.startsWith('/.netlify/functions/api')) {
    event.path = event.path.replace('/.netlify/functions/api', '/api');
  }
  if (event.rawUrl) {
    event.rawUrl = event.rawUrl.replace('/.netlify/functions/api', '/api');
  }
  return handler(event, context);
};
