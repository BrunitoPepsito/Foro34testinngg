# Foro34 — Chat en tiempo real

Aplicación de chat con dos modos:

- **Sin login**: cualquier visitante entra al chat global como `Anon-1234`.
- **Registrado**: nombre propio, foto de perfil, banner, bio, color personalizado, envío de imágenes y GIFs.

## Stack

- **Backend**: Node.js + Express (compatible con serverless de Vercel).
- **Base de datos**: MongoDB (vía Mongoose, recomendado MongoDB Atlas).
- **Multimedia**: Cloudinary (avatares, banners, imágenes/GIFs en mensajes).
- **Tiempo real**: Pusher Channels (WebSockets gestionados, free tier suficiente para empezar).
- **Frontend**: HTML/CSS/JS vanilla, sin build step.
- **Despliegue**: Vercel (un solo repo, frontend estático + función serverless).

## Estructura

```
api/index.js           → entry point para Vercel serverless (re-exporta el app de Express)
server.js              → server local para desarrollo (node server.js)
src/
  app.js               → factory del Express app (rutas + middlewares)
  lib/
    db.js              → conexión cacheada a MongoDB (apta para serverless)
    cloudinary.js      → wrapper de Cloudinary + upload por buffer
    pusher.js          → singleton del cliente Pusher server-side
    auth.js            → JWT + middlewares authOptional / authRequired
  models/
    User.js            → usuario (username, displayName, avatar, banner, bio, color, …)
    Message.js         → mensaje (texto / imagen, autor denormalizado)
  routes/
    auth.js            → /api/auth/{register,login,logout,me}
    users.js           → /api/users/:username, PATCH /api/users/me, POST /me/avatar, /me/banner
    messages.js        → GET /api/messages, POST /api/messages (multipart con imagen opcional)
    config.js          → GET /api/config (expone Pusher key + cluster al cliente)
public/
  index.html           → SPA shell (chat + login + register + profile)
  css/style.css
  js/app.js            → cliente: routing, auth, chat en vivo, perfil
vercel.json            → routea / → public/index.html, /api/* → api/index.js
.env.example           → variables requeridas
```

## Variables de entorno

Copia `.env.example` a `.env` y completa los valores:

| Variable | Para qué sirve |
| --- | --- |
| `MONGODB_URI` | Conexión a MongoDB Atlas (`mongodb+srv://...`) |
| `JWT_SECRET` | Firma de tokens JWT (cualquier string largo y aleatorio) |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Subir avatares, banners, imágenes/GIFs |
| `PUSHER_APP_ID` / `PUSHER_KEY` / `PUSHER_SECRET` / `PUSHER_CLUSTER` | Mensajería en tiempo real |

Si Pusher no está configurado, el cliente cae automáticamente a polling cada 3 s (todavía funcional).

## Desarrollo local

```bash
npm install
cp .env.example .env  # y completa los valores
npm run dev           # http://localhost:3000
```

Endpoints útiles:

- `GET /api/health` → comprueba qué credenciales están cargadas
- `GET /api/config` → config pública para el cliente

## Despliegue en Vercel

1. Importa el repo en Vercel.
2. En **Project Settings → Environment Variables** define las 8 variables del `.env.example` (con valores reales).
3. No hay build step, Vercel detecta `vercel.json` y publica:
   - `/` → `public/index.html` (estático)
   - `/api/*` → función serverless `api/index.js`

## API

### Auth

- `POST /api/auth/register` — `{username, email, password, displayName}`
- `POST /api/auth/login` — `{identifier, password}` (identifier = username o email)
- `POST /api/auth/logout`
- `GET /api/auth/me` (requiere cookie/JWT)

### Usuarios

- `GET /api/users/:username` — perfil público
- `PATCH /api/users/me` — `{displayName?, bio?, color?}`
- `POST /api/users/me/avatar` — `multipart` con `file`
- `POST /api/users/me/banner` — `multipart` con `file`

### Mensajes

- `GET /api/messages?limit=50&before=ISO&room=global`
- `POST /api/messages` — `multipart` con `text?`, `image?`, `room?` (autenticación opcional, los anónimos quedan como `Anon-XXXX`).
- Pusher canal `room-<room>`, evento `message:new`.

## Notas

- Las funciones serverless reutilizan la conexión de MongoDB cacheándola en `global` para evitar abrir un socket por invocación.
- Los anónimos se identifican por un nombre derivado de su IP (no se guarda la IP cruda); el rate-limit es por IP/usuario.
- Mensajes y autores quedan denormalizados: si un usuario cambia su displayName/avatar más tarde, los mensajes históricos conservan los datos del momento de envío.
