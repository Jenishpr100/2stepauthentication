a(() => {
  'use strict';

  const DEMO = window.DEMO === true;
  const MAX_ATTEMPTS = 3;
  const $ = id => document.getElementById(id);
  const el = {
    banner: $('demo-banner'), main: $('main'), title: $('title'), sub: $('sub'),
    auth: $('view-auth'), form: $('auth-form'), user: $('username'), pass: $('password'),
    msg: $('msg'), submit: $('submit'), toggle: $('toggle'),
    home: $('view-home'), welcome: $('welcome'), note: $('note'), logout: $('logout'),
    modal: $('modal'), humanForm: $('human-form'), qImg: $('q-img'), qText: $('q-text'),
    answer: $('answer'), humanMsg: $('human-msg'), cancel: $('cancel'), theme: $('theme')
  };

  let mode = 'login';
  let challengeId = null;
  let busy = false;

  // ---- API: real (server) or fake (standalone demo) ----
  function serverApi() {
    return {
      async call(path, body) {
        try {
          const r = await fetch('/api/' + path, {
            method: path === 'me' ? 'GET' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: path === 'me' ? undefined : JSON.stringify(body || {}),
            credentials: 'same-origin'
          });
          let data = {};
          try { data = await r.json(); } catch (_) {}
          return { status: r.status, data };
        } catch (_) {
          return { status: 0, data: { error: 'Network error.' } };
        }
      }
    };
  }

  function demoApi() {
    const qs = window.DEMO_QUESTIONS;
    let cur = null, attempts = 0, name = null, session = null;
    const pick = except => {
      let q;
      do { q = qs[Math.floor(Math.random() * qs.length)]; } while (q === except && qs.length > 1);
      return q;
    };
    const view = q => ({ question: q.question, image: q.image, w: q.w, h: q.h });
    return {
      async call(path, body) {
        body = body || {};
        switch (path) {
          case 'me':
            return session ? { status: 200, data: { username: session } } : { status: 401, data: {} };
          case 'register':
            return { status: 200, data: { ok: true } };
          case 'login':
            cur = pick(null); attempts = 0; name = body.username || 'demo';
            return { status: 200, data: { challenge: Object.assign({ id: 'demo' }, view(cur)) } };
          case 'verify':
            if (!cur) return { status: 410, data: { expired: true, error: 'Verification expired. Please log in again.' } };
            if (window.checkAnswer(body.answer, cur.answer)) {
              session = name;
              const explanation = cur.explanation || '';
              cur = null;
              return { status: 200, data: { ok: true, username: name, explanation } };
            }
            attempts++;
            if (attempts >= MAX_ATTEMPTS) {
              cur = null;
              return { status: 403, data: { ok: false, expired: true, error: 'Too many wrong answers. Please log in again.' } };
            }
            cur = pick(cur);
            return { status: 200, data: Object.assign({ ok: false, attemptsLeft: MAX_ATTEMPTS - attempts }, view(cur)) };
          case 'logout':
            session = null;
            return { status: 200, data: { ok: true } };
        }
        return { status: 404, data: {} };
      }
    };
  }

  const api = DEMO ? demoApi() : serverApi();

  // ---- theme ----
  function applyTheme(t, save) {
    document.documentElement.dataset.theme = t;
    if (save) { try { localStorage.setItem('theme', t); } catch (_) {} }
    const label = t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    el.theme.setAttribute('aria-label', label);
    el.theme.title = label;
  }
  el.theme.addEventListener('click', () =>
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true));
  applyTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark', false);

  // ---- login UI ----
  function showView(view) {
    el.auth.hidden = view !== 'auth';
    el.home.hidden = view !== 'home';
    el.title.textContent = view === 'home' ? 'Account' : (mode === 'login' ? 'Log in' : 'Register');
    el.sub.textContent = view === 'home' ? '' : (mode === 'login' ? 'Welcome back.' : 'Create an account to get started.');
    el.sub.hidden = view === 'home';
    document.title = el.title.textContent;
  }

  function setMode(m) {
    mode = m;
    el.submit.textContent = m === 'login' ? 'Log in' : 'Register';
    el.toggle.textContent = m === 'login' ? 'Create an account' : 'I already have an account';
    el.pass.autocomplete = m === 'login' ? 'current-password' : 'new-password';
    el.msg.textContent = '';
    showView('auth');
  }

  function showHome(username, explanation) {
    el.welcome.textContent = 'Welcome, ' + username;
    el.note.textContent = 'Verified.' + (explanation ? ' ' + explanation : '') +
      (DEMO ? ' (Demo only: nothing was authenticated.)' : '');
    el.note.hidden = false;
    showView('home');
  }

  function setQuestion(q) {
    el.qText.hidden = true;
    el.qImg.hidden = false;
    el.qImg.onerror = () => { // fall back to plain text if the image can't load
      el.qImg.hidden = true;
      el.qText.textContent = q.question;
      el.qText.hidden = false;
    };
    el.qImg.alt = q.question;
    if (q.w) el.qImg.width = q.w;
    if (q.h) el.qImg.height = q.h;
    el.qImg.src = q.image;
  }

  function openModal(ch) {
    challengeId = ch.id;
    setQuestion(ch);
    el.answer.value = '';
    el.humanMsg.textContent = '';
    el.main.inert = true; // keeps keyboard focus out of the page behind the modal
    el.modal.hidden = false;
    el.answer.focus();
  }

  function closeModal() {
    el.modal.hidden = true;
    el.main.inert = false;
    challengeId = null;
    el.answer.value = '';
  }

  function backToLogin(message) {
    closeModal();
    setMode('login');
    el.msg.textContent = message || '';
    el.user.focus();
  }

  el.toggle.addEventListener('click', () => {
    setMode(mode === 'login' ? 'register' : 'login');
    el.pass.value = '';
  });

  el.form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    const username = el.user.value.trim();
    const password = el.pass.value;
    if (!DEMO) {
      if (mode === 'register' && !/^[A-Za-z0-9_]{3,20}$/.test(username)) {
        el.msg.textContent = 'Username must be 3-20 letters, numbers or underscores.'; return;
      }
      if (!username || !password) { el.msg.textContent = 'Enter a username and password.'; return; }
      if (mode === 'register' && password.length < 6) {
        el.msg.textContent = 'Password must be at least 6 characters.'; return;
      }
    }
    busy = true; el.submit.disabled = true; el.msg.textContent = '';
    const r = await api.call(mode, { username, password });
    busy = false; el.submit.disabled = false;
    el.pass.value = '';

    if (mode === 'register') {
      if (r.data.ok) {
        setMode('login');
        el.msg.textContent = DEMO ? 'Demo: no account was created. Log in with anything.' : 'Account created. You can log in now.';
      } else {
        el.msg.textContent = r.data.error || 'Request failed.';
      }
      return;
    }
    if (r.data.challenge) openModal(r.data.challenge);
    else el.msg.textContent = r.data.error || 'Request failed.';
  });

  el.humanForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy || !challengeId) return;
    busy = true;
    const r = await api.call('verify', { id: challengeId, answer: el.answer.value });
    busy = false;
    const d = r.data;
    if (d.ok) {
      closeModal();
      showHome(d.username, d.explanation);
    } else if (d.expired || r.status === 410) {
      backToLogin(d.error || 'Verification expired. Please log in again.');
    } else if (d.image || d.question) {
      setQuestion(d);
      el.answer.value = '';
      el.humanMsg.textContent = 'Incorrect. ' + d.attemptsLeft + (d.attemptsLeft === 1 ? ' attempt' : ' attempts') + ' left.';
      el.answer.focus();
    } else {
      el.humanMsg.textContent = d.error || 'Request failed.';
    }
  });

  el.cancel.addEventListener('click', () => backToLogin(''));

  el.logout.addEventListener('click', async () => {
    await api.call('logout');
    setMode('login');
    el.msg.textContent = 'Logged out.';
    el.user.focus();
  });

  // ---- side tools: panels ----
  const panels = {
    calc: { btn: $('tool-calc'), panel: $('panel-calc') },
    draw: { btn: $('tool-draw'), panel: $('panel-draw') }
  };

  function closePanel(key) {
    const p = panels[key];
    p.panel.hidden = true;
    p.btn.setAttribute('aria-expanded', 'false');
  }
  function togglePanel(key) {
    const wasHidden = panels[key].panel.hidden;
    Object.keys(panels).forEach(closePanel);
    if (wasHidden) {
      panels[key].panel.hidden = false;
      panels[key].btn.setAttribute('aria-expanded', 'true');
      panels[key].panel.focus();
    }
  }
  Object.keys(panels).forEach(k => panels[k].btn.addEventListener('click', () => togglePanel(k)));
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => {
    closePanel(b.dataset.close);
    panels[b.dataset.close].btn.focus();
  }));

  // Esc closes a focused tool panel first, otherwise cancels the human check
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const key = Object.keys(panels).find(k => !panels[k].panel.hidden && panels[k].panel.contains(document.activeElement));
    if (key) { closePanel(key); panels[key].btn.focus(); return; }
    if (!el.modal.hidden) backToLogin('');
  });

  // ---- 4-function calculator ----
  const calcDisplay = $('calc-display'), calcExpr = $('calc-expr');
  const SYM = { '+': '+', '-': '\u2212', '*': '\u00d7', '/': '\u00f7' };
  let cur = '0', acc = null, op = null, fresh = true;

  const fmt = n => (isFinite(n) ? String(parseFloat(n.toPrecision(12))) : 'Error');
  const apply = (a, o, b) => (o === '+' ? a + b : o === '-' ? a - b : o === '*' ? a * b : b === 0 ? NaN : a / b);
  function calcRender() {
    calcDisplay.textContent = cur;
    calcExpr.innerHTML = acc !== null ? fmt(acc) + ' ' + SYM[op] : '&nbsp;';
  }
  function calcKey(k) {
    if (cur === 'Error' && k !== 'C') { cur = '0'; acc = null; op = null; fresh = true; }
    if (/^[0-9]$/.test(k)) {
      if (fresh) { cur = k; fresh = false; }
      else if (cur.replace(/[-.]/g, '').length < 14) cur = cur === '0' ? k : cur + k;
    } else if (k === '.') {
      if (fresh) { cur = '0.'; fresh = false; }
      else if (!cur.includes('.')) cur += '.';
    } else if (k === 'C') {
      cur = '0'; acc = null; op = null; fresh = true;
    } else if (k === 'B') {
      if (!fresh) { cur = cur.slice(0, -1); if (cur === '' || cur === '-') cur = '0'; }
    } else if ('+-*/'.includes(k)) {
      if (acc !== null && op && !fresh) { acc = apply(acc, op, parseFloat(cur)); cur = fmt(acc); }
      else acc = parseFloat(cur);
      if (cur === 'Error') { acc = null; op = null; } else op = k;
      fresh = true;
    } else if (k === '=') {
      if (op && acc !== null) {
        cur = fmt(apply(acc, op, parseFloat(cur)));
        acc = null; op = null; fresh = true;
      }
    }
    calcRender();
  }
  $('calc-grid').addEventListener('click', e => {
    const b = e.target.closest('button[data-k]');
    if (b) calcKey(b.dataset.k);
  });
  panels.calc.panel.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    let k = null;
    if (/^[0-9.+\-*/]$/.test(e.key)) k = e.key;
    else if (e.key === 'Enter' || e.key === '=') k = '=';
    else if (e.key === 'Backspace') k = 'B';
    else if (e.key === 'Delete' || e.key === 'c' || e.key === 'C') k = 'C';
    if (k) { e.preventDefault(); calcKey(k); }
  });

  // ---- drawing pad ----
  const pad = $('pad'), ctx = pad.getContext('2d');
  const penBtn = $('pen'), eraserBtn = $('eraser'), sizeInput = $('size');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  let tool = 'pen', drawing = false, last = null;

  function setTool(t) {
    tool = t;
    penBtn.setAttribute('aria-pressed', String(t === 'pen'));
    eraserBtn.setAttribute('aria-pressed', String(t === 'eraser'));
  }
  penBtn.addEventListener('click', () => setTool('pen'));
  eraserBtn.addEventListener('click', () => setTool('eraser'));
  $('clear').addEventListener('click', () => ctx.clearRect(0, 0, pad.width, pad.height));

  // Ink is always black on a transparent canvas; the CSS filter flips it in dark mode.
  function padPos(e) {
    const r = pad.getBoundingClientRect();
    return { x: (e.clientX - r.left) * pad.width / r.width, y: (e.clientY - r.top) * pad.height / r.height, k: pad.width / r.width };
  }
  function stroke(a, b) {
    const w = Number(sizeInput.value) * (tool === 'eraser' ? 4 : 1) * b.k;
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  pad.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    pad.setPointerCapture(e.pointerId);
    drawing = true;
    last = padPos(e);
    stroke(last, last);
  });
  pad.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = padPos(e);
    stroke(last, p);
    last = p;
  });
  ['pointerup', 'pointercancel'].forEach(t => pad.addEventListener(t, () => { drawing = false; }));

  // ---- init ----
  (async () => {
    if (DEMO) el.banner.hidden = false;
    setMode('login');
    const r = await api.call('me');
    if (r.data && r.data.username) showHome(r.data.username, '');
  })();
})();
