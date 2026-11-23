(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (t) => { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; };
  const fmt = (n) => (+n).toFixed(4).replace(/\.?0+$/, '');
  let S, signedIn = false, nick = '', piReady = null;

  async function api(path, body) {
    const x = await fetch('/api/' + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await x.json().catch(() => ({}));
    if (!x.ok) throw new Error(j.error || 'Request failed.');
    return j;
  }
  const say = (t, c) => { const m = $('msg'); m.textContent = t; m.className = c || ''; };
  const inPi = () => typeof window.Pi !== 'undefined';

  function odds() {
    const N = S.tickets, k = S.mine;
    if (!k) return '0%';
    if (N < S.winners) return '—';
    let p = 1;
    for (let i = 0; i < S.winners; i++) p *= Math.max(N - k - i, 0) / (N - i);
    return (100 * (1 - p)).toFixed(1) + '%';
  }

  function render() {
    const gross = S.tickets * S.price;
    const pool = gross * S.payout;
    $('pool').textContent = fmt(pool);
    $('tk').textContent = S.tickets;
    $('share').textContent = fmt(pool / S.winners);
    $('fee').textContent = fmt(gross - pool);
    $('nd').textContent = new Date(S.nextDraw).toLocaleString([], { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    $('commit').textContent = S.commit;
    $('mine').textContent = S.mine + ' / ' + S.max;
    $('odds').textContent = odds();
    const bn = $('bn');
    bn.hidden = !S.sandbox;
    bn.textContent = 'Test mode: payments use the Pi test environment and have no real value.';
    const last = S.history[0];
    const w = last && !last.cancelled ? last.winners : [];
    $('lastinfo').textContent = last ? (last.cancelled ? 'The ' + last.id + ' draw was cancelled (fewer than 10 tickets). Tickets are refunded.' : 'Draw of ' + last.id + '. Each winner receives ' + fmt(last.share) + ' π.') : 'Winners are shown by their verified Pi usernames.';
    $('slots').innerHTML = Array.from({ length: S.winners }, (_, i) => w[i] ? '<div class="slot won"><b>#' + w[i].n + '</b>' + esc(w[i].nick) + '</div>' : '<div class="slot"><b>–</b>open</div>').join('');
    $('hist').innerHTML = S.history.length ? S.history.map((h) => '<li><b>' + esc(h.id) + '</b>: ' + (h.cancelled ? 'cancelled, ' + h.tickets + ' tickets refunded' : h.tickets + ' tickets, pool ' + fmt(h.pool) + ' π, ' + fmt(h.share) + ' π per winner, ' + fmt(h.fee) + ' π for organizing the game') + '<br><span class="muted">Seed: <code>' + esc(h.seed) + '</code></span></li>').join('') : '<li class="muted">No draws yet.</li>';
    $('connectBox').hidden = signedIn;
    $('buyBox').hidden = !signedIn;
    $('piUsername').textContent = signedIn ? nick : '';
    $('paymentNotice').hidden = !!S.purchasesEnabled;
    document.querySelectorAll('[data-buy]').forEach((b) => {
      b.disabled = !signedIn || !S.purchasesEnabled || S.mine + +b.dataset.buy > S.max;
    });
  }

  async function load() { S = await api('state'); render(); }

  async function connect() {
    if (!inPi()) return say('Open this app in the Pi Browser to connect and buy tickets.', 'err');
    try {
      if (!piReady) throw new Error('Pi SDK is unavailable. Please refresh in Pi Browser.');
      await piReady;
      const a = await window.Pi.authenticate(['username', 'payments'], (p) => {
        // Incomplete payments are resolved after sign-in has established the app session.
        window.__tenWinnersIncompletePayment = p;
      });
      if (!a || typeof a.accessToken !== 'string' || !a.accessToken) throw new Error('Pi did not return an access token. Please try signing in again.');
      // The server verifies the token directly with Pi Platform /v2/me.
      const session = await api('signin', { accessToken: a.accessToken });
      if (!session.username) throw new Error('The Pi account username could not be verified.');
      signedIn = true;
      nick = session.username;
      if (window.__tenWinnersIncompletePayment) {
        const pending = window.__tenWinnersIncompletePayment;
        window.__tenWinnersIncompletePayment = null;
        await api('pay', { action: 'incomplete', paymentId: pending.identifier }).catch(() => {});
      }
      await load();
      say('Connected to Pi as @' + nick + '.', 'ok');
    } catch (e) { signedIn = false; say(e.message || 'Could not connect.', 'err'); }
  }

  function buy(q) {
    if (!signedIn || !nick) return say('Connect your verified Pi account first.', 'err');
    if (!S.purchasesEnabled) return say('Ticket purchases are paused until payment safety testing is finished.', 'err');
    say('Opening Pi Wallet…');
    try {
      Promise.resolve(window.Pi.createPayment(
      { amount: q * S.price, memo: 'Ten Winners: ' + q + ' ticket' + (q > 1 ? 's' : '') + ' for the ' + S.round + ' draw', metadata: { qty: q, round: S.round } },
      {
        onReadyForServerApproval: (id) => api('pay', { action: 'approve', paymentId: id }).catch((e) => say(e.message, 'err')),
        onReadyForServerCompletion: (id, txid) => api('pay', { action: 'complete', paymentId: id, txid }).then(() => { say('Payment processed. Ticket crediting is pending verification; contact support before retrying.', 'err'); return load(); }).catch((e) => say(e.message, 'err')),
        onCancel: () => say('Payment cancelled.'),
        onError: (e) => say((e && e.message) || 'Payment failed.', 'err'),
      }
      )).catch((e) => say(e.message || 'Pi Wallet could not open.', 'err'));
    } catch (e) { say(e.message || 'Pi Wallet could not open.', 'err'); }
  }

  $('connect').onclick = connect;
  document.querySelectorAll('[data-buy]').forEach((b) => (b.onclick = () => buy(+b.dataset.buy)));

  // Initialize the Pi SDK exactly once, and wait for it before allowing authentication.
  // The SDK detects sandbox mode automatically; do not pass a sandbox option to Pi.init.
  if (inPi()) {
    piReady = (async () => {
      await window.Pi.init({ version: '2.0' });
      return true;
    })();
    piReady.catch((e) => {
      console.error('Pi SDK initialization failed:', e);
      say('Pi SDK could not initialize. Please refresh this app in Pi Browser.', 'err');
    });
  }

  (async () => {
    try { await load(); } catch (e) { say('Could not load the game. Please refresh.', 'err'); return; }
    if (!inPi()) say('You are viewing in a regular browser. Open this app in the Pi Browser to buy tickets.');
    setInterval(() => load().catch(() => {}), 60000);
  })();
})();
