'use strict';

// Redis EVAL executes each transaction atomically. All monetary settlement remains
// pending and never triggers a blockchain transfer from these scripts.
const ISSUE = `
local pay, tx = 'paid:' .. ARGV[1], 'paid:tx:' .. ARGV[9]
local paymentTx = 'paid:payment-tx:' .. ARGV[1]
local linked = redis.call('GET', tx)
local existingTx = redis.call('GET', paymentTx)
if (linked and linked ~= ARGV[1]) or (existingTx and existingTx ~= ARGV[9]) then return 'duplicate_tx' end
local function markTransaction()
  redis.call('MSET', tx, ARGV[1], paymentTx, ARGV[9])
end
local prior = redis.call('GET', pay)
if prior then
  if prior == 'ok' or prior == 'refund' then markTransaction() end
  return prior
end
local id, uid, qty = ARGV[2], ARGV[3], tonumber(ARGV[4])
local cutoff, maxTickets = tonumber(ARGV[5]), tonumber(ARGV[6])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local function expectType(key, expected)
  local actual = redis.call('TYPE', key).ok
  if actual ~= 'none' and actual ~= expected then error('Invalid ledger key type') end
end
local history, counts, sequence, tickets = 'transactions:' .. uid, 'cnt:' .. id, 'seq:' .. id, 'tickets:' .. id
expectType(history, 'list')
local function counter(raw)
  local n = tonumber(raw or '0')
  if not n or n < 0 or n > 9007199254740000 or tostring(raw or '0'):match('^%d+$') == nil then
    error('Invalid ledger counter')
  end
  if raw and raw ~= '0' and raw:sub(1, 1) == '0' then error('Invalid ledger counter') end
  return n
end
local function record(status)
  redis.call('LPUSH', history, cjson.encode({
    id=ARGV[1], round=id, quantity=qty, amount=qty * tonumber(ARGV[8]), at=ARGV[7], status=status
  }))
end
if now >= cutoff or redis.call('EXISTS', 'drawn:' .. id, 'closing:' .. id, 'result:' .. id) > 0
   or counter(redis.call('HGET', counts, uid)) + qty > maxTickets then
  redis.call('HSET', 'payouts', ARGV[1], cjson.encode({
    type='refund', round=id, uid=uid, amount=qty * tonumber(ARGV[8]), status='pending', createdAt=ARGV[7], payment=ARGV[1]
  }))
  record('refund_pending')
  redis.call('SET', pay, 'refund')
  markTransaction()
  return 'refund'
end
counter(redis.call('GET', sequence))
expectType(tickets, 'list')
expectType('rounds:open', 'set')
for i=1,qty do
  local n = redis.call('INCR', sequence)
  redis.call('RPUSH', tickets, cjson.encode({n=n, uid=uid}))
end
redis.call('HINCRBY', counts, uid, qty)
redis.call('SADD', 'rounds:open', id)
record('credited')
redis.call('SET', pay, 'ok')
markTransaction()
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
