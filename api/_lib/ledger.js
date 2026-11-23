'use strict';

// Redis EVAL executes each transaction atomically. All monetary settlement remains
// pending and never triggers a blockchain transfer from these scripts.
const ISSUE = `
local pay = 'paid:' .. ARGV[1]
local prior = redis.call('GET', pay)
if prior then return prior end
local id, uid, qty = ARGV[2], ARGV[3], tonumber(ARGV[4])
local cutoff, now, maxTickets = tonumber(ARGV[5]), tonumber(ARGV[6]), tonumber(ARGV[7])
local function record(status)
  redis.call('LPUSH', 'transactions:' .. uid, cjson.encode({
    id=ARGV[1], round=id, quantity=qty, amount=qty * tonumber(ARGV[9]), at=ARGV[8], status=status
  }))
end
if now >= cutoff or redis.call('EXISTS', 'drawn:' .. id, 'closing:' .. id) > 0
   or tonumber(redis.call('HGET', 'cnt:' .. id, uid) or '0') + qty > maxTickets then
  redis.call('HSET', 'payouts', ARGV[1], cjson.encode({
    type='refund', round=id, uid=uid, amount=qty * tonumber(ARGV[9]), status='pending', createdAt=ARGV[8], payment=ARGV[1]
  }))
  record('refund_pending')
  redis.call('SET', pay, 'refund')
  return 'refund'
end
for i=1,qty do
  local n = redis.call('INCR', 'seq:' .. id)
  redis.call('RPUSH', 'tickets:' .. id, cjson.encode({n=n, uid=uid}))
end
redis.call('HINCRBY', 'cnt:' .. id, uid, qty)
redis.call('SADD', 'rounds:open', id)
record('credited')
redis.call('SET', pay, 'ok')
return 'ok'
`;

const FINALIZE = `
local id = ARGV[1]
if redis.call('EXISTS', 'result:' .. id) == 1 then return 'duplicate' end
local payouts = cjson.decode(ARGV[3])
for i=1,#payouts do
  redis.call('HSET', 'payouts', payouts[i].id, cjson.encode(payouts[i].record))
end
redis.call('SET', 'result:' .. id, ARGV[2])
redis.call('SET', 'drawn:' .. id, '1')
redis.call('LPUSH', 'history', id)
redis.call('SREM', 'rounds:open', id)
return 'ok'
`;

module.exports = { ISSUE, FINALIZE };
