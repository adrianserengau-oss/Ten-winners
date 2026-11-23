const { recordActivity } = require('./_lib/activity');
const { r, pi, authUser, guard, createSessionCookie } = require('./_lib/core');

// Only the Pi Platform API can assert an account's identity.
// In particular, never accept a nickname, UID or username supplied by the browser.
module.exports = guard(async (req, res) => {
  if (req.method === 'GET') {
    const user = await authUser(req);
    if (!user) return res.status(401).json({ error: 'Not signed in.' });
    return res.json({ username: user.username });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const token = req.body && req.body.accessToken;
  if (typeof token !== 'string' || token.length < 10 || token.length > 4096) {
    return res.status(400).json({ error: 'Pi access token is required.' });
  }
  let identity;
  try {
    identity = await pi('/me', { token });
  } catch (e) {
    if (e.status === 401 || e.status === 403) {
      return res.status(401).json({ error: 'Pi could not verify the account. Reconnect through Pi Browser.' });
    }
    throw e;
  }
  if (!identity || typeof identity.uid !== 'string' || !identity.uid ||
      typeof identity.username !== 'string' || !identity.username) {
    return res.status(401).json({ error: 'Pi did not return a verified username.' });
  }
  const user = { uid: identity.uid, username: identity.username };
  // The existing draw history logic uses this map. Only verified Pi identities can update it.
  await r('HSET', 'nicks', user.uid, user.username);
  res.setHeader('Cache-Control', 'no-store');
  await recordActivity(user.uid, 'sign_in');
  res.setHeader('Set-Cookie', createSessionCookie(user));
  return res.json({ username: user.username });
});
