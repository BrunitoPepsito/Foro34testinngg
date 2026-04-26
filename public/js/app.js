/* global Pusher */

(() => {
  const state = {
    me: null,
    config: null,
    pusher: null,
    channel: null,
    pendingFile: null,
    room: 'global',
    seen: new Set(),
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function escapeHTML(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
  }

  async function api(path, options = {}) {
    const opts = { credentials: 'include', ...options };
    if (opts.body && !(opts.body instanceof FormData) && typeof opts.body === 'object') {
      opts.headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
      opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (_e) { /* ignore */ }
    if (!res.ok) {
      const msg = (data && data.error) || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ----- Routing -----
  function go(path, replace = false) {
    if (replace) history.replaceState({}, '', path);
    else history.pushState({}, '', path);
    render();
  }

  function currentRoute() {
    const p = location.pathname;
    if (p === '/' || p === '') return '/';
    if (p === '/login') return '/login';
    if (p === '/register') return '/register';
    if (p === '/profile') return '/profile';
    if (p.startsWith('/u/')) return '/profile';
    return '/';
  }

  function render() {
    const route = currentRoute();
    $$('.view').forEach((v) => v.classList.add('hidden'));
    const target = $(`[data-view="${route}"]`);
    if (target) target.classList.remove('hidden');
    $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.route === route));

    if (route === '/') initChatView();
    if (route === '/profile') renderProfileView();
  }

  // ----- Auth UI -----
  function applyAuthUI() {
    const isAuth = Boolean(state.me);
    $$('[data-show-when="anon"]').forEach((el) => el.classList.toggle('hidden', isAuth));
    $$('[data-show-when="auth"]').forEach((el) => el.classList.toggle('hidden', !isAuth));
    $$('.js-only-auth').forEach((el) => el.classList.toggle('hidden', !isAuth));
    if (isAuth) {
      const a = $('.me-avatar');
      if (a) {
        a.src = state.me.avatarUrl || avatarFallback(state.me.displayName);
        a.onerror = () => { a.src = avatarFallback(state.me.displayName); };
      }
      $$('[data-bind="me.displayName"]').forEach((e) => (e.textContent = state.me.displayName));
      $$('[data-bind="me.username"]').forEach((e) => (e.textContent = state.me.username));
    }
  }

  function avatarFallback(name) {
    const letter = encodeURIComponent((name || '?').charAt(0).toUpperCase());
    return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' fill='%237c5cff'/%3E%3Ctext x='50%25' y='52%25' text-anchor='middle' font-size='32' font-family='sans-serif' fill='white' dominant-baseline='middle'%3E${letter}%3C/text%3E%3C/svg%3E`;
  }

  // ----- Chat -----
  function initChatView() {
    if (initChatView.done) return;
    initChatView.done = true;
    loadMessages();
    setupRealtime();
  }

  async function loadMessages() {
    try {
      const data = await api('/api/messages?limit=50');
      const list = $('#messages');
      list.innerHTML = '';
      state.seen.clear();
      data.messages.forEach((m) => appendMessage(m, false));
      scrollToBottom();
    } catch (err) {
      console.error('load messages', err);
      const list = $('#messages');
      list.innerHTML = `<div class="muted">Error cargando mensajes: ${escapeHTML(err.message)}</div>`;
    }
  }

  function appendMessage(m, animate = true) {
    if (state.seen.has(m.id)) return;
    state.seen.add(m.id);
    const list = $('#messages');
    const wrap = document.createElement('div');
    wrap.className = 'msg';
    const a = m.author || {};
    const avatar = a.avatarUrl
      ? `<img src="${escapeHTML(a.avatarUrl)}" alt="" />`
      : escapeHTML((a.displayName || '?').charAt(0).toUpperCase());
    const nameClass = a.anonymous ? 'msg-name anon' : 'msg-name clickable';
    const nameAttrs = a.anonymous ? '' : `data-username="${escapeHTML(a.username || '')}"`;
    const imageHtml = m.imageUrl
      ? `<img class="msg-image" src="${escapeHTML(m.imageUrl)}" alt="image" />`
      : '';
    wrap.innerHTML = `
      <div class="msg-avatar" style="background:${escapeHTML(a.color || '#7c5cff')}">${avatar}</div>
      <div class="msg-body">
        <div class="msg-head">
          <span class="${nameClass}" ${nameAttrs} style="color:${escapeHTML(a.color || '#fff')}">${escapeHTML(a.displayName || 'Anon')}</span>
          <span class="msg-time">${fmtTime(m.createdAt)}</span>
        </div>
        ${m.text ? `<div class="msg-text">${escapeHTML(m.text)}</div>` : ''}
        ${imageHtml}
      </div>`;
    if (!a.anonymous && a.username) {
      wrap.querySelector('.msg-name').addEventListener('click', () => go(`/u/${a.username}`));
    }
    if (m.imageUrl) {
      wrap.querySelector('.msg-image').addEventListener('click', () => window.open(m.imageUrl, '_blank'));
    }
    if (animate) wrap.style.animation = 'fadeIn .15s ease';
    list.appendChild(wrap);
    scrollToBottom();
  }

  function scrollToBottom() {
    const list = $('#messages');
    list.scrollTop = list.scrollHeight;
  }

  async function setupRealtime() {
    const badge = $('#rtBadge');
    if (!state.config || !state.config.pusher || !state.config.pusher.enabled) {
      badge.textContent = 'tiempo real desactivado';
      badge.className = 'badge error';
      // Fallback: poll every 3s
      setInterval(loadMessages, 3000);
      return;
    }
    try {
      const p = new Pusher(state.config.pusher.key, { cluster: state.config.pusher.cluster, forceTLS: true });
      state.pusher = p;
      const channel = p.subscribe(`room-${state.room}`);
      state.channel = channel;
      p.connection.bind('connected', () => { badge.textContent = 'en vivo'; badge.className = 'badge connected'; });
      p.connection.bind('error', () => { badge.textContent = 'sin conexión'; badge.className = 'badge error'; });
      p.connection.bind('disconnected', () => { badge.textContent = 'desconectado'; badge.className = 'badge error'; });
      channel.bind('message:new', (msg) => appendMessage(msg));
    } catch (err) {
      console.error('pusher init', err);
      badge.textContent = 'sin tiempo real';
      badge.className = 'badge error';
      setInterval(loadMessages, 3000);
    }
  }

  function setupComposer() {
    const form = $('#composer');
    const text = $('#textInput');
    const fileInput = $('#imageInput');
    const previewBar = $('#previewBar');
    const previewImg = $('#previewImg');

    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0];
      if (!f) return;
      state.pendingFile = f;
      previewImg.src = URL.createObjectURL(f);
      previewBar.classList.remove('hidden');
    });

    $('#clearPreview').addEventListener('click', () => {
      state.pendingFile = null;
      fileInput.value = '';
      previewBar.classList.add('hidden');
    });

    // Paste images directly
    text.addEventListener('paste', (e) => {
      const items = (e.clipboardData || {}).items || [];
      for (const it of items) {
        if (it.kind === 'file') {
          const f = it.getAsFile();
          if (f) {
            state.pendingFile = f;
            previewImg.src = URL.createObjectURL(f);
            previewBar.classList.remove('hidden');
          }
        }
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const value = text.value.trim();
      if (!value && !state.pendingFile) return;
      const fd = new FormData();
      if (value) fd.append('text', value);
      if (state.pendingFile) fd.append('image', state.pendingFile);
      fd.append('room', state.room);
      try {
        text.value = '';
        const file = state.pendingFile;
        state.pendingFile = null;
        fileInput.value = '';
        previewBar.classList.add('hidden');
        await api('/api/messages', { method: 'POST', body: fd });
        // optimistic display: actual message will arrive via Pusher
        if (!state.pusher && file) {
          // file not echoed locally for simplicity
        }
      } catch (err) {
        console.error('send', err);
        alert('No se pudo enviar: ' + err.message);
      }
    });
  }

  // ----- Login / Register -----
  function setupAuthForms() {
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errorEl = $('#loginError');
      errorEl.textContent = '';
      try {
        const data = await api('/api/auth/login', {
          method: 'POST',
          body: { identifier: fd.get('identifier'), password: fd.get('password') },
        });
        state.me = data.user;
        applyAuthUI();
        go('/');
      } catch (err) {
        errorEl.textContent = err.message;
      }
    });

    $('#registerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errorEl = $('#registerError');
      errorEl.textContent = '';
      try {
        const data = await api('/api/auth/register', {
          method: 'POST',
          body: {
            displayName: fd.get('displayName'),
            username: fd.get('username'),
            email: fd.get('email'),
            password: fd.get('password'),
          },
        });
        state.me = data.user;
        applyAuthUI();
        go('/');
      } catch (err) {
        errorEl.textContent = err.message;
      }
    });

    $('#logoutBtn').addEventListener('click', async () => {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch (_e) { /* ignore */ }
      state.me = null;
      applyAuthUI();
      go('/');
    });
  }

  // ----- Profile -----
  async function renderProfileView() {
    const container = $('#profileContainer');
    const path = location.pathname;
    let username = null;
    if (path.startsWith('/u/')) {
      username = path.slice(3);
    } else if (state.me) {
      username = state.me.username;
    }
    if (!username) {
      container.innerHTML = '<div class="form"><p>Inicia sesión para ver tu perfil.</p></div>';
      return;
    }

    container.innerHTML = '<div class="profile"><p class="muted" style="padding:24px">Cargando…</p></div>';
    try {
      const { user } = await api(`/api/users/${encodeURIComponent(username)}`);
      const isMe = state.me && state.me.username === user.username;
      const banner = user.bannerUrl
        ? `style="background-image:url('${escapeHTML(user.bannerUrl)}')"`
        : '';
      const avatar = user.avatarUrl
        ? `<img class="profile-avatar" src="${escapeHTML(user.avatarUrl)}" alt="" />`
        : `<img class="profile-avatar" src="${avatarFallback(user.displayName)}" alt="" />`;

      container.innerHTML = `
        <div class="profile">
          <div class="profile-banner" ${banner}>
            ${isMe ? `<div class="profile-banner-edit"><label class="btn">Cambiar banner<input type="file" id="bannerInput" accept="image/*" hidden /></label></div>` : ''}
          </div>
          <div class="profile-head">
            ${avatar}
            <div class="profile-info">
              <h2 style="color:${escapeHTML(user.color || '#fff')}">${escapeHTML(user.displayName)}</h2>
              <div class="muted">@${escapeHTML(user.username)}</div>
            </div>
            ${isMe ? `<div class="profile-actions"><label class="btn">Cambiar foto<input type="file" id="avatarInput" accept="image/*" hidden /></label></div>` : ''}
          </div>
          <div class="profile-bio">${escapeHTML(user.bio || (isMe ? 'Edita tu perfil debajo para añadir una bio.' : 'Sin bio.'))}</div>
          ${isMe ? `
          <div class="profile-section">
            <h3>Editar perfil</h3>
            <form id="profileForm" class="profile-form">
              <label>Nombre visible<input name="displayName" maxlength="40" value="${escapeHTML(user.displayName)}" /></label>
              <label>Bio<textarea name="bio" maxlength="280">${escapeHTML(user.bio || '')}</textarea></label>
              <label>Color del nombre<div class="color-row"><input type="color" name="color" value="${escapeHTML(user.color || '#7c5cff')}" /><span class="muted">Aparece en tus mensajes</span></div></label>
              <button class="btn btn-primary" type="submit">Guardar</button>
              <p class="form-error" id="profileError"></p>
            </form>
          </div>` : ''}
        </div>`;

      if (isMe) {
        $('#profileForm').addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const errorEl = $('#profileError');
          errorEl.textContent = '';
          try {
            const data = await api('/api/users/me', {
              method: 'PATCH',
              body: { displayName: fd.get('displayName'), bio: fd.get('bio'), color: fd.get('color') },
            });
            state.me = data.user;
            applyAuthUI();
            renderProfileView();
          } catch (err) {
            errorEl.textContent = err.message;
          }
        });
        $('#avatarInput').addEventListener('change', (e) => uploadProfileMedia(e.target, 'avatar'));
        $('#bannerInput').addEventListener('change', (e) => uploadProfileMedia(e.target, 'banner'));
      }
    } catch (err) {
      container.innerHTML = `<div class="form"><p>Error: ${escapeHTML(err.message)}</p></div>`;
    }
  }

  async function uploadProfileMedia(input, kind) {
    const f = input.files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    try {
      const data = await api(`/api/users/me/${kind}`, { method: 'POST', body: fd });
      state.me = data.user;
      applyAuthUI();
      renderProfileView();
    } catch (err) {
      alert('Upload failed: ' + err.message);
    }
  }

  // ----- Wire up nav -----
  function setupNav() {
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-route]');
      if (!t) return;
      e.preventDefault();
      go(t.dataset.route);
    });
    window.addEventListener('popstate', render);
  }

  // ----- Boot -----
  async function boot() {
    setupNav();
    setupComposer();
    setupAuthForms();

    try {
      state.config = await api('/api/config');
    } catch (err) {
      console.warn('config load failed', err);
      state.config = { pusher: { enabled: false } };
    }

    try {
      const data = await api('/api/auth/me');
      state.me = data.user;
    } catch (_e) { /* not logged in */ }

    applyAuthUI();
    render();
  }

  boot();
})();
