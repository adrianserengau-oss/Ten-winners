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
    const pool = S.tickets * S.price;
    $('pool').textContent = fmt(pool);
    $('tk').textContent = S.tickets;
    $('share').textContent = fmt(pool * S.payout / S.winners);
    $('fee').textContent = fmt(pool * (1 - S.payout));
    $('nd').textContent = new Date(S.nextDraw).toLocaleString([], { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    $('commit').textContent = S.commit;
    $('mine').textContent = S.mine + ' / ' + S.max;
    $('odds').textContent = odds();
    const bn = $('bn');
    bn.hidden = !S.sandbox;
    bn.textContent = 'Test mode: payments use the Pi test environment and have no real value.';
    const last = S.history[0];
    const w = last && !last.cancelled ? last.winners : [];
    $('lastinfo').textContent = last ? (last.cancelled ? 'The ' + last.id + ' draw was cancelled (fewer than 10 tickets). Tickets are refunded.' : 'Draw of ' + last.id + '. Each winner receives ' + fmt(last.share) + ' π.') : 'Winners are shown by their in-app nicknames.';
    $('slots').innerHTML = Array.from({ length: S.winners }, (_, i) => w[i] ? '<div class="slot won"><b>#' + w[i].n + '</b>' + esc(w[i].nick) + '</div>' : '<div class="slot"><b>–</b>open</div>').join('');
    $('hist').innerHTML = S.history.length ? S.history.map((h) => '<li><b>' + esc(h.id) + '</b>: ' + (h.cancelled ? 'cancelled, ' + h.tickets + ' tickets refunded' : h.tickets + ' tickets, pool ' + fmt(h.pool) + ' π, ' + fmt(h.share) + ' π per winner, ' + fmt(h.fee) + ' π for organizing the game') + '<br><span class="muted">Seed: <code>' + esc(h.seed) + '</code></span></li>').join('') : '<li class="muted">No draws yet.</li>';
    $('connectBox').hidden = signedIn;
    $('buyBox').hidden = !signedIn;
    document.querySelectorAll('[data-buy]').forEach((b) => { b.disabled = !nick || S.mine + +b.dataset.buy > S.max; });
  }

  async function load() { S = await api('state'); render(); }

  async function connect() {
    if (!inPi()) return say('Open this app in the Pi Browser to connect and buy tickets.', 'err');
    try {
      await piReady;
      const a = await Pi.authenticate(['username'], (p) => {
        // Incomplete payments are resolved after sign-in has established the app session.
        window.__tenWinnersIncompletePayment = p;
      });
      const session = await api('signin', { accessToken: a.accessToken });
      signedIn = true;
      nick = session.nickname || '';
      $('nick').value = nick;
      if (window.__tenWinnersIncompletePayment) {
        const pending = window.__tenWinnersIncompletePayment;
        window.__tenWinnersIncompletePayment = null;
        await api('pay', { action: 'incomplete', paymentId: pending.identifier }).catch(() => {});
      }
      await load();
      say(nick ? 'Connected.' : 'Connected. Choose a nickname to start buying tickets.', 'ok');
    } catch (e) { signedIn = false; say(e.message || 'Could not connect.', 'err'); }
  }

  async function saveNick() {
    try { nick = (await api('signin', { nickname: $('nick').value })).nickname; say('Nickname saved.', 'ok'); render(); }
    catch (e) { say(e.message, 'err'); }
  }

  function buy(q) {
    if (!nick) return say('Save a nickname first.', 'err');
    say('Opening Pi Wallet…');
    Pi.createPayment(
      { amount: q * S.price, memo: 'Ten Winners: ' + q + ' ticket' + (q > 1 ? 's' : '') + ' for the ' + S.round + ' draw', metadata: { qty: q, round: S.round } },
      {
        onReadyForServerApproval: (id) => api('pay', { action: 'approve', paymentId: id }).catch((e) => say(e.message, 'err')),
        onReadyForServerCompletion: (id, txid) => api('pay', { action: 'complete', paymentId: id, txid }).then(() => { say('Payment confirmed. Your tickets are in the draw.', 'ok'); return load(); }).catch((e) => say(e.message, 'err')),
        onCancel: () => say('Payment cancelled.'),
        onError: (e) => say((e && e.message) || 'Payment failed.', 'err'),
      }
    );
  }

  $('connect').onclick = connect;
  $('saveNick').onclick = saveNick;
  document.querySelectorAll('[data-buy]').forEach((b) => (b.onclick = () => buy(+b.dataset.buy)));

  (async () => {
    try { await load(); } catch (e) { say('Could not load the game. Please refresh.', 'err'); return; }
    if (inPi()) Pi.init({ version: '2.0', sandbox: S.sandbox });
    else say('You are viewing in a regular browser. Open this app in the Pi Browser to buy tickets.');
    setInterval(() => load().catch(() => {}), 60000);
  })();
})();
