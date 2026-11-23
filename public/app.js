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
    if (!x.ok) throw Object.assign(new Error(j.error || 'Request failed.'), { status: x.status });
    return j;
  }
  const say = (t, c) => { const m = $('msg'); m.textContent = t; m.className = c || ''; };
  const inPi = () => typeof window.Pi !== 'undefined';

  let accountData;
  let accountError = false;

  const activityLabels = {
    sign_in: 'Pi account connected',
    payment_failure: 'Server reported a payment error',
    wallet_error_reported: 'This app reported a wallet error',
    payment_confirmed: 'Pi payment confirmed',
    purchase: 'Tickets credited',
    draw_announced: 'Draw results announced',
    draw_cancelled: 'Draw cancelled',
    winning: 'Prize won · payout pending',
    refund_pending: 'Refund queued',
    prize_paid: 'Prize marked paid',
    refund_paid: 'Refund marked paid',
  };

  function activityLabel(entry) {
    return [activityLabels[entry.type], entry.round && 'Draw ' + entry.round,
      entry.quantity && entry.quantity + (entry.quantity === 1 ? ' ticket' : ' tickets'),
      entry.amount != null && fmt(entry.amount) + ' π'].filter(Boolean).join(' · ');
  }

  function list(id, rows, empty) {
    $(id).replaceChildren(...(rows.length ? rows : [{ title: empty }]).map((row) => {
      const item = document.createElement('li');
      const title = document.createElement('strong');
      title.textContent = row.title;
      item.append(title);
      if (row.unread) {
        const badge = document.createElement('span');
        badge.className = 'unread-label';
        badge.textContent = 'Unread';
        item.append(badge);
      }
      if (row.at) {
        const time = document.createElement('time');
        time.dateTime = row.at;
        time.textContent = new Date(row.at).toLocaleString();
        item.append(time);
      }
      return item;
    }));
  }

  function renderAccount() {
    const data = signedIn && accountData?.username === nick ? accountData : null;
    const notifications = data?.notifications || [];
    const unread = notifications.filter((item) => !item.read).length;
    $('notificationDot').hidden = unread === 0;
    $('notifications').querySelector('summary').setAttribute('aria-label', unread ? 'Notifications, ' + unread + ' unread' : 'Notifications');
    $('markRead').hidden = unread === 0;
    $('accountConnect').hidden = signedIn;
    $('accountSections').hidden = !data;
    $('accountStatus').textContent = !signedIn ? 'Connect with Pi to see your account.'
      : 'Verified Pi account · @' + nick + (accountError ? ' · Could not refresh history' : data ? '' : ' · Loading history…');
    $('activityStatus').textContent = !signedIn ? 'Connect with Pi to see your notifications.'
      : accountError ? 'Could not refresh account activity. Try reopening this menu.'
      : !data ? 'Loading your notifications…' : unread + ' unread';
    if (!data) {
      for (const id of ['activityList', 'accountTickets', 'accountTransactions', 'accountWinnings', 'accountRefunds', 'accountActivity']) $(id).replaceChildren();
      return;
    }
    list('activityList', notifications.map((item) => ({ title: activityLabel(item), at: item.at, unread: !item.read })), 'No notifications yet.');
    list('accountTickets', data.tickets.map((item) => ({ title: item.round + ' · ' + item.count + (item.count === 1 ? ' ticket' : ' tickets') })), 'No ticket records.');
    list('accountTransactions', data.transactions.map((item) => ({
      title: item.round + ' · ' + item.quantity + ' tickets · ' + fmt(item.amount) + ' π · ' + (item.status === 'credited' ? 'Credited' : 'Refund pending'),
      at: item.at,
    })), 'No itemized payment records available.');
    for (const [id, type] of [['accountWinnings', 'prize'], ['accountRefunds', 'refund']]) {
      list(id, data.payouts.filter((item) => item.type === type).map((item) => ({
        title: item.round + ' · ' + fmt(item.amount) + ' π · ' + (item.status === 'paid' ? 'Marked paid' : 'Pending'),
        at: item.paidAt || item.at,
      })), type === 'prize' ? 'No winnings recorded.' : 'No refunds recorded.');
    }
    list('accountActivity', notifications.filter((item) => !item.type.startsWith('draw_')).map((item) => ({
      title: activityLabel(item), at: item.at,
    })), 'No account activity yet.');
  }

  async function refreshAccount() {
    const username = nick;
    if (!signedIn) { accountData = null; renderAccount(); return; }
    try {
      const data = await api('account');
      if (username !== nick || !signedIn || data.username !== username) return;
      accountData = data;
      accountError = false;
    } catch {
      if (username !== nick || !signedIn) return;
      accountError = true;
    }
    renderAccount();
  }

  function odds() {
    const N = S.tickets, k = S.mine;
    if (!k) return '0%';
    if (N < S.winners) return '—';
    let p = 1;
    for (let i = 0; i < S.winners; i++) p *= Math.max(N - k - i, 0) / (N - i);
    return new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 4 }).format(1 - p);
  }

  function render() {
    const gross = S.tickets * S.price;
    const pool = gross * S.payout;
    $('pool').textContent = fmt(pool) + ' π';
    $('poolDetails').textContent = S.tickets + ' tickets sold · ' + fmt(pool / S.winners) + ' π per winning ticket';
    $('nd').textContent = new Date(S.nextDraw).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    $('commit').textContent = S.commit;
    $('mine').textContent = S.mine + ' / ' + S.max;
    $('odds').textContent = odds();
    const bn = $('bn');
    bn.hidden = !S.sandbox;
    bn.textContent = 'Test mode: payments use the Pi test environment and have no real value.';
    const last = S.history[0];
    const w = last && !last.cancelled ? last.winners : [];
    $('lastinfo').textContent = last ? (last.cancelled ? 'The ' + last.id + ' draw was cancelled (fewer than 10 tickets). Refunds are queued.' : 'Draw of ' + last.id + '. Each winner receives ' + fmt(last.share) + ' π.') : 'Winners are shown by their verified Pi usernames.';
    renderSlots(w, S.winners);
    $('hist').innerHTML = S.history.length ? S.history.map((h) => '<li><b>' + esc(h.id) + '</b>: ' + (h.cancelled ? 'cancelled, ' + h.tickets + ' tickets refunded' : h.tickets + ' tickets, eligible pool ' + fmt(h.pool - h.fee) + ' π, ' + fmt(h.share) + ' π per winner, ' + fmt(h.fee) + ' π for organizing the game') + '<br><span class="muted">Seed: <code>' + esc(h.seed) + '</code></span></li>').join('') : '<li class="muted">No draws yet.</li>';
    renderAccount();
    $('connectBox').hidden = signedIn;
    $('buyBox').hidden = !signedIn;
    $('connected').hidden = !signedIn;
    $('piUsername').textContent = signedIn ? '@' + nick : '';
    $('ticketLimit').textContent = 'Current limit: ' + S.max + ' tickets per account per draw.';
    $('paymentNotice').hidden = !!S.purchasesEnabled;
    document.querySelectorAll('[data-buy]').forEach((b) => {
      const quantity = Number(b.dataset.buy);
      b.querySelector('.ticket-price').textContent = fmt(quantity * S.price) + ' π';
      b.disabled = !signedIn || !S.purchasesEnabled || S.mine + quantity > S.max;
    });
  }

  function renderSlots(winners, count) {
    $('slots').innerHTML = Array.from({ length: count }, (_, index) => {
      const winner = winners[index];
      return '<li class="slot"><b>' + (index + 1) + '</b><i class="person-icon" aria-hidden="true"></i><span>' + (winner ? esc(winner.nick) : '—') + '</span></li>';
    }).join('');
  }

  async function load() {
    const [state, session] = await Promise.all([
      api('state'),
      api('signin').catch((error) => {
        if (error.status === 401) return null;
        throw error;
      }),
    ]);
    S = state;
    nick = session?.username || '';
    signedIn = Boolean(nick);
    render();
    void refreshAccount();
  }

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
    if (!S?.purchasesEnabled) return say('Ticket purchases are paused until payment safety testing is finished.', 'err');
    if (!Number.isInteger(q) || q < 1 || S.mine + q > S.max) return say('That option exceeds your remaining tickets for this draw.', 'err');
    say('Opening Pi Wallet…');
    try {
      Promise.resolve(window.Pi.createPayment(
      { amount: q * S.price, memo: 'Ten Winners: ' + q + ' ticket' + (q > 1 ? 's' : '') + ' for the ' + S.round + ' draw', metadata: { qty: q, round: S.round } },
      {
        onReadyForServerApproval: (id) => api('pay', { action: 'approve', paymentId: id }).catch((e) => say(e.message, 'err')),
        onReadyForServerCompletion: (id, txid) => api('pay', { action: 'complete', paymentId: id, txid }).then(() => { say('Payment processed. Ticket crediting is pending verification; contact support before retrying.', 'err'); return load(); }).catch((e) => say(e.message, 'err')),
        onCancel: () => say('Payment cancelled.'),
        onError: walletError,
      }
      )).catch((e) => say(e.message || 'Pi Wallet could not open.', 'err'));
    } catch (e) { say(e.message || 'Pi Wallet could not open.', 'err'); }
  }

  for (const id of ['accountMenu', 'notifications']) {
    const menu = $(id);
    menu.addEventListener('toggle', () => { if (menu.open) void refreshAccount(); });
    document.addEventListener('click', (event) => {
      if (!menu.contains(event.target) || event.target.closest('#accountConnect')) menu.open = false;
    });
    menu.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      menu.open = false;
      menu.querySelector('summary').focus();
    });
  }

  $('markRead').onclick = async () => {
    const ids = accountData?.notifications.filter((item) => !item.read).map((item) => item.id);
    if (!ids?.length) return;
    const button = $('markRead');
    button.disabled = true;
    try {
      const username = nick;
      await api('account', { ids });
      if (username !== nick || !signedIn || accountData?.username !== username) return;
      accountData = { ...accountData, notifications: accountData.notifications.map((item) => ids.includes(item.id) ? { ...item, read: true } : item) };
      renderAccount();
      await refreshAccount();
    } catch {
      $('activityStatus').textContent = 'Could not mark notifications as read. Please try again.';
    } finally {
      button.disabled = false;
    }
  };

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
    renderSlots([], 10);
    try { await load(); } catch (e) { say('Could not load the game. Please refresh.', 'err'); return; }
    if (!inPi() && !signedIn) say('Open this app in Pi Browser to connect your account.');
    setInterval(() => load().catch(() => {}), 60000);
  })();
})();
