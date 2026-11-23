const { recordActivity } = require('./_lib/activity');
const { C, r, pi, nextDraw, rid, issue, authUser, guard, bad } = require('./_lib/core');

// U2A payment flow (Pi docs): approve -> user signs in Pi Wallet -> complete.
// Everything is re-checked against the Platform API; nothing sent by the browser is trusted.
async function approve(paymentId, uid) {
  // No new paid entries until atomic ticket crediting and payout settlement are implemented.
  throw bad('Ticket purchases are temporarily unavailable while payment safety checks are completed.');
  const p = await pi('/payments/' + paymentId, { key: 1 });
  if (p.user_uid !== uid) throw bad('This payment does not belong to the signed-in user.');
  const m = p.metadata || {}, qty = +m.qty, id = rid(nextDraw());
  const have = +(await r('HGET', 'cnt:' + id, p.user_uid)) || 0;
  const ok = p.direction === 'user_to_app' && m.round === id && Number.isInteger(qty) && qty >= 1 && qty <= C.MAX
    && Number(p.amount) === qty * C.PRICE && have + qty <= C.MAX;
  if (!ok) { await pi('/payments/' + paymentId + '/cancel', { method: 'POST', key: 1 }).catch(() => {}); throw bad('This purchase is not valid for the current round.'); }
  await pi('/payments/' + paymentId + '/approve', { method: 'POST', key: 1 });
}

async function complete(paymentId, txid, uid) {
  const p = await pi('/payments/' + paymentId, { key: 1 });
  if (p.user_uid !== uid) throw bad('This payment does not belong to the signed-in user.');
  if (p.direction !== 'user_to_app' || !p.metadata || !Number.isInteger(Number(p.metadata.qty)) ||
      Number(p.metadata.qty) < 1 || Number(p.metadata.qty) > C.MAX ||
      Number(p.amount) !== Number(p.metadata.qty) * C.PRICE) {
    throw bad('Payment metadata does not match a valid ticket purchase.');
  }
  if (p.status && p.status.cancelled) throw bad('Payment was cancelled.');
  if (p.transaction && p.transaction.txid && p.transaction.txid !== txid) throw bad('Transaction ID does not match the Pi payment.');
  if (!p.status || !p.status.developer_completed) {
    await pi('/payments/' + paymentId + '/complete', { method: 'POST', key: 1, body: { txid } });
  }
  const verified = await pi('/payments/' + paymentId, { key: 1 });
  if (verified.user_uid !== uid || verified.direction !== 'user_to_app' ||
      !verified.status || !verified.status.developer_completed ||
      !verified.transaction || verified.transaction.txid !== txid ||
      verified.metadata?.round !== p.metadata.round ||
      Number(verified.metadata?.qty) !== Number(p.metadata.qty) ||
      Number(verified.amount) !== Number(p.amount)) {
    throw new Error('Payment completion could not be independently verified.');
  }
  return issue(verified);
}

module.exports = guard(async (req, res) => {
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error: 'Pi sign-in is required.' });
  const { action, paymentId, txid } = req.body || {};
  if (req.method !== 'POST' || !/^[\w-]{6,100}$/.test(paymentId || '')) throw bad('Bad request.');
  try {
    if (action === 'approve') await approve(paymentId, user.uid);
    else if (action === 'complete') { if (typeof txid !== 'string' || !/^[a-zA-Z0-9_-]{6,150}$/.test(txid)) throw bad('Invalid transaction id.'); res.setHeader('X-Result', await complete(paymentId, txid, user.uid)); }
    else if (action === 'incomplete') { // payment left unfinished from an earlier session
      const p = await pi('/payments/' + paymentId, { key: 1 });
      if (p.user_uid !== user.uid) throw bad('This payment does not belong to the signed-in user.');
      if (p.transaction && p.transaction.txid) await complete(paymentId, p.transaction.txid, user.uid);
      else if (!p.status.developer_completed && !p.status.cancelled) await pi('/payments/' + paymentId + '/cancel', { method: 'POST', key: 1 });
    } else throw bad('Unknown action.');
  } catch (error) {
    if (['approve', 'complete', 'incomplete'].includes(action)) {
      await recordActivity(user.uid, 'payment_failure', true).catch(() => {});
    }
    throw error;
  }
  res.json({ ok: true });
});
