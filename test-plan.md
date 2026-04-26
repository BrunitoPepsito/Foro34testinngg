# Test plan — PR #1: Foro34 chat app

## What changed (user-visible)
The previously-empty repo now contains a complete chat web app:
- Visitors without an account can post in a global chat as `Anon-XXXX`.
- Visitors with an account get a custom display name + color, can change profile picture and banner (Cloudinary), edit bio, send images/GIFs in chat, and have a public profile at `/u/<username>`.
- Messages are delivered live to other open windows via Pusher; if Pusher is not configured the client falls back to polling every 3 s.

## Environment used
- Local: `npm run dev` against `http://localhost:3000` with the user's real MongoDB Atlas + Cloudinary credentials.
- Pusher is **not** configured (only 1 of 4 values provided), so the test exercises the **polling fallback path**, which is the path that will actually run on Vercel until the user fills in the 4 Pusher env vars.

## Tests (primary E2E flow)

Each step lists a concrete pass/fail check. "Window A" = primary (Chrome window, will register). "Window B" = incognito (will stay anonymous). Both share the same MongoDB so they should see each other's messages within ≈3 s via polling.

### T1. Health + config endpoint reflect actual env
- **Steps**: GET `/api/health` and `/api/config`.
- **Pass**: `{ ok: true, hasMongo: true, hasCloudinary: true, hasPusher: false }` and `config.pusher.enabled === false`.
- **Why adversarial**: if env loading were broken, hasMongo/hasCloudinary would be false and chat features would fail later; if pusher detection were wrong, the badge would say "en vivo" when it shouldn't.

### T2. Anonymous user can post
- **Steps**: open `/` in Window A (no account yet), type `hola desde anon` in the composer, press Enter.
- **Pass**: a message appears in the list with author label starting with `Anon-` and italic muted color (anonymous styling). Server returns 201.
- **Fail signal**: status 401 (would mean auth was incorrectly required) or no rendering.

### T3. Registration creates account and switches sidebar to "auth" mode
- **Steps**: click **Registrarme** → fill `displayName=Devin Tester`, `username=devintest1`, `email=devintest1@example.com`, `password=secret123` → submit.
- **Pass**:
  - Redirected to `/`.
  - Sidebar shows the new user's display name "Devin Tester" and `@devintest1` instead of "Estás como invitado".
  - "Mi perfil" nav button becomes visible.
  - `POST /api/auth/register` returned 200 with `user.username === "devintest1"`.
- **Fail signal**: any error on the form OR sidebar still showing "Iniciar sesión" / "Registrarme" buttons after submit.

### T4. Authenticated user can post and message renders with their styling
- **Steps**: in Window A, post `hola desde devintest1`.
- **Pass**: message bubble shows displayName "Devin Tester" colored with the user's color (random palette), is **not** italic/muted, and clicking the name navigates to `/u/devintest1`.
- **Fail signal**: still rendered as `Anon-XXXX` (would mean cookie/JWT not being read).

### T5. Profile editing (color + bio + displayName) persists
- **Steps**: navigate to `/profile`. In the form set color to `#ff5c8a`, displayName to `Devin Tester 2`, bio to `Hola, esto es mi bio.`. Click **Guardar**. Hard-refresh.
- **Pass after refresh**:
  - Profile header shows displayName "Devin Tester 2" rendered in `#ff5c8a`.
  - Bio shows the new text.
  - `GET /api/users/devintest1` returns the same updated values.
- **Fail signal**: values revert after refresh (would mean PATCH not persisted).

### T6. Avatar upload to Cloudinary
- **Steps**: in `/profile` click **Cambiar foto**, choose a small PNG (`/tmp/p.png` created by node).
- **Pass**:
  - Avatar circle in profile + sidebar updates to a `https://res.cloudinary.com/dw7tgfqoq/...` URL within ~3 s.
  - Hard-refresh keeps the new avatar.
- **Fail signal**: 500 or no change.

### T7. Banner upload
- **Steps**: click **Cambiar banner**, pick another image.
- **Pass**: profile banner background switches to the uploaded image (Cloudinary URL).
- **Fail signal**: banner stays solid gradient.

### T8. Image message in chat
- **Steps**: back to `/`. Click 📎, select `/tmp/p.png`, type `mira esta imagen`, send.
- **Pass**: a message appears with both the text and a thumbnail image; the image src is a `res.cloudinary.com/.../foro34/messages/...` URL.
- **Fail signal**: text appears without image, or status ≠ 201.

### T9. Cross-window delivery via polling (no Pusher)
- **Steps**: Window B (incognito) opens `/`. Loads existing messages. Then in Window A post `mensaje desde A`. Wait up to 5 s in Window B without manually refreshing.
- **Pass**: within 3-5 s the new message appears in Window B's chat list.
- **Fail signal**: requires manual refresh to appear (would indicate polling fallback not running). The badge in Window B should say "tiempo real desactivado" (since Pusher is disabled), confirming we are exercising the polling code path, not Pusher.

### T10. Public profile via `/u/<username>`
- **Steps**: in Window B click on "Devin Tester 2" name in the chat (after T9 message arrives).
- **Pass**: navigates to `/u/devintest1` and shows the same banner, avatar, bio, color, **without** any "Editar perfil" form (because Window B is anonymous, not the owner).
- **Fail signal**: edit form visible (would mean ownership check is broken).

### T11. Logout returns sidebar to anonymous state
- **Steps**: in Window A click **Cerrar sesión**.
- **Pass**: sidebar shows "Iniciar sesión" / "Registrarme" again. `GET /api/auth/me` now returns 401.

## Out of scope / explicitly not tested
- Pusher real-time event delivery (credentials incomplete; covered by T9 polling path).
- Rate limits (would require >8 messages/10 s; non-critical).
- Multi-room behavior (default room only).

## Known-acceptable observations
- Both browser windows share `127.0.0.1`, so anonymous names will be deterministic for both. T9 uses one authed and one anon window to avoid the dup-name confusion.
- The `bootstrap` branch with just README serves as PR base because the repo started empty.

## Code references that grounded this plan
- `src/routes/messages.js:79-117` — `authOptional` + anon name from IP hash + Cloudinary upload.
- `src/routes/auth.js:32-71` — register/login + cookie + JWT.
- `src/routes/users.js:43-86` — profile patch + avatar/banner upload.
- `public/js/app.js:99-150` — chat rendering, anon vs auth styling, name→profile navigation.
- `public/js/app.js:159-186` — `setupRealtime` polling fallback when `config.pusher.enabled === false`.
- `public/js/app.js:285-321` — profile editing form + media upload binding.
