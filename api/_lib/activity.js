const { randomUUID } = require('node:crypto');
const { r } = require('./core');

const RECORD = `
if ARGV[2] == '1' and not redis.call('SET', KEYS[2], '1', 'EX', 60, 'NX') then return 0 end
redis.call('LPUSH', KEYS[1], ARGV[1])
redis.call('LTRIM', KEYS[1], 0, 99)
return 1
`;

async function recordActivity(uid, type, throttle = false) {
  const entry = { id: randomUUID(), type, at: new Date().toISOString() };
  await r('EVAL', RECORD, 2, 'activity:' + uid, 'activity:rate:' + type + ':' + uid, JSON.stringify(entry), throttle ? '1' : '0');
}

module.exports = { recordActivity };
