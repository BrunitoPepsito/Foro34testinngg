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

  // Lightweight, intentionally-tiny markdown for bios. We HTML-escape first
  // so user content cannot inject tags, then unescape only the recognised
  // patterns into safe wrappers.
  function renderBioMarkdown(str) {
    if (!str) return '';
    let s = escapeHTML(str);
    // Links: [label](https://...)  http(s) only.
    s = s.replace(/\[([^\]]{1,80})\]\((https?:\/\/[^\s)]{1,200})\)/g,
      (_m, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
    // Bold then italic (greedy-safe-ish for short bios).
    s = s.replace(/\*\*([^*\n]{1,200})\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]{1,200})\*(?!\*)/g, '$1<em>$2</em>');
    // Inline code.
    s = s.replace(/`([^`\n]{1,120})`/g, '<code>$1</code>');
    // Paragraphs from blank lines, single newlines -> <br>.
    const paragraphs = s.split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`);
    return paragraphs.join('');
  }

  const DECORATIONS = ['none', 'neon', 'fire', 'rainbow', 'stars', 'glow', 'gold', 'aurora', 'ice', 'shadow'];
  const EFFECTS = ['none', 'pulse', 'sparkle', 'wave', 'shake'];
  const DECO_LABELS = {
    none: 'Ninguna', neon: 'Neón', fire: 'Fuego', rainbow: 'Arcoíris',
    stars: 'Estrellas', glow: 'Brillo', gold: 'Oro', aurora: 'Aurora',
    ice: 'Hielo', shadow: 'Sombra',
  };
  const EFFECT_LABELS = {
    none: 'Ninguno', pulse: 'Pulso', sparkle: 'Chispas', wave: 'Onda', shake: 'Temblor',
  };
  function decoClass(name) {
    return name && DECORATIONS.includes(name) && name !== 'none' ? `deco-wrap deco-${name}` : '';
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
        // Apply decoration to the dedicated avatar wrapper around the IMG only.
        const wrap = a.closest('.me-avatar-wrap') || a.parentElement;
        if (wrap) {
          DECORATIONS.forEach((d) => wrap.classList.remove(`deco-${d}`));
          wrap.classList.remove('deco-wrap');
          if (state.me.decoration && state.me.decoration !== 'none') {
            wrap.classList.add('deco-wrap', `deco-${state.me.decoration}`);
          }
        }
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
    const dClass = decoClass(a.decoration);
    wrap.innerHTML = `
      <div class="msg-avatar ${dClass}" style="background:${escapeHTML(a.color || '#7c5cff')}">${avatar}</div>
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
        const data = await api('/api/messages', { method: 'POST', body: fd });
        // Render own message immediately. state.seen dedupes when Pusher echoes back.
        if (data && data.message) appendMessage(data.message);
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
    let user;
    try {
      ({ user } = await api(`/api/users/${encodeURIComponent(username)}`));
    } catch (err) {
      container.innerHTML = `<div class="form"><p>Error: ${escapeHTML(err.message)}</p></div>`;
      return;
    }
    const isMe = state.me && state.me.username === user.username;

    const accent = user.color || '#7c5cff';
    const gradFrom = user.gradientFrom || '#7c5cff';
    const gradTo = user.gradientTo || '#ff5c8a';
    const bannerBg = user.bannerColor || '#1b1f27';
    const decoration = user.decoration && DECORATIONS.includes(user.decoration) ? user.decoration : 'none';
    const effect = user.effect && EFFECTS.includes(user.effect) ? user.effect : 'none';

    const styleVars =
      `--accent:${accent};--grad-from:${gradFrom};--grad-to:${gradTo};` +
      `--banner-bg:${bannerBg};` +
      (user.bannerUrl ? `--banner-image:url('${user.bannerUrl.replace(/'/g, "\\'")}');` : '');

    const bannerClass = user.bannerUrl ? 'profile-banner has-image' : 'profile-banner';
    const profileClass = `profile effect-${effect}`;

    const avatarTag = `<img class="profile-avatar" src="${escapeHTML(user.avatarUrl || avatarFallback(user.displayName))}" alt="" />`;
    const avatarFrameClasses = `avatar-frame ${decoration !== 'none' ? `deco-wrap deco-${decoration}` : ''}`;

    const pronounsHtml = user.pronouns
      ? `<span class="pronouns">${escapeHTML(user.pronouns)}</span>` : '';
    const statusHtml = user.status
      ? `<div class="status">${escapeHTML(user.status)}</div>` : '';
    const linksHtml = (user.links || []).filter((l) => l.url).map((l) => {
      const safeUrl = /^https?:\/\//i.test(l.url) ? l.url : `https://${l.url}`;
      return `<a href="${escapeHTML(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(l.label || safeUrl.replace(/^https?:\/\//, ''))}</a>`;
    }).join('');
    const bioHtml = renderBioMarkdown(user.bio || (isMe ? '_Edita tu perfil para añadir una bio._' : 'Sin bio.'));

    container.innerHTML = `
      <div class="${profileClass}" style="${styleVars}">
        <div class="${bannerClass}">
          ${isMe ? `<div class="profile-banner-edit"><label class="btn">📷 Cambiar banner<input type="file" id="bannerInput" accept="image/*,image/gif" hidden /></label></div>` : ''}
        </div>
        <div class="profile-head">
          <div class="${avatarFrameClasses}">${avatarTag}</div>
          <div class="profile-info">
            <h2 style="color:${escapeHTML(accent)}">${escapeHTML(user.displayName)} ${pronounsHtml}</h2>
            <div class="handle">@${escapeHTML(user.username)}</div>
            ${statusHtml}
          </div>
        </div>
        ${isMe ? `<div class="profile-actions">
          <label class="btn btn-primary">📸 Cambiar foto<input type="file" id="avatarInput" accept="image/*,image/gif" hidden /></label>
          <button class="btn" id="copyProfileLink">🔗 Copiar enlace</button>
        </div>` : ''}
        <div class="profile-bio">${bioHtml}</div>
        ${linksHtml ? `<div class="profile-links">${linksHtml}</div>` : ''}
        ${isMe ? renderEditor(user) : ''}
      </div>`;

    if (isMe) wireEditor(user);
  }

  function renderEditor(user) {
    const decoCards = DECORATIONS.map((d) => `
      <label class="${user.decoration === d ? 'checked' : ''}" data-deco="${d}">
        <input type="radio" name="decoration" value="${d}" ${user.decoration === d ? 'checked' : ''} />
        <div class="preview ${d !== 'none' ? `deco-wrap deco-${d}` : ''}"></div>
        <div class="name">${escapeHTML(DECO_LABELS[d])}</div>
      </label>`).join('');
    const effectCards = EFFECTS.map((e) => `
      <label class="${user.effect === e ? 'checked' : ''}" data-effect="${e}">
        <input type="radio" name="effect" value="${e}" ${user.effect === e ? 'checked' : ''} />
        <div class="name">${escapeHTML(EFFECT_LABELS[e])}</div>
      </label>`).join('');

    const links = user.links && user.links.length ? user.links : [{ label: '', url: '' }];
    const linksRows = links.map((l, i) => `
      <div class="link-row" data-i="${i}">
        <input class="link-label" placeholder="Etiqueta" maxlength="30" value="${escapeHTML(l.label || '')}" />
        <input class="link-url" placeholder="https://…" maxlength="200" value="${escapeHTML(l.url || '')}" />
        <button type="button" class="btn btn-ghost link-del" title="Quitar">✕</button>
      </div>`).join('');

    return `
      <div class="profile-section">
        <h3>Editar perfil</h3>
        <form id="profileForm" class="profile-form">
          <div class="field-row">
            <label>Nombre visible<input name="displayName" maxlength="40" value="${escapeHTML(user.displayName)}" /></label>
            <label>Pronombres<input name="pronouns" maxlength="30" placeholder="él / ella / they" value="${escapeHTML(user.pronouns || '')}" /></label>
          </div>
          <label>Estado<input name="status" maxlength="80" placeholder="¿qué estás haciendo?" value="${escapeHTML(user.status || '')}" /></label>
          <label>Bio (admite **negrita**, *cursiva*, [enlace](url) y \`código\`)
            <textarea name="bio" maxlength="500">${escapeHTML(user.bio || '')}</textarea>
          </label>
          <div class="field-row">
            <label>Color de acento<div class="color-row"><input type="color" name="color" value="${escapeHTML(user.color || '#7c5cff')}" /><span class="muted">Tu nombre y enlaces</span></div></label>
            <label>Color del banner (sin imagen)<div class="color-row"><input type="color" name="bannerColor" value="${escapeHTML(user.bannerColor || '#1b1f27')}" /></div></label>
          </div>
          <div class="field-row">
            <label>Gradient inicio<div class="color-row"><input type="color" name="gradientFrom" value="${escapeHTML(user.gradientFrom || '#7c5cff')}" /></div></label>
            <label>Gradient fin<div class="color-row"><input type="color" name="gradientTo" value="${escapeHTML(user.gradientTo || '#ff5c8a')}" /></div></label>
          </div>
          <label>Decoración del avatar
            <div class="deco-grid" id="decoGrid">${decoCards}</div>
          </label>
          <label>Efecto del perfil
            <div class="effect-grid" id="effectGrid">${effectCards}</div>
          </label>
          <label>Enlaces (max 5)
            <div class="links-editor" id="linksEditor">${linksRows}</div>
            <button type="button" class="btn btn-ghost" id="addLink" style="align-self:flex-start;margin-top:6px">+ Añadir enlace</button>
          </label>
          <button class="btn btn-primary" type="submit">Guardar cambios</button>
          <p class="form-error" id="profileError"></p>
        </form>
      </div>`;
  }

  function collectLinks(root) {
    return $$('.link-row', root).map((row) => ({
      label: row.querySelector('.link-label').value.trim(),
      url: row.querySelector('.link-url').value.trim(),
    })).filter((l) => l.url || l.label);
  }

  function wireEditor(user) {
    const form = $('#profileForm');

    // Decoration / effect picker styling.
    function refreshChecked(grid) {
      $$('label', grid).forEach((lbl) => {
        const input = lbl.querySelector('input');
        lbl.classList.toggle('checked', input && input.checked);
      });
    }
    const decoGrid = $('#decoGrid');
    const effGrid = $('#effectGrid');
    [decoGrid, effGrid].forEach((grid) => {
      if (!grid) return;
      grid.addEventListener('change', () => refreshChecked(grid));
    });

    // Live preview while typing.
    const profileEl = $('.profile');
    const bannerEl = profileEl.querySelector('.profile-banner');
    const avatarFrame = profileEl.querySelector('.avatar-frame');
    const nameEl = profileEl.querySelector('.profile-info h2');
    const pronounsEl = profileEl.querySelector('.profile-info .pronouns');
    const statusEl = profileEl.querySelector('.profile-info .status');
    const bioEl = profileEl.querySelector('.profile-bio');

    function applyPreview() {
      const fd = new FormData(form);
      const accent = fd.get('color') || '#7c5cff';
      profileEl.style.setProperty('--accent', accent);
      profileEl.style.setProperty('--grad-from', fd.get('gradientFrom') || '#7c5cff');
      profileEl.style.setProperty('--grad-to', fd.get('gradientTo') || '#ff5c8a');
      profileEl.style.setProperty('--banner-bg', fd.get('bannerColor') || '#1b1f27');
      if (nameEl) {
        nameEl.style.color = accent;
        // Strip current text node, keep pronouns span.
        const dn = fd.get('displayName') || user.displayName;
        const pron = fd.get('pronouns') || '';
        let html = escapeHTML(dn);
        if (pron) html += ` <span class="pronouns">${escapeHTML(pron)}</span>`;
        nameEl.innerHTML = html;
      }
      if (statusEl) {
        const v = fd.get('status') || '';
        statusEl.textContent = v;
        statusEl.style.display = v ? '' : 'none';
      } else if (fd.get('status')) {
        // create one if missing on initial render with no status
        const s = document.createElement('div');
        s.className = 'status';
        s.textContent = fd.get('status');
        profileEl.querySelector('.profile-info').appendChild(s);
      }
      if (bioEl) bioEl.innerHTML = renderBioMarkdown(fd.get('bio') || '');
      // Decoration class on avatar frame.
      if (avatarFrame) {
        DECORATIONS.forEach((d) => avatarFrame.classList.remove(`deco-${d}`));
        avatarFrame.classList.remove('deco-wrap');
        const newDeco = fd.get('decoration') || 'none';
        if (newDeco !== 'none') avatarFrame.classList.add('deco-wrap', `deco-${newDeco}`);
      }
      // Effect on profile container.
      EFFECTS.forEach((e) => profileEl.classList.remove(`effect-${e}`));
      profileEl.classList.add(`effect-${fd.get('effect') || 'none'}`);
      if (bannerEl && !bannerEl.classList.contains('has-image')) {
        // already drives via CSS vars.
      }
    }
    form.addEventListener('input', applyPreview);
    form.addEventListener('change', applyPreview);

    // Links editor.
    const linksEditor = $('#linksEditor');
    $('#addLink').addEventListener('click', () => {
      if ($$('.link-row', linksEditor).length >= 5) return;
      const div = document.createElement('div');
      div.className = 'link-row';
      div.innerHTML = `
        <input class="link-label" placeholder="Etiqueta" maxlength="30" />
        <input class="link-url" placeholder="https://…" maxlength="200" />
        <button type="button" class="btn btn-ghost link-del" title="Quitar">✕</button>`;
      linksEditor.appendChild(div);
    });
    linksEditor.addEventListener('click', (e) => {
      const btn = e.target.closest('.link-del');
      if (!btn) return;
      btn.closest('.link-row').remove();
    });

    // Submit.
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const errorEl = $('#profileError');
      errorEl.textContent = '';
      try {
        const data = await api('/api/users/me', {
          method: 'PATCH',
          body: {
            displayName: fd.get('displayName'),
            pronouns: fd.get('pronouns'),
            status: fd.get('status'),
            bio: fd.get('bio'),
            color: fd.get('color'),
            bannerColor: fd.get('bannerColor'),
            gradientFrom: fd.get('gradientFrom'),
            gradientTo: fd.get('gradientTo'),
            decoration: fd.get('decoration'),
            effect: fd.get('effect'),
            links: collectLinks(linksEditor),
          },
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

    const copyBtn = $('#copyProfileLink');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(`${location.origin}/u/${user.username}`);
          copyBtn.textContent = '✓ Copiado';
          setTimeout(() => { copyBtn.textContent = '🔗 Copiar enlace'; }, 1200);
        } catch (_e) { /* ignore */ }
      });
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
