const assert = require('node:assert/strict');
const { execFile, spawn } = require('node:child_process');
const { createServer } = require('node:net');
const { promisify } = require('node:util');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');
const { ISSUE } = require('../api/_lib/ledger');

const exec = promisify(execFile);
const server = process.env.TEST_REDIS_SERVER;
const cli = process.env.TEST_REDIS_CLI;

async function freePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));
  return String(port);
}

test('Redis ledger credits once, resolves cap races and honors closed rounds', {
  skip: !(server && cli) && 'Set TEST_REDIS_SERVER and TEST_REDIS_CLI to local Redis executables.',
  timeout: 25000,
}, async (t) => {
  const port = await freePort();
  const redis = spawn(server, ['--bind', '127.0.0.1', '--port', port, '--save', '', '--appendonly', 'no'], {
    stdio: 'ignore', windowsHide: true,
  });
  t.after(() => redis.kill());
  let startupError;
  redis.once('error', (error) => { startupError = error; });
  async function run(...args) {
    const { stdout } = await exec(cli, ['-h', '127.0.0.1', '-p', port, '--json', ...args.map(String)], {
      windowsHide: true, timeout: 3000,
    });
    return JSON.parse(stdout);
  }
  for (let attempt = 0; ; attempt++) {
    if (startupError) throw startupError;
    try {
      assert.equal(await run('PING'), 'PONG');
      break;
    } catch (error) {
      if (attempt === 24 || redis.exitCode !== null) throw error;
      await delay(100);
    }
  }

  const round = 'test-round';
  const future = Date.now() + 60000;
  const issue = (id, tx, uid = 'pioneer', cutoff = future) =>
    run('EVAL', ISSUE, 0, id, round, uid, 5, cutoff, 10, new Date().toISOString(), 1, tx);

  assert.deepEqual(await Promise.all([issue('pay-1', 'tx-1'), issue('pay-1', 'tx-1')]), ['ok', 'ok']);
  assert.equal(await run('LLEN', 'tickets:' + round), 5);
  assert.equal(await run('LLEN', 'transactions:pioneer'), 1);
  assert.equal(await issue('pay-other', 'tx-1'), 'duplicate_tx');
  assert.equal(await issue('pay-1', 'tx-other'), 'duplicate_tx');
  const race = await Promise.all([issue('pay-2', 'tx-2'), issue('pay-3', 'tx-3')]);
  assert.deepEqual(race.sort(), ['ok', 'refund']);
  assert.equal(await run('HGET', 'cnt:' + round, 'pioneer'), '10');
  assert.equal(await run('LLEN', 'tickets:' + round), 10);
  assert.equal(await run('HLEN', 'payouts'), 1);
  assert.equal(await issue('pay-expired', 'tx-expired', 'late', Date.now() - 1), 'refund');

  await run('SET', 'transactions:wrong-type', 'invalid-ledger-data');
  await assert.rejects(issue('pay-broken', 'tx-broken', 'wrong-type'));
  assert.equal(await run('GET', 'paid:pay-broken'), null);
  assert.equal(await run('LLEN', 'tickets:' + round), 10);

  await run('SET', 'closing:' + round, 1);
  assert.equal(await issue('pay-closed', 'tx-closed', 'new-user'), 'refund');
  assert.equal(await issue('pay-closed', 'tx-closed', 'new-user'), 'refund');
  assert.equal(await run('LLEN', 'transactions:new-user'), 1);
  assert.equal(await run('HLEN', 'payouts'), 3);

  await run('SET', 'paid:legacy', 'ok');
  assert.equal(await issue('legacy', 'tx-legacy'), 'ok');
  assert.equal(await run('LLEN', 'tickets:' + round), 10);
});
