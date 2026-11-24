const { addWinnerAvatars } = require('./_lib/avatars');
const { C, r, nextDraw, rid, sha, seedFor, authUser, guard } = require('./_lib/core');
const { sandboxDeployment, purchaseBlocker } = require('./_lib/sandbox');

module.exports = guard(async (req, res) => {
  const nd = nextDraw(), id = rid(nd);
  const commit = sha(await seedFor(id));
  const tickets = await r('LLEN', 'tickets:' + id);
  const u = await authUser(req);
  const mine = u ? +(await r('HGET', 'cnt:' + id, u.uid)) || 0 : 0;
  const ids = await r('LRANGE', 'history', 0, 11);
  const history = ids.length ? (await r('MGET', ...ids.map((i) => 'result:' + i))).map((x) => JSON.parse(x)) : [];
  await addWinnerAvatars(history[0]);
  const sandbox = sandboxDeployment(), blocker = purchaseBlocker();
  res.json({ round: id, nextDraw: nd.toISOString(), drawHourUtc: C.DRAW_HOUR_UTC, tickets, mine, commit,
    price: C.PRICE, max: sandbox ? C.SANDBOX_MAX : C.MAX,
    bundles: C.BUNDLES, winners: C.WINNERS, payout: C.PAYOUT,
    cadence: 'weekly', drawDayUtc: 0, sandbox, purchasesEnabled: blocker === null,
    purchaseBlocker: sandbox ? blocker : undefined, history });
});
