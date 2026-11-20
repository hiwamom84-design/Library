const { app, ensureInitialized } = require('../server/index');

module.exports = async (req, res) => {
  await ensureInitialized();
  return app(req, res);
};
