const crypto = require('crypto');

// ---- Game settings (if you change DRAW_HOUR_UTC, also change the cron in vercel.json) ----
const C = { PRICE: 1, WINNERS: 10, MAX: 10, PAYOUT: 0.9, DRAW_HOUR_UTC: 12 };

const RU = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const RT = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const PI = 'https://api.minepi.com/v2';

// Upstash Redis over REST: no npm packages needed
async function r(...cmd) {
  const x = await fetch(RU, { method: 'POST', headers: { Authorization: 'Bearer ' + RT }, body: JSON.stringify(cmd) });
  const j = await x.json();
  if (j.error) throw new Error('Redis: ' + j.error);
  return j.result;
}

// Pi Platform API: key = Server API Key auth, token = user access token auth
async function pi(path, { method = 'GET', key, token, body } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (key) h.Authorization = 'Key ' + process.env.PI_API_KEY;
  if (token) h.Authorization = 'Bearer ' + token;
  const x = await fetch(PI + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await x.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  if (!x.ok) throw Object.assign(new Error('Pi API ' + x.status), { status: x.status, detail: j });
  return j;
}

const nextDraw = (now = new Date()) => {
  let d = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, C.DRAW_HOUR_UTC);
  if (d <= now.getTime()) d = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, C.DRAW_HOUR_UTC);
  return new Date(d);
};
const rid = (d) => d.toISOString().slice(0, 10);
const dueAt = (id) => Date.parse(id + 'T' + String(C.DRAW_HOUR_UTC).padStart(2, '0') + ':00:00Z');
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

async function authUser(req) {
  const t = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!t) return null;
  try { const me = await pi('/me', { token: t }); return { uid: me.uid, username: me.username }; } catch { return null; }
}
const nickOf = async (uid) => (await r('HGET', 'nicks', uid)) || 'Pioneer-' + uid.slice(0, 4);

// Credit tickets once per payment (idempotent). Late or over-limit payments go to the refund list.
async function issue(p) {
  const m = p.metadata || {}, id = m.round, qty = +m.qty, uid = p.user_uid;
  if (!(await r('SETNX', 'paid:' + p.identifier, '1'))) return 'duplicate';
  const have = +(await r('HGET', 'cnt:' + id, uid)) || 0;
  if ((await r('EXISTS', 'drawn:' + id)) || have + qty > C.MAX) {
    await r('HSET', 'payouts', p.identifier, JSON.stringify({ type: 'refund', round: id, uid, amount: qty * C.PRICE, status: 'pending' }));
    return 'refund';
  }
  for (let i = 0; i < qty; i++) {
    const n = await r('INCR', 'seq:' + id);
    await r('RPUSH', 'tickets:' + id, JSON.stringify({ n, uid }));
  }
  await r('HINCRBY', 'cnt:' + id, uid, qty);
  await r('SADD', 'rounds:open', id);
  return 'ok';
}

async function draw(id) {
  if (!(await r('SETNX', 'drawn:' + id, '1'))) return null;
  const t = (await r('LRANGE', 'tickets:' + id, 0, -1)).map((x) => JSON.parse(x)).sort((a, b) => a.n - b.n);
  const seed = await seedFor(id);
  const res = { id, tickets: t.length, seed, commit: sha(seed) };
  if (t.length < C.WINNERS) {
    res.cancelled = true; // not enough tickets: every ticket is refunded
    for (const x of t) await r('HSET', 'payouts', id + ':' + x.n, JSON.stringify({ type: 'refund', round: id, uid: x.uid, amount: C.PRICE, status: 'pending' }));
  } else {
    const pool = t.length * C.PRICE;
    const share = Math.floor((pool * C.PAYOUT / C.WINNERS) * 1e7) / 1e7;
    Object.assign(res, { pool, share, fee: +(pool - share * C.WINNERS).toFixed(7), winners: [] });
    for (const w of pick(seed, t, C.WINNERS)) {
      res.winners.push({ n: w.n, nick: await nickOf(w.uid) });
      await r('HSET', 'payouts', id + ':' + w.n, JSON.stringify({ type: 'prize', round: id, uid: w.uid, amount: share, status: 'pending' }));
    }
  }
  await r('SET', 'result:' + id, JSON.stringify(res));
  await r('LPUSH', 'history', id);
  await r('SREM', 'rounds:open', id);
  return res;
}

const guard = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) { console.error(e.message, JSON.stringify(e.detail || '')); res.status(e.pub ? 400 : 500).json({ error: e.pub || 'Server error. Please try again.' }); }
};
const bad = (msg) => Object.assign(new Error(msg), { pub: msg });

module.exports = { C, r, pi, nextDraw, rid, dueAt, sha, seedFor, pick, authUser, nickOf, issue, draw, guard, bad };
