const crypto = require('crypto');
const { sandboxDeployment, purchasesEnabled } = require('./sandbox');

// ---- Weekly Sunday 20:00 UTC draw (keep vercel.json cron synchronized) ----
const C = { PRICE: 1, WINNERS: 10, MAX: 10, SANDBOX_MAX: 100, BUNDLES: [1, 5, 10, 25, 50, 100], PAYOUT: 0.9, DRAW_HOUR_UTC: 20 };

const RU = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const RT = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const PI = 'https://api.minepi.com/v2';

// Upstash Redis over REST: no npm packages needed
async function r(...cmd) {
  const sandbox = sandboxDeployment();
  const url = sandbox ? process.env.PI_SANDBOX_REDIS_URL : RU;
  const token = sandbox ? process.env.PI_SANDBOX_REDIS_TOKEN : RT;
  if (!url || !token) throw new Error('Redis is not configured for this environment.');
  const x = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: JSON.stringify(cmd) });
  const j = await x.json();
  if (!x.ok || j.error || !Object.hasOwn(j, 'result')) throw new Error('Redis command failed.');
  return j.result;
}

// Pi Platform API: key = Server API Key auth, token = user access token auth
async function pi(path, { method = 'GET', key, token, body } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (key) h.Authorization = 'Key ' + key;
  if (token) h.Authorization = 'Bearer ' + token;
  const x = await fetch(PI + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await x.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!x.ok) throw Object.assign(new Error('Pi API ' + x.status), { status: x.status, detail: j });
  return j;
}

const nextDraw = (now = new Date()) => {
  // UTC Sunday is day 0. At/after the cutoff, use the following Sunday.
  const daysUntilSunday = (7 - now.getUTCDay()) % 7;
  const d = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilSunday, C.DRAW_HOUR_UTC);
  return new Date(d <= now.getTime() ? d + 7 * 24 * 60 * 60 * 1000 : d);
};
const rid = (d) => d.toISOString().slice(0, 10);
const dueAt = (id) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(id)) return NaN;
  const time = Date.parse(id + 'T' + String(C.DRAW_HOUR_UTC).padStart(2, '0') + ':00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === id ? time : NaN;
};
const isWeeklyRound = (id) => Number.isFinite(dueAt(id)) && new Date(dueAt(id)).getUTCDay() === 0;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Fairness: a secret seed is created per round and its hash is published up front.
// After the draw the seed is revealed, so anyone can re-run pick() and check the winners.
const seedFor = async (id) => { await r('SETNX', 'seed:' + id, crypto.randomBytes(32).toString('hex')); return r('GET', 'seed:' + id); };

function pick(seed, tickets, k) {
  const a = tickets.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const h = crypto.createHmac('sha256', seed).update(String(i)).digest('hex');
    const j = Number(BigInt('0x' + h) % BigInt(i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k).sort((x, y) => x.n - y.n);
}

function signSession(payload) {
  const secret = process.env.APP_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('APP_SESSION_SECRET must be set to a random secret of at least 32 characters.');
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return encoded + '.' + signature;
}

function createSessionToken(user, lifetime, scope) {
  return signSession({
    uid: user.uid,
    username: user.username,
    exp: Math.floor(Date.now() / 1000) + lifetime,
    scope,
  });
}

function createSessionCookie(user) {
  const value = createSessionToken(user, 7 * 24 * 60 * 60);
  return 'tw_session=' + value + '; Path=/; Max-Age=604800; HttpOnly; Secure; SameSite=Lax';
}

function readSession(req) {
  try {
    const raw = (req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith('tw_session='));
    const header = req.headers.authorization;
    const bearer = typeof header === 'string' && header.startsWith('Bearer ');
    const value = bearer ? header.slice(7) : raw?.slice('tw_session='.length);
    if (!value || value.length > 4096) return null;
    const parts = value.split('.');
    if (parts.length !== 2) return null;
    const secret = process.env.APP_SESSION_SECRET;
    if (!secret || secret.length < 32) return null;
    const expected = crypto.createHmac('sha256', secret).update(parts[0]).digest();
    const actual = Buffer.from(parts[1], 'base64url');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (payload.scope !== (bearer ? 'browser' : undefined)) return null;
    if (typeof payload.uid !== 'string' || !payload.uid || typeof payload.username !== 'string' ||
        !payload.username.trim() || !Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return { uid: String(payload.uid), username: String(payload.username) };
  } catch { return null; }
}

async function authUser(req) {
  return readSession(req);
}
const nickOf = async (uid) => (await r('HGET', 'nicks', uid)) || 'Pioneer-' + uid.slice(0, 4);

// Payment credits and draw publication use Redis Lua transactions; no partial ledger writes.
async function issue(p, pending) {
  const { ISSUE } = require('./ledger');
  const m = p.metadata || {}, id = m.round, qty = m.qty, uid = p.user_uid;
  if (!purchasesEnabled()) throw bad('Sandbox purchases are disabled.');
  if (typeof p.identifier !== 'string' || !/^[A-Za-z0-9_-]{6,100}$/.test(p.identifier) ||
      typeof uid !== 'string' || !uid || !C.BUNDLES.includes(qty) ||
      p.amount !== qty * C.PRICE || p.network !== 'Pi Testnet' || p.direction !== 'user_to_app' ||
      p.status?.developer_completed !== true || p.status.transaction_verified !== true ||
      p.transaction?.verified !== true) throw bad('Invalid or incomplete Pi payment.');
  if (typeof id !== 'string' || !isWeeklyRound(id)) throw bad('Invalid draw round.');
  // The published cutoff is authoritative even for already-finished payments.
  const result = await r('EVAL', ISSUE, 0, p.identifier, id, uid, qty, dueAt(id), C.SANDBOX_MAX,
    new Date().toISOString(), C.PRICE, p.transaction.txid);
  if (!['ok', 'refund'].includes(result)) throw bad('The transaction is already attached to another payment.');
  await r('SREM', pending, p.identifier);
  return result;
}

async function draw(id) {
  const { FINALIZE } = require('./ledger');
  if (!isWeeklyRound(id) || dueAt(id) > Date.now()) throw bad('The weekly draw is not due.');
  if (await r('EXISTS', 'result:' + id)) return null;
  // Close the round before reading the ticket snapshot. A failed worker can retry safely.
  await r('SETNX', 'closing:' + id, '1');
  const t = (await r('LRANGE', 'tickets:' + id, 0, -1))
    .map((x) => JSON.parse(x)).sort((a, b) => a.n - b.n);
  const seed = await seedFor(id);
  const res = { id, drawnAt: new Date().toISOString(), tickets: t.length, seed, commit: sha(seed) };
  const payouts = [];
  if (t.length < C.WINNERS) {
    res.cancelled = true;
    for (const x of t) payouts.push({ id: id + ':' + x.n, record: {
      type: 'refund', round: id, uid: x.uid, amount: C.PRICE, status: 'pending', createdAt: res.drawnAt
    } });
  } else {
    const pool = t.length * C.PRICE;
    const share = Math.floor((pool * C.PAYOUT / C.WINNERS) * 1e7) / 1e7;
    Object.assign(res, { pool, share, fee: +(pool - share * C.WINNERS).toFixed(7), winners: [] });
    for (const w of pick(seed, t, C.WINNERS)) {
      res.winners.push({ n: w.n, nick: await nickOf(w.uid) });
      payouts.push({ id: id + ':' + w.n, record: {
        type: 'prize', round: id, uid: w.uid, amount: share, status: 'pending', createdAt: res.drawnAt
      } });
    }
  }
  const result = await r('EVAL', FINALIZE, 0, id, JSON.stringify(res), JSON.stringify(payouts));
  return result === 'ok' ? res : null;
}

const guard = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) { console.error(e.message, JSON.stringify(e.detail || '')); res.status(e.pub ? 400 : 500).json({ error: e.pub || 'Server error. Please try again.' }); }
};
const bad = (msg) => Object.assign(new Error(msg), { pub: msg });

module.exports = { C, r, pi, nextDraw, rid, dueAt, isWeeklyRound, sha, seedFor, pick, authUser, createSessionCookie, createSessionToken, nickOf, issue, draw, guard, bad };
