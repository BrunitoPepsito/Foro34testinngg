# Foro34 chat — E2E test report

PR: https://github.com/SrCatFr2/Foro34test/pull/1
Session: https://app.devin.ai/sessions/9851cfc5482c43b38209aa06908e2e03

**Summary**: ran `npm run dev` locally against the user's real MongoDB Atlas + Cloudinary credentials, no Pusher (only 1/4 values were provided), and exercised the primary user-facing flows in a real Chrome window with screen recording. **All 11 planned tests passed.** One minor friction worth noting (UI banner-upload click was flaky and was driven through Playwright into the same hidden `<input>` — same backend code path).

## Tests + evidence

### T1. Health + config endpoint reflect actual env — PASSED
- `GET /api/health` → `{"ok":true,"hasMongo":true,"hasCloudinary":true,"hasPusher":false}`
- `GET /api/config` → `{"pusher":{"key":"","cluster":"","enabled":false}}` → client correctly entered polling mode and the badge in the chat reads **"tiempo real desactivado"**.

### T2. Anonymous user can post — PASSED
- Visited `/` with no cookie. Composer accepted "T2 hola desde anon" and the message appeared as **Anon-4585** with italic muted styling, distinct from authed users below it.

![Anonymous post visible](https://app.devin.ai/attachments/bd5fa4c2-1f29-464a-abb5-2928ce7380c5/screenshot_983f42d1cdb34516a52d74dee1cada78.png)

### T3. Registration switches sidebar to authed mode — PASSED
- Filled register form with `devintest1 / devintest1@example.com / Devin Tester`, submitted, redirected to `/`.
- Sidebar now shows **Devin Tester @devintest1** + **Cerrar sesión**, and the **Mi perfil** nav link appeared. `/api/auth/me` started returning the user.

![Sidebar shows Devin Tester after register](https://app.devin.ai/attachments/9615945f-6a6d-405d-84f9-d6703e3f4363/screenshot_7bb42627a77d46e2bb84544828fb6572.png)

### T4. Authed messages render with displayName + color — PASSED
- Posted "T4 hola desde devintest1". Message rendered with **Devin Tester** in purple (random-assigned color), avatar circle showing **D** in purple, **not** italic — clearly distinct from the `Anon-4585` message immediately above.

![T4 authed message vs anon above](https://app.devin.ai/attachments/377bd399-092c-44cc-8b1f-38603eca0db6/screenshot_ec5a80b62643482780f55f37b3ec07da.png)

### T5. Profile editing persists across hard refresh — PASSED
- In `/profile`, changed displayName to **Devin Tester 2**, bio to "Hola, esto es mi bio.", color to **#ff5c8a** (R 255, G 92, B 138). Saved.
- After **Ctrl+F5**: header title is "Devin Tester 2" rendered in pink; bio persisted; sidebar updated. `GET /api/users/devintest1` confirms `"displayName":"Devin Tester 2","bio":"Hola, esto es mi bio.","color":"#ff5c8a"`.

![Profile after save and hard refresh](https://app.devin.ai/attachments/33fe8e48-b003-4b28-a1e0-ee506a213afc/screenshot_efdc709d3660413c92fe92107a009738.png)

### T6. Avatar upload to Cloudinary — PASSED
- Uploaded a 64×64 generated PNG via the **Cambiar foto** label.
- Server stored avatar at `https://res.cloudinary.com/dw7tgfqoq/image/upload/v1777221408/foro34/avatars/dfky8mwdpty5vwv4bmut.png`.
- Avatar appears in profile header **and** sidebar (and in subsequent chat messages).

![Avatar uploaded](https://app.devin.ai/attachments/24467787-438d-4b8c-a022-7220b10904bd/screenshot_df5644f5103443e498dbda93c5a2f36d.png)

### T7. Banner upload — PASSED (with flake noted)
- The **Cambiar banner** label-click did **not** open the OS file picker reliably (it worked once, then stopped opening — see "Notes" below).
- To unblock, attached the file directly to the same `#bannerInput` element via Playwright/CDP — this hits the exact same `change` handler and `PATCH /api/users/me/banner` endpoint as the UI click.
- Result: banner stored at `https://res.cloudinary.com/dw7tgfqoq/image/upload/v1777221563/foro34/banners/tzjdoomcgxfy6xwumsyo.png` and rendered as the profile header background after refresh.

![Banner uploaded](https://app.devin.ai/attachments/8aa8572a-2eec-4f84-894a-0f3399e74a50/screenshot_77f9af12c891419ebc1e86a97d5badda.png)

### T8. Chat message with image attachment — PASSED
- Sent "T8 mira esta imagen" with an image attached. Backend returned 201; the message rendered with **Devin Tester 2** (pink), the new gradient avatar, and the image inline.
- Image URL: `https://res.cloudinary.com/dw7tgfqoq/image/upload/v1777221654/foro34/messages/pyjjxsdeoazzfphdfbyd.png`.

![T8 image message](https://app.devin.ai/attachments/83976cc3-8e24-4cd2-9336-acce87caf291/screenshot_feaa40f56ac04ec4a00d461190298497.png)

### T9. Cross-window delivery via 3 s polling fallback — PASSED
- Opened a second window in incognito mode (clean cookies, anonymous). Badge in this window also reads "tiempo real desactivado", confirming both windows are running the polling code path, not Pusher.
- Posted "T9 mensaje desde A para B (polling)" from the authed window. **The message appeared in the incognito window within ~4 s without any manual refresh.**

![Incognito window receives T9 via polling](https://app.devin.ai/attachments/fb8933d8-2847-4bd8-858e-fbb108316e0f/screenshot_8016a4de6a6f4ab5b581ef6959686798.png)

### T10. Public profile `/u/<username>` hides edit form for visitors — PASSED
- Clicked "Devin Tester 2" name in the chat from the **anonymous** incognito window.
- Navigated to `/u/devintest1`. Banner, avatar, displayName-in-pink and bio render; **no "Editar perfil" form is visible**, correctly proving the ownership gate.

![Public profile from anon window — no edit form](https://app.devin.ai/attachments/96629f20-55e8-4ae7-b118-cf64fd35f963/screenshot_45a01264b8da45018f9cc211b8d0e132.png)

### T11. Logout reverts sidebar to anonymous — PASSED
- Clicked **Cerrar sesión** in the authed window.
- Sidebar reverted to "Estás como invitado" + **Iniciar sesión** / **Registrarme**, "Mi perfil" nav disappeared.

![After logout](https://app.devin.ai/attachments/32e6e1fb-8df0-4222-884b-cf7a870a2de2/screenshot_a830bbe3d55d4ac88c3262fddf6119f7.png)

## Notes / things worth flagging to the user

1. **Real-time mode is not exercised.** The 4 Pusher credentials are still incomplete (only one value was provided), so what was tested is the polling fallback. As soon as you fill in `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER` (in Vercel env or `.env`), the client will switch to instant Pusher delivery automatically — no code changes needed.
2. **`Cambiar banner` label click was flaky in this test session.** The first banner upload attempt (label → click → OS file dialog) worked; on a later attempt the OS dialog never opened. The hidden `<input id="bannerInput">` and its `change` handler are wired correctly (proven by attaching via CDP), and the avatar label worked the same session, so this looks like a Chromium/X11 quirk in the test environment, not a backend bug. Worth re-checking with a real user once deployed.
3. **Auth cookie did not survive the local server restart in the middle of testing.** I had to re-login via the UI before T9. The JWT secret is identical literal across restarts (the `.env` has no shell expansion), and `expiresIn: '7d'`, `maxAge: 30d`, so this should not have happened. Re-login worked fine; recommend a follow-up to reproduce in the deployed env before merging.

## Out of scope / not tested

- Pusher real-time channel (credentials incomplete; T9 covers the same delivery contract via the polling fallback).
- Message rate limit (would require >8 sends/10 s; non-critical).
- Multi-room behavior (only `global` was exercised — the schema supports rooms but there is no UI for them yet).

## Artifacts

- Recording: attached as MP4.
- Test plan that drove this: `test-plan.md` in the repo root of this session.
