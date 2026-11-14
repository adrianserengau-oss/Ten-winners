const { r, guard, bad } = require('./_lib/core');

// Admin only. GET lists payouts (prizes and refunds). POST {key} marks one as paid.
// Winners are paid from the app wallet; automate this with a Pi backend SDK (A2U) once approved.
module.exports = guard(async (req, res) => {
  const s = process.env.ADMIN_SECRET;
  if (!s || req.headers.authorization !== 'Bearer ' + s) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method === 'POST') {
    const key = (req.body || {}).key, raw = key && await r('HGET', 'payouts', key);
    if (!raw) throw bad('Unknown payout.');
    await r('HSET', 'payouts', key, JSON.stringify({ ...JSON.parse(raw), status: 'paid', paidAt: new Date().toISOString() }));
    return res.json({ ok: true });
  }
  const a = await r('HGETALL', 'payouts'), out = [];
  for (let i = 0; i < a.length; i += 2) out.push({ key: a[i], ...JSON.parse(a[i + 1]) });
  res.json({ pending: out.filter((x) => x.status === 'pending'), paid: out.filter((x) => x.status === 'paid').length });
});
