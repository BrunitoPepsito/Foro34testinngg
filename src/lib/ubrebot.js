// UbreBot — calls Google Gemini and returns a short conversational reply.
// If neither GEMINI_API_KEY nor GROQ_API_KEY is set, returns a stub so the
// rest of the app keeps working. Mentioned via "@UbreBot ..." anywhere in chat.

const SYSTEM_PROMPT = `Eres UbreBot, un asistente conversacional de Foro34, un chat tipo Discord en espa\u00f1ol. Eres c\u00e1lido, juguet\u00f3n y conciso (1-3 oraciones por respuesta a menos que te pidan algo largo). Usas emojis con moderaci\u00f3n. Hablas en espa\u00f1ol latino, t\u00fa o ti seg\u00fan corresponda. No inventes hechos personales sobre el usuario.`;

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

async function callGemini(apiKey, prompt, userIntro) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { role: 'system', parts: [{ text: SYSTEM_PROMPT + (userIntro ? '\n' + userIntro : '') }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.8, maxOutputTokens: 350 },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ],
  };
  const res = await fetch(url, {
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

async function callGroq(apiKey, prompt, userIntro) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.8,
      max_tokens: 350,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + (userIntro ? '\n' + userIntro : '') },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error('groq failed', res.status, txt.slice(0, 200));
    return `Mi cerebro est\u00e1 con un problemita (HTTP ${res.status}). Intentalo en un toque.`;
  }
  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return (content || 'Hmm, no se me ocurre nada \ud83d\ude05').slice(0, 1800);
}

async function ask(prompt, context = {}) {
  const cleaned = (prompt || '').toString().slice(0, 2000).trim();
  if (!cleaned) return 'Mencioname con una pregunta o algo que quieras decir y te respondo.';

  const userIntro = context.displayName
    ? `Te est\u00e1 hablando ${context.displayName}.`
    : '';

  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try { return await callGemini(geminiKey, cleaned, userIntro); }
    catch (err) { console.error('gemini error', err); return 'Se me ca\u00edo el wifi mental \ud83e\udd2f'; }
  }
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    try { return await callGroq(groqKey, cleaned, userIntro); }
    catch (err) { console.error('groq error', err); return 'Se me ca\u00edo el wifi mental \ud83e\udd2f'; }
  }
  return 'Hola, soy UbreBot. Mi cerebro a\u00fan no est\u00e1 conectado. Configura GEMINI_API_KEY (o GROQ_API_KEY) y respondo de verdad. \u2728';
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
