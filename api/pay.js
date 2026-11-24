const { recordActivity } = require('./_lib/activity');
const { C, r, pi, nextDraw, rid, isWeeklyRound, issue, authUser, guard, bad } = require('./_lib/core');
const { purchasesEnabled } = require('./_lib/sandbox');

const validId = (value) => typeof value === 'string' && /^[\w-]{6,100}$/.test(value);
const validTx = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const pendingKey = (uid) => 'sandbox:payments:pending:' + uid;

async function payment(path, body) {
  return pi('/payments/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    key: process.env.PI_SANDBOX_API_KEY,
    body,
  });
}

function verifyPurchase(p, id, uid) {
  if (p?.identifier !== id || p.user_uid !== uid || p.network !== 'Pi Testnet' ||
      p.direction !== 'user_to_app' || !C.BUNDLES.includes(p.metadata?.qty) ||
      typeof p.metadata.round !== 'string' || !isWeeklyRound(p.metadata.round) || p.metadata.round > rid(nextDraw()) ||
      p.amount !== p.metadata.qty * C.PRICE ||
      p.status?.cancelled !== false || p.status.user_cancelled !== false) {
    throw bad('Pi did not return a valid Sandbox ticket purchase for this account.');
  }
}

async function approve(id, uid, p) {
  const { round, qty } = p.metadata;
  if (round !== rid(nextDraw()) || p.transaction !== null || p.status.developer_completed !== false ||
      typeof p.status.developer_approved !== 'boolean') {
    throw bad('This payment cannot be approved for the current draw.');
  }
  const have = Number(await r('HGET', 'cnt:' + round, uid) || 0);
  if (!Number.isSafeInteger(have) || have < 0 || have + qty > C.SANDBOX_MAX) {
    throw bad('This purchase exceeds the ticket limit for the draw.');
  }
  if (p.status.developer_approved !== true) await payment(id + '/approve', {});
  return 'approved';
}

async function complete(id, uid, p, txid) {
  if (!validTx(txid) || p.transaction?.txid !== txid || p.status.developer_approved !== true) {
    throw bad('The submitted transaction does not match the Pi payment.');
  }
  // Keep a durable recovery entry before Pi can mark the payment complete.
  await r('SADD', pendingKey(uid), id);
  if (p.status.developer_completed !== true) {
    try {
      await payment(id + '/complete', { txid });
    } catch (error) {
      // A concurrent request or a lost response can leave the payment completed.
      const current = await payment(id);
      if (current?.status?.developer_completed !== true) throw error;
    }
  }
  const verified = await payment(id);
  verifyPurchase(verified, id, uid);
  if (verified.metadata.round !== p.metadata.round || verified.metadata.qty !== p.metadata.qty ||
      verified.status.developer_approved !== true || verified.status.developer_completed !== true ||
      verified.status.transaction_verified !== true || verified.transaction?.verified !== true ||
      verified.transaction.txid !== txid) {
    throw bad('Pi has not verified payment completion. Reconnect to retry ticket crediting.');
  }
  return issue(verified, pendingKey(uid));
}

async function resolve(id, uid, action, txid) {
  const p = await payment(id);
  if (action === 'incomplete' && p?.identifier === id && p.user_uid === uid &&
      p.network === 'Pi Testnet' && p.direction === 'user_to_app' &&
      (p.status?.cancelled === true || p.status?.user_cancelled === true)) {
    await r('SREM', pendingKey(uid), id);
    return 'cancelled';
  }
  verifyPurchase(p, id, uid);
  if (action === 'approve') return approve(id, uid, p);
  if (action === 'incomplete' && p.transaction === null) return 'pending';
  return complete(id, uid, p, action === 'incomplete' ? p.transaction?.txid : txid);
}

module.exports = guard(async (req, res) => {
  if (!purchasesEnabled()) return res.status(403).json({ error: 'Ticket purchases are available only in the Pi Sandbox.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const user = await authUser(req);
  if (!user) return res.status(401).json({ error: 'Pi sign-in is required.' });
  const { action, paymentId, txid } = req.body || {};
  if (action === 'recover') {
    const ids = await r('SMEMBERS', pendingKey(user.uid));
    const recovered = await Promise.allSettled(ids.map((id) => resolve(id, user.uid, 'incomplete')));
    return res.json({
      results: recovered.filter((entry) => entry.status === 'fulfilled').map((entry) => entry.value),
      retryPending: recovered.some((entry) => entry.status === 'rejected' || entry.value === 'pending'),
    });
  }

  if (!['approve', 'complete', 'incomplete'].includes(action) || !validId(paymentId) ||
      (action === 'complete' && !validTx(txid))) throw bad('Bad payment request.');
  try {
    return res.json({ result: await resolve(paymentId, user.uid, action, txid) });
  } catch (error) {
    await recordActivity(user.uid, 'payment_failure', true).catch(() => {});
    throw error;
  }
});
