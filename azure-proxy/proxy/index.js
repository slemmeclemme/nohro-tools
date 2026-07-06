const https = require('https');

// Only the china.nohro.dk checker (and its local dev server) may call this
// proxy from a browser. Non-browser callers send no Origin header and can't
// be blocked by CORS — the request validation below is what limits abuse.
const ALLOWED_ORIGINS = new Set([
  'https://china.nohro.dk',
  'http://localhost:8737',
]);
const ALLOWED_MODELS = new Set(['claude-fable-5', 'claude-sonnet-4-6']);
const ALLOWED_EFFORT = new Set(['low', 'medium', 'high']);
const MAX_TOKENS_CAP = 4000;
const MAX_BODY_BYTES = 20 * 1024 * 1024; // BOM checks include base64 photos
const RATE_LIMIT = 30;                   // requests per IP...
const RATE_WINDOW_MS = 5 * 60 * 1000;    // ...per 5 minutes (per instance)

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 1000) {
    for (const [k, v] of hits) {
      if (!v.some(t => now - t < RATE_WINDOW_MS)) hits.delete(k);
    }
  }
  return recent.length > RATE_LIMIT;
}

module.exports = async function (context, req) {
  const origin = (req.headers && (req.headers.origin || req.headers.Origin)) || '';
  const cors = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://china.nohro.dk',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
  const deny = (status, msg) => {
    context.res = { status, headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: { message: msg } }) };
  };

  if (req.method === 'OPTIONS') {
    context.res = { status: 200, headers: cors, body: '' };
    return;
  }

  if (origin && !ALLOWED_ORIGINS.has(origin)) { deny(403, 'Origin not allowed'); return; }

  const ip = ((req.headers && req.headers['x-forwarded-for']) || 'unknown').split(',')[0].trim();
  if (rateLimited(ip)) { deny(429, 'Too many requests — please wait a few minutes'); return; }

  let parsed = req.body;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { deny(400, 'Invalid JSON'); return; }
  }
  if (!parsed || !Array.isArray(parsed.messages) || parsed.messages.length < 1 || parsed.messages.length > 4) {
    deny(400, 'Invalid request'); return;
  }
  if (!ALLOWED_MODELS.has(parsed.model)) { deny(400, 'Model not allowed'); return; }

  // Rebuild the outbound body from validated fields only — never forward
  // the client payload verbatim (system prompts, tools, streaming etc.
  // would turn the key into a general-purpose relay).
  const outbound = {
    model: parsed.model,
    max_tokens: Math.min(Math.max(1, Number(parsed.max_tokens) || MAX_TOKENS_CAP), MAX_TOKENS_CAP),
    messages: parsed.messages,
  };
  if (parsed.output_config && ALLOWED_EFFORT.has(parsed.output_config.effort)) {
    outbound.output_config = { effort: parsed.output_config.effort };
  }

  const body = JSON.stringify(outbound);
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) { deny(413, 'Request too large'); return; }

  try {
    const apiKey = process.env.ANTHROPIC_KEY;
    const result = await new Promise((resolve, reject) => {
      const r = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      r.on('error', reject);
      r.write(body);
      r.end();
    });

    context.res = {
      status: result.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
      body: result.body,
    };
  } catch (err) {
    context.log.error('Upstream error:', err.message);
    deny(502, 'Upstream request failed');
  }
};
