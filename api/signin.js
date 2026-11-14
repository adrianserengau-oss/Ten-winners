const { r, authUser, guard, bad, createSessionCookie } = require('./_lib/core');

const APP_STUDIO_LOGIN = 'https://backend.appstudio-u7cm9zhmha0ruwv8.piappengine.com/pi/auth/v1/login';

module.exports = guard(async (req, res) => {
  if (req.method === 'GET') {
    const u = await authUser(req);
    if (!u) return res.status(401).json({ error: 'Not signed in.' });
    return res.json({ nickname: (await r('HGET', 'nicks', u.uid)) || '' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const body = req.body || {};
  let u = await authUser(req);

  // Initial sign-in: exchange the Pi SDK accessToken with Pi App Studio.
  if (typeof body.accessToken === 'string' && body.accessToken.length > 0) {
    const response = await fetch(APP_STUDIO_LOGIN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: body.accessToken }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.sessionToken || !data.user || !data.user.uid || !data.user.username) {
      console.error('App Studio login rejected:', response.status);
      return res.status(401).json({ error: 'Pi sign-in could not be verified by App Studio.' });
    }
    // Only identity returned by App Studio is trusted. Browser uid/username are ignored.
    u = { uid: String(data.user.uid), username: String(data.user.username) };
    res.setHeader('Set-Cookie', createSessionCookie({ ...u, sessionToken: data.sessionToken }));
  }

  if (!u) return res.status(401).json({ error: 'Pi sign-in is required.' });

  const nickname = typeof body.nickname === 'string' ? body.nickname.trim() : '';
  if (nickname) {
    if (!/^[A-Za-z0-9_]{3,20}$/.test(nickname)) throw bad('Nickname: 3 to 20 letters, numbers or underscores.');
    await r('HSET', 'nicks', u.uid, nickname);
  }
  res.json({ nickname: (await r('HGET', 'nicks', u.uid)) || '' });
});
