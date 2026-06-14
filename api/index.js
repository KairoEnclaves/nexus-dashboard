// Vercel serverless entry — re-exports the Express app as a function handler.
// NOTE: Vercel is stateless/serverless. See the "Hosting" section of the
// README for the storage caveats (sessions + saved tokens need Vercel KV,
// or use a persistent host like Render/Railway instead).
module.exports = require('../server.js');
