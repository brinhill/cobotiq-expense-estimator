'use strict';

// Catalyst Advanced I/O function entry point.
//
//   GET  /health              which provider keys are configured (never the values)
//   POST /estimate/calculate  run an estimate; body documented in README.md
//
// Keys come from the function's environment variables:
// SERPAPI_KEY, RAPIDAPI_KEY, GSA_API_KEY (optional, defaults to DEMO_KEY).

const { runEstimate } = require('./src/engine');
const { ValidationError } = require('./src/calc/validate');
const { DEFAULTS, keys: loadKeys } = require('./src/config');

const MAX_BODY_BYTES = 100 * 1024;

function send(res, status, body, origin) {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers.Vary = 'Origin';
  }
  res.writeHead(status, headers);
  res.end(body === null ? '' : JSON.stringify(body));
}

function readJson(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ValidationError(['request body too large']));
        req.destroy();
      } else {
        chunks.push(c);
      }
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new ValidationError(['request body must be JSON']));
      }
    });
    req.on('error', reject);
  });
}

// Allowed browser origins, comma separated (for example the Catalyst web
// client URL). Same origin calls from the Catalyst web client need nothing.
function allowedOrigin(req) {
  const origin = req.headers && req.headers.origin;
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return origin && allowed.includes(origin) ? origin : null;
}

function createHandler(makeDeps) {
  return async (req, res) => {
    const origin = allowedOrigin(req);
    const path = (req.url || '/').split('?')[0].replace(/\/+$/, '');
    try {
      if (req.method === 'OPTIONS') return send(res, 204, null, origin);

      if (req.method === 'GET' && (path === '' || path.endsWith('/health'))) {
        const k = loadKeys();
        return send(res, 200, {
          ok: true,
          providers: { serpapi: Boolean(k.serpapi), rapidapi: Boolean(k.rapidapi), gsa: k.gsa === 'DEMO_KEY' ? 'demo key' : true },
          defaults: DEFAULTS,
        }, origin);
      }

      if (req.method === 'POST' && path.endsWith('/estimate/calculate')) {
        const body = await readJson(req);
        const result = await runEstimate(body, makeDeps(req));
        return send(res, 200, result, origin);
      }

      return send(res, 404, { error: 'not found' }, origin);
    } catch (err) {
      if (err instanceof ValidationError) return send(res, 400, { error: 'invalid input', problems: err.problems }, origin);
      console.error('estimate_engine error', err);
      return send(res, 500, { error: 'internal error' }, origin);
    }
  };
}

module.exports = createHandler((req) => {
  const { createCatalystStore } = require('./src/store/catalyst');
  return { store: createCatalystStore(req), keys: loadKeys() };
});
module.exports.createHandler = createHandler;
