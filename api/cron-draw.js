const { r, dueAt, isWeeklyRound, draw, guard } = require('./_lib/core');

// Called by Vercel Cron each Sunday at 20:00 UTC. Legacy monthly rounds are excluded pending migration.
module.exports = guard(async (req, res) => {
  const s = process.env.CRON_SECRET;
  if (!s || req.headers.authorization !== 'Bearer ' + s) return res.status(401).json({ error: 'Unauthorized' });
  const drawn = [];
  for (const id of await r('SMEMBERS', 'rounds:open')) if (isWeeklyRound(id) && dueAt(id) <= Date.now() && (await draw(id))) drawn.push(id);
  res.json({ drawn });
});
