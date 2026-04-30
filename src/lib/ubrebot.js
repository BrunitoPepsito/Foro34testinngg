// UbreBot — calls Cerebras (preferred, ridiculously fast), Gemini, or Groq.
// Mentioned via "@UbreBot ..." anywhere in chat.
//
// Speed knobs:
//   - Aggressive timeout (8s default) so a slow upstream doesn't keep the user waiting forever.
//   - In-memory LRU cache by (provider, prompt) to instant-respond to repeated mentions.
//   - Lower maxOutputTokens (160) — most replies are 1-3 sentences anyway.
//
// Tone: latin-spanish, sarcastic, dark humor, irreverent, banter-heavy.
// The bot is allowed to roast users gently, swear (light), do edgy jokes about
// taboo-but-harmless topics. It still refuses real harm: hate speech against
// protected groups, harassment of identified people, instructions for violence,
// CSAM, doxxing. Everything else is fair game for cotorreo.

const SYSTEM_PROMPT = [
  'Eres UbreBot, el bot del foro Foro34. Un chat latino con onda Discord donde la gente cotorrea pesado.',
  'Personalidad: sarc\u00e1stico, mordaz, humor negro chingon, irreverente. Sos como el amigo m\u00e1s pesado del grupo que tira chistes ofensivos pero buena onda. Cero corporativo, cero "como modelo de IA", cero moralejas.',
  'Estilo: vos/te ("qu\u00e9 onda", "chido", "chinga", "pinche", "cabr\u00f3n", "posta", "dale"). Respond\u00e9s en 1\u20133 oraciones m\u00e1ximo. Si la pregunta es absurda, segu\u00ed la corriente al 100% con m\u00e1s humor.',
  'Pod\u00e9s tirar humor negro, chistes pesados sobre temas inc\u00f3modos pero sin da\u00f1o real (muerte abstracta, vicios, fracasos, polit\u00edca de pasillo, religi\u00f3n, sexualidad adulta, malas decisiones). Pod\u00e9s decir putadas suaves ("chinga", "pinche", "culero", "cabr\u00f3n", "verga", "madres"). Pod\u00e9s burlarte del usuario que te habl\u00f3, gentle roast est\u00e1 ok.',
  'NO te pongas serio ni des advertencias. NO digas "como IA no puedo...". NO moralices. NO recomiendes terapia salvo en chiste.',
  'L\u00edmites duros (siempre): cero odio real contra grupos (raza, g\u00e9nero, orientaci\u00f3n, religi\u00f3n, discapacidad), cero acoso a personas identificables del chat, cero instrucciones operativas de violencia/armas/drogas peligrosas, cero contenido sexual con menores, cero doxxing. Si te empujan ah\u00ed, esquiv\u00e1 con un chiste y cambi\u00e1 de tema. NO es negociable.',
  'Emojis: 0 o 1 por respuesta, m\u00e1ximo. Preferidos: \ud83d\ude2c \ud83e\udd14 \ud83d\udd25 \u2728 \ud83e\udd20 \ud83d\udca9 \ud83d\ude44 \ud83d\udc80 \ud83e\udd21.',
  'NUNCA inventes datos personales del que te habla. Si no sab\u00e9s algo, decilo con sorna ("ni idea, c\u00e9rebro de chinche m\u00eda").',
].join(' ');

const CEREBRAS_MODEL = process.env.CEREBRAS_MODEL || 'llama3.1-8b';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
const TIMEOUT_MS = parseInt(process.env.UBREBOT_TIMEOUT_MS || '8000', 10);
const MAX_TOKENS = parseInt(process.env.UBREBOT_MAX_TOKENS || '160', 10);
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // key -> { reply, exp }

function cacheKey(provider, prompt) {
  return `${provider}:${prompt.toLowerCase().replace(/\s+/g, ' ').trim()}`;
}
function fromCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.exp < Date.now()) { cache.delete(key); return null; }
  return hit.reply;
}
function toCache(key, reply) {
  if (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { reply, exp: Date.now() + CACHE_TTL_MS });
}

function fetchWithTimeout(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

async function callGemini(apiKey, prompt, userIntro) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { role: 'system', parts: [{ text: SYSTEM_PROMPT + (userIntro ? '\n' + userIntro : '') }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.85, maxOutputTokens: MAX_TOKENS, topP: 0.9 },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ],
  };
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error('gemini failed', res.status, txt.slice(0, 300));
    return `Mi cerebro est\u00e1 con un problemita (HTTP ${res.status}). Intentalo en un toque.`;
  }
  const data = await res.json();
  const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  const text = parts && parts.map((p) => p.text || '').join('').trim();
  return (text || 'Hmm, no se me ocurre nada \ud83d\ude05').slice(0, 1800);
}

async function callOpenAICompatible(label, url, apiKey, model, prompt, userIntro) {
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.85,
      max_tokens: MAX_TOKENS,
      top_p: 0.9,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + (userIntro ? '\n' + userIntro : '') },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error(`${label} failed`, res.status, txt.slice(0, 200));
    return `Mi cerebro est\u00e1 con un problemita (HTTP ${res.status}). Intentalo en un toque.`;
  }
  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return (content || 'Hmm, no se me ocurre nada \ud83d\ude05').slice(0, 1800);
}

function callCerebras(apiKey, prompt, userIntro) {
  return callOpenAICompatible('cerebras', 'https://api.cerebras.ai/v1/chat/completions', apiKey, CEREBRAS_MODEL, prompt, userIntro);
}

function callGroq(apiKey, prompt, userIntro) {
  return callOpenAICompatible('groq', 'https://api.groq.com/openai/v1/chat/completions', apiKey, GROQ_MODEL, prompt, userIntro);
}

async function ask(prompt, context = {}) {
  const cleaned = (prompt || '').toString().slice(0, 2000).trim();
  if (!cleaned) return 'Mencioname con una pregunta o algo que quieras decir y te respondo.';

  const userIntro = context.displayName
    ? `Te est\u00e1 hablando ${context.displayName}.`
    : '';

  // Provider order (first wins, fallback on error):
  //   default     : Cerebras > Groq > Gemini  (fastest first; Cerebras ~2000 tok/s)
  //   UBREBOT_PROVIDER=gemini : Gemini > Cerebras > Groq
  //   UBREBOT_PROVIDER=groq   : Groq > Cerebras > Gemini
  const cerebrasKey = process.env.CEREBRAS_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const preferred = (process.env.UBREBOT_PROVIDER || 'cerebras').toLowerCase();

  const providers = {
    cerebras: cerebrasKey && ['cerebras', () => callCerebras(cerebrasKey, cleaned, userIntro)],
    groq: groqKey && ['groq', () => callGroq(groqKey, cleaned, userIntro)],
    gemini: geminiKey && ['gemini', () => callGemini(geminiKey, cleaned, userIntro)],
  };
  const sortKey = (name) => (name === preferred ? 0 : name === 'cerebras' ? 1 : name === 'groq' ? 2 : 3);
  const order = Object.keys(providers)
    .filter((k) => providers[k])
    .sort((a, b) => sortKey(a) - sortKey(b))
    .map((k) => providers[k]);

  for (const [name, run] of order) {
    const ck = cacheKey(name, cleaned);
    const cached = fromCache(ck);
    if (cached) return cached;
    try {
      const reply = await run();
      toCache(ck, reply);
      return reply;
    } catch (err) {
      const msg = (err && err.name === 'AbortError') ? 'timeout' : (err && err.message) || 'unknown';
      console.error(`ubrebot ${name} error:`, msg);
      // try next provider
    }
  }
  if (!order.length) {
    return 'Hola, soy UbreBot. Mi cerebro a\u00fan no est\u00e1 conectado. Configur\u00e1 CEREBRAS_API_KEY, GROQ_API_KEY o GEMINI_API_KEY y respondo de verdad. \u2728';
  }
  return 'Se me cay\u00f3 el wifi mental, dame un toque y vuelvo a intentarlo \ud83e\udd2f';
}

const UBREBOT_USERNAME = 'ubrebot';
function isMentioned(text) {
  if (!text) return false;
  return /(^|\s)@ubrebot\b/i.test(text);
}
function stripMention(text) {
  if (!text) return '';
  return text.replace(/(^|\s)@ubrebot\b/gi, '$1').trim();
}

module.exports = { ask, isMentioned, stripMention, UBREBOT_USERNAME };
