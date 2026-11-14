const { r, authUser, guard, bad } = require('./_lib/core');

// Verifies the Pi access token with GET /me, then saves the in-app nickname (never the Pi username).
module.exports = guard(async (req, res) => {
  const u = await authUser(req);
  if (!u) return res.status(401).json({ error: 'Pi sign-in could not be verified.' });
  const nick = ((req.body && req.body.nickname) || '').trim();
  if (nick) {
    if (!/^[A-Za-z0-9_]{3,20}$/.test(nick)) throw bad('Nickname: 3 to 20 letters, numbers or underscores.');
    await r('HSET', 'nicks', u.uid, nick);
  }
  res.json({ nickname: (await r('HGET', 'nicks', u.uid)) || '' });
});
