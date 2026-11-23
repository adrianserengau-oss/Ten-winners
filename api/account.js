const { recordActivity } = require('./_lib/activity');
const { authUser, guard, bad, r, nextDraw, rid, dueAt } = require('./_lib/core');

const PAGE = 100;
const LEGACY_PAYOUTS = `
local values = redis.call('HGETALL', 'payouts')
local own = {}
for i = 1, #values, 2 do
  local item = cjson.decode(values[i + 1])
  if item.uid == ARGV[1] then
    own[#own + 1] = values[i]
    own[#own + 1] = values[i + 1]
  end
end
return own
`;

const event = (id, type, at, fields = {}) => ({ id, type, at, ...fields });

async function account(user) {
  const round = rid(nextDraw());
  const [rounds, records, transactions, entries, read] = await Promise.all([
    r('LRANGE', 'history', 0, PAGE - 1),
    r('EVAL', LEGACY_PAYOUTS, 0, user.uid),
    r('LRANGE', 'transactions:' + user.uid, 0, PAGE - 1),
    r('LRANGE', 'activity:' + user.uid, 0, PAGE - 1),
    r('SMEMBERS', 'activity:read:' + user.uid),
  ]);
  const ids = [...new Set([round, ...rounds])];
  const [counts, rawDraws] = await Promise.all([
    r('EVAL', "local result = {} for i=2,#ARGV do result[#result+1]=tonumber(redis.call('HGET','cnt:'..ARGV[i],ARGV[1]) or '0') end return result", 0, user.uid, ...ids),
    rounds.length ? r('MGET', ...rounds.map((id) => 'result:' + id)) : [],
  ]);
  const tickets = ids.map((id, i) => ({ round: id, count: counts[i] })).filter((item) => item.count || item.round === round);
  const payments = transactions.map((raw) => JSON.parse(raw));
  const notifications = entries.map((raw) => JSON.parse(raw));
  for (const item of payments) {
    notifications.push(event('confirmed:' + item.id, 'payment_confirmed', item.at, { round: item.round, quantity: item.quantity, amount: item.amount }));
    if (item.status === 'credited') notifications.push(event('purchase:' + item.id, 'purchase', item.at, { round: item.round, quantity: item.quantity }));
  }
  for (const raw of rawDraws) {
    if (!raw) continue;
    const draw = JSON.parse(raw);
    const cutoff = dueAt(draw.id);
    notifications.push(event('draw:' + draw.id, draw.cancelled ? 'draw_cancelled' : 'draw_announced',
      draw.drawnAt || (Number.isFinite(cutoff) ? new Date(cutoff).toISOString() : null), { round: draw.id }));
  }
  const payouts = [];
  for (let i = 0; i < records.length; i += 2) {
    const key = records[i];
    const item = JSON.parse(records[i + 1]);
    const at = item.createdAt || null;
    payouts.push({ round: item.round, type: item.type, amount: item.amount, status: item.status, at, paidAt: item.paidAt });
    notifications.push(event('queued:' + key, item.type === 'prize' ? 'winning' : 'refund_pending', at, { round: item.round, amount: item.amount }));
    if (item.status === 'paid') notifications.push(event('paid:' + key, item.type === 'prize' ? 'prize_paid' : 'refund_paid', item.paidAt || null, { round: item.round, amount: item.amount }));
  }
  const marked = new Set(read);
  notifications.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  payouts.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  return { username: user.username, tickets, transactions: payments, payouts,
    notifications: notifications.slice(0, PAGE).map((item) => ({ ...item, read: marked.has(item.id) })) };
}

module.exports = guard(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error: 'Pi sign-in is required.' });
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (req.method === 'GET') return res.json(await account(user));
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw bad('Expected JSON.');
  const { action, ids } = req.body || {};
  if (action === 'report_wallet_error') {
    await recordActivity(user.uid, 'wallet_error_reported', true);
    return res.json({ ok: true });
  }
  if (!Array.isArray(ids) || ids.length > PAGE || ids.some((id) => typeof id !== 'string' || id.length > 128)) throw bad('Invalid notification selection.');
  const data = await account(user);
  const selected = new Set(ids);
  const eligible = data.notifications.filter((item) => selected.has(item.id) && !item.read);
  if (eligible.length) await r('SADD', 'activity:read:' + user.uid, ...eligible.map((item) => item.id));
  res.json({ ok: true });
});
