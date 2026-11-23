(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (t) => { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; };
  const fmt = (n) => (+n).toFixed(4).replace(/\.?0+$/, '');
  let S, signedIn = false, nick = '', piReady = null;

  // Some Pi Browser sessions do not return the session cookie. Keep the fallback in memory.
  let sessionToken = '';
  let sessionVersion = 0;
  let sessionChecked = false;

  async function api(path, body, useFallback = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (useFallback && sessionToken && !(path === 'signin' && body)) headers.Authorization = 'Bearer ' + sessionToken;
    const x = await fetch('/api/' + path, {
      method: body ? 'POST' : 'GET',
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
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

  function activityLabel(entry) {
    return entry.type === 'winning'
      ? 'You won ' + fmt(entry.amount) + ' π · Draw ' + entry.round
      : 'Draw held · ' + entry.round;
  }

  const count = (n, unit) => n + ' ' + unit + (n === 1 ? '' : 's');

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
    $('accountSignedOut').hidden = !sessionChecked || signedIn;
    $('accountSections').hidden = !data;
    $('accountUsername').hidden = !signedIn;
    $('accountUsername').textContent = signedIn ? '@' + nick : '';
    $('accountAvatar').textContent = signedIn ? Array.from(nick).slice(0, 2).join('').toUpperCase() : 'π';
    $('accountStatus').textContent = !sessionChecked ? 'Checking your Pi session…'
      : !signedIn ? 'Connect with Pi to see your account.'
      : 'Verified Pi account' + (accountError ? ' · Could not refresh history' : data ? '' : ' · Loading history…');
    $('activityStatus').textContent = !signedIn ? 'Connect with Pi to see your notifications.'
      : accountError ? 'Could not refresh account activity. Try reopening this menu.'
      : !data ? 'Loading your notifications…' : notifications.length ? unread + ' unread' : 'Draw results and your wins will appear here.';
    if (!data) {
      for (const id of ['activityList', 'accountTickets', 'accountTransactions', 'accountWinnings', 'accountRefunds', 'accountActivity']) $(id).replaceChildren();
      return;
    }
    list('activityList', notifications.map((item) => ({ title: activityLabel(item), at: item.at, unread: !item.read })), 'No notifications yet.');
    const tickets = data.tickets.filter((item) => item.count > 0);
    const signIns = data.signIns || [];
    $('signInSummary').textContent = count(signIns.length, 'recorded sign-in');
    $('ticketSummary').textContent = count(tickets.reduce((sum, item) => sum + item.count, 0), 'ticket') + ' across ' + count(tickets.length, 'recent draw');
    list('accountActivity', signIns.map((entry) => ({ title: 'Signed in with Pi', at: entry.at })), 'No sign-ins recorded.');
    list('accountTickets', tickets.map((item) => ({ title: count(item.count, 'ticket') + ' · Draw ' + item.round })), 'No tickets purchased in recent draws.');
    list('accountTransactions', data.transactions.map((item) => ({
      title: item.round + ' · ' + item.quantity + ' tickets · ' + fmt(item.amount) + ' π · ' + (item.status === 'credited' ? 'Credited' : 'Refund pending'),
      at: item.at,
    })), 'No itemized payment records available.');
    for (const [id, summary, type, unit] of [
      ['accountWinnings', 'winningsSummary', 'prize', 'prize'],
      ['accountRefunds', 'refundSummary', 'refund', 'refund'],
    ]) {
      const records = data.payouts.filter((item) => item.type === type);
      const pending = records.filter((item) => item.status !== 'paid').length;
      const total = records.reduce((amount, item) => amount + item.amount, 0);
      $(summary).textContent = count(records.length, unit) + ' · ' + fmt(total) + ' π total · ' + pending + ' pending';
      list(id, records.map((item) => ({
        title: 'Draw ' + item.round + ' · ' + fmt(item.amount) + ' π · ' + (item.status === 'paid' ? 'Marked paid' : 'Pending'),
        at: item.paidAt || item.at,
      })), type === 'prize' ? 'No winnings recorded.' : 'No refunds recorded.');
    }
  }

  async function refreshAccount() {
    const username = nick;
    if (!signedIn) { accountData = null; renderAccount(); return; }
    try {
      const data = await api('account');
      if (username !== nick || !signedIn) return;
      if (data.username !== username) throw new Error('Account history does not match the current session.');
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
    $('connectBox').hidden = signedIn;
    $('buyBox').hidden = !signedIn;
    $('connected').hidden = !signedIn;
    $('piUsername').textContent = signedIn ? '@' + nick : '';
    renderAccount();
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
    const version = sessionVersion;
    const [state, session] = await Promise.all([
      api('state'),
      api('signin').catch((error) => {
        if (error.status === 401) return null;
        throw error;
      }),
    ]);
    if (version !== sessionVersion) return;
    S = state;
    nick = session?.username || '';
    signedIn = Boolean(nick);
    sessionChecked = true;
    if (!signedIn && $('msg').className === 'ok') say('Your Pi session ended. Please reconnect.');
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
      const cookieSession = await api('signin', undefined, false).catch(() => null);
      sessionToken = cookieSession?.username !== session.username && typeof session.sessionToken === 'string' ? session.sessionToken : '';
      sessionVersion++;
      await load();
      if (!signedIn || nick !== session.username) throw new Error('Pi verified your username, but the app session did not start. Please reconnect.');
      if (window.__tenWinnersIncompletePayment) {
        const pending = window.__tenWinnersIncompletePayment;
        window.__tenWinnersIncompletePayment = null;
        await api('pay', { action: 'incomplete', paymentId: pending.identifier }).catch(() => {});
      }
      say('Connected to Pi as @' + nick + '.', 'ok');
    } catch (e) { say(e.message || 'Could not connect.', 'err'); }
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

  const notificationsMenu = $('notifications');
  const accountDrawer = $('accountMenu');
  notificationsMenu.addEventListener('toggle', () => { if (notificationsMenu.open) void refreshAccount(); });
  document.addEventListener('click', (event) => {
    if (!notificationsMenu.contains(event.target)) notificationsMenu.open = false;
  });
  notificationsMenu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    notificationsMenu.open = false;
    notificationsMenu.querySelector('summary').focus();
  });
  $('openAccount').onclick = () => {
    notificationsMenu.open = false;
    accountDrawer.showModal();
    void refreshAccount();
  };
  $('closeAccount').onclick = () => accountDrawer.close();
  $('accountConnect').onclick = () => accountDrawer.close();
  accountDrawer.addEventListener('click', (event) => {
    if (event.target !== accountDrawer) return;
    const bounds = accountDrawer.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) accountDrawer.close();
  });

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
    try { await load(); } catch (e) {
      $('accountStatus').textContent = 'Could not check your Pi session. Please refresh.';
      say('Could not load the game. Please refresh.', 'err');
      return;
    }
    if (!inPi() && !signedIn) say('Open this app in Pi Browser to connect your account.');
    setInterval(() => load().catch(() => {}), 60000);
  })();
})();
