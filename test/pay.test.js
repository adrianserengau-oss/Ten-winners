const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { purchasesEnabled } = require('../api/_lib/sandbox');
const { C, createSessionToken, nextDraw, rid } = require('../api/_lib/core');
const pay = require('../api/pay');

const config = {
  NODE_ENV: 'development',
  PI_SANDBOX: 'true',
  PI_SANDBOX_PURCHASES: 'true',
  PI_SANDBOX_API_KEY: 'test-key',
  PI_SANDBOX_REDIS_URL: 'https://test.redis.invalid',
  PI_SANDBOX_REDIS_TOKEN: 'test-token',
  APP_SESSION_SECRET: 'test-session-secret-only-for-fixtures',
};
const paymentId = 'sandbox-payment-1';
const txid = 'a'.repeat(64);
const uid = 'test-user';

function fixture(t, overrides = {}) {
  const old = { ...process.env };
  Object.assign(process.env, config, { VERCEL_ENV: 'preview', VERCEL_TARGET_ENV: 'preview' });
  t.after(() => {
    for (const key of [...Object.keys(config), 'VERCEL_ENV', 'VERCEL_TARGET_ENV']) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
  });
  const p = {
    identifier: paymentId, user_uid: uid, direction: 'user_to_app', network: 'Pi Testnet',
    amount: 5, metadata: { round: rid(nextDraw()), qty: 5 },
    status: {
      cancelled: false, user_cancelled: false, developer_approved: true,
      developer_completed: false, transaction_verified: false,
    },
    transaction: { txid, verified: false },
    ...overrides,
  };
  const calls = [];
  const pending = new Set();
  const control = { have: 0, failLedger: false, verify: true, lostCompletionResponse: false };
  const respond = (body, status = 200) => new Response(JSON.stringify(body), { status });
  t.mock.method(global, 'fetch', async (url, options) => {
    if (url === config.PI_SANDBOX_REDIS_URL) {
      const [cmd, ...args] = JSON.parse(options.body);
      calls.push(cmd);
      if (cmd === 'SADD') pending.add(args[1]);
      if (cmd === 'SREM') pending.delete(args[1]);
      if (cmd === 'EVAL' && args[1] === 0) {
        assert.equal(args[7], 100);
        if (control.failLedger) return respond({ error: 'outage' }, 503);
      }
      return respond({ result: { HGET: control.have, SMEMBERS: [...pending], EVAL: 'ok' }[cmd] ?? 1 });
    }
    assert.equal(options.headers.Authorization, 'Key test-key');
    assert.match(url, /^https:\/\/api\.minepi\.com\/v2\/payments\//);
    const path = new URL(url).pathname.split('/').slice(3).join('/');
    calls.push(path);
    if (path.endsWith('/approve')) p.status.developer_approved = true;
    if (path.endsWith('/complete')) {
      assert.deepEqual(JSON.parse(options.body), { txid });
      p.status.developer_completed = true;
      p.status.transaction_verified = control.verify;
      p.transaction.verified = control.verify;
      if (control.lostCompletionResponse) return respond({}, 503);
    }
    return respond(p);
  });
  const session = createSessionToken({ uid, username: 'fixture' }, 600, 'browser');
  async function request(action, body = {}, headers = { authorization: 'Bearer ' + session }) {
    const res = {
      code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; },
    };
    await pay({ method: 'POST', headers, body: { action, paymentId, txid, ...body } }, res);
    return { status: res.code, body: res.data };
  }
  return { calls, control, request, payment: p };
}

test('Sandbox configuration requires opt-in, isolated Redis and a known nonproduction runtime', () => {
  assert.equal(purchasesEnabled(config), true);
  for (const overrides of [
    { NODE_ENV: 'production' }, { NODE_ENV: '' }, { PI_SANDBOX: '' },
    { PI_SANDBOX_PURCHASES: 'TRUE' }, { PI_SANDBOX_API_KEY: '' }, { PI_SANDBOX_REDIS_TOKEN: '' },
    { VERCEL: '1' }, { VERCEL_ENV: 'production' },
    { VERCEL_ENV: 'preview', VERCEL_TARGET_ENV: 'production' },
    { UPSTASH_REDIS_REST_URL: config.PI_SANDBOX_REDIS_URL + '/' },
  ]) assert.equal(purchasesEnabled({ ...config, ...overrides }), false, JSON.stringify(overrides));
  assert.equal(purchasesEnabled({ ...config, NODE_ENV: 'production', VERCEL_ENV: 'preview' }), true);
});

test('the page offers the same bundles as the API and respects the existing cap', () => {
  const html = readFileSync(require.resolve('../public/index.html'), 'utf8');
  const buttons = [...html.matchAll(/data-buy="(\d+)"/g)].map((match) => Number(match[1]));
  assert.deepEqual(buttons, C.BUNDLES);
  assert.deepEqual(buttons, [1, 5, 10, 25, 50, 100]);
  assert.equal(C.MAX, 10);
  assert.equal(C.SANDBOX_MAX, 100);
  assert.equal(C.PRICE, 1);
});

test('all payment actions in production fail before Pi or Redis calls', async (t) => {
  const { calls, request } = fixture(t);
  process.env.VERCEL_ENV = 'production';
  for (const action of ['approve', 'complete', 'incomplete', 'recover']) {
    assert.equal((await request(action)).status, 403);
  }
  assert.deepEqual(calls, []);
});

test('payment approval requires a verified session, an eligible order, and room under the cap', async (t) => {
  const { calls, control, request } = fixture(t, {
    transaction: null,
    status: { cancelled: false, user_cancelled: false, developer_approved: false, developer_completed: false },
  });
  assert.equal((await request('approve', {}, {})).status, 401);
  assert.deepEqual(calls, []);
  control.have = 96;
  assert.equal((await request('approve')).status, 400);
  assert.ok(!calls.includes(paymentId + '/approve'));
  control.have = 95;
  assert.deepEqual(await request('approve'), { status: 200, body: { result: 'approved' } });
  assert.equal(calls.filter((call) => call.endsWith('/approve')).length, 1);
  assert.equal((await request('approve')).status, 200);
  assert.equal(calls.filter((call) => call.endsWith('/approve')).length, 1);
});

const metadata = { qty: 5, round: rid(nextDraw()) };
for (const qty of [25, 50, 100]) {
  test('Sandbox approves and credits the ' + qty + '-ticket bundle', async (t) => {
    const order = { amount: qty, metadata: { ...metadata, qty }, transaction: null };
    const { request, payment } = fixture(t, order);
    assert.deepEqual((await request('approve')).body, { result: 'approved' });
    payment.transaction = { txid, verified: false };
    assert.deepEqual((await request('complete')).body, { result: 'ok' });
  });
}
for (const [reason, overrides] of Object.entries({
  Mainnet: { network: 'Pi Network' },
  'missing network': { network: undefined },
  'different account': { user_uid: 'another-user' },
  'different payment ID': { identifier: 'other-payment' },
  'wrong direction': { direction: 'app_to_user' },
  'cancelled': { status: { cancelled: false, user_cancelled: true } },
  'incorrect amount': { amount: 6 },
  'unsupported quantity': { metadata: { ...metadata, qty: 2 }, amount: 2 },
  'invalid round': { metadata: { ...metadata, round: 'not-a-date' } },
  'missing transaction': { transaction: null },
  'different transaction': { transaction: { txid: 'b'.repeat(64), verified: true } },
})) {
  test('completion rejects ' + reason, async (t) => {
    const { calls, request } = fixture(t, overrides);
    assert.equal((await request('complete')).status, 400);
    assert.ok(!calls.includes('SADD') && !calls.includes(paymentId + '/complete'));
  });
}

test('even a developer-completed payment cannot credit without both verification flags', async (t) => {
  const { calls, control, request } = fixture(t);
  control.verify = false;
  assert.equal((await request('complete')).status, 400);
  assert.deepEqual(calls.slice(0, 4), [paymentId, 'SADD', paymentId + '/complete', paymentId]);
  assert.ok(!calls.includes('SREM'));
});

test('a lost Pi completion response can be reconciled through an independent read', async (t) => {
  const { control, request } = fixture(t);
  control.lostCompletionResponse = true;
  assert.deepEqual(await request('complete'), { status: 200, body: { result: 'ok' } });
});

test('a failed ledger write after Pi completion is recoverable from the durable queue', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { calls, control, request } = fixture(t);
  control.failLedger = true;
  assert.equal((await request('complete')).status, 500);
  assert.ok(!calls.includes('SREM'));
  control.failLedger = false;
  assert.deepEqual(await request('recover'), { status: 200, body: { results: ['ok'], retryPending: false } });
  assert.equal(calls.filter((call) => call === paymentId + '/complete').length, 1);
  assert.deepEqual((await request('recover')).body.results, []);
});
