const { r, dueAt, draw, guard } = require('./_lib/core');

// Called by Vercel Cron on the 1st of each month. Safe to call again: each round is drawn once.
module.exports = guard(async (req, res) => {
  const s = process.env.CRON_SECRET;
  if (!s || req.headers.authorization !== 'Bearer ' + s) return res.status(401).json({ error: 'Unauthorized' });
  const drawn = [];
  for (const id of await r('SMEMBERS', 'rounds:open')) if (dueAt(id) <= Date.now() && (await draw(id))) drawn.push(id);
  res.json({ drawn });
});
