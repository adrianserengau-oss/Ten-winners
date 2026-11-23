const { addWinnerAvatars } = require('./_lib/avatars');
const { C, r, nextDraw, rid, sha, seedFor, authUser, guard } = require('./_lib/core');

module.exports = guard(async (req, res) => {
  const nd = nextDraw(), id = rid(nd);
  const commit = sha(await seedFor(id));
  const tickets = await r('LLEN', 'tickets:' + id);
  const u = await authUser(req);
  const mine = u ? +(await r('HGET', 'cnt:' + id, u.uid)) || 0 : 0;
  const ids = await r('LRANGE', 'history', 0, 11);
  const history = ids.length ? (await r('MGET', ...ids.map((i) => 'result:' + i))).map((x) => JSON.parse(x)) : [];
  await addWinnerAvatars(history[0]);
  res.json({ round: id, nextDraw: nd.toISOString(), drawHourUtc: C.DRAW_HOUR_UTC, tickets, mine, commit,
    price: C.PRICE, max: C.MAX, winners: C.WINNERS, payout: C.PAYOUT, cadence: 'weekly', drawDayUtc: 0, sandbox: process.env.PI_SANDBOX !== 'false', purchasesEnabled: false, history });
});
