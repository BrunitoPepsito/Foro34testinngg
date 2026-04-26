// UbreBot — calls the Groq API with a small system prompt and returns a
// reply. If GROQ_API_KEY is missing, returns a stub reply so the rest of
// the app keeps working. Mentioned via "@UbreBot ..." anywhere in chat.

const SYSTEM_PROMPT = `Eres UbreBot, un asistente conversacional de Foro34, un chat tipo Discord en espa\u00f1ol. Eres c\u00e1lido, juguet\u00f3n y conciso (1-3 oraciones por respuesta a menos que te pidan algo largo). Usas emojis con moderaci\u00f3n. Hablas en espa\u00f1ol latino, t\u00fa o ti seg\u00fan corresponda. No inventes hechos personales sobre el usuario.`;

const MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

async function ask(prompt, context = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  const cleaned = (prompt || '').toString().slice(0, 2000).trim();
  if (!cleaned) return 'Mencioname con una pregunta o algo que quieras decir y te respondo.';

  if (!apiKey) {
    return 'Hola, soy UbreBot. Mi cerebro (Groq) todav\u00eda no est\u00e1 conectado por el admin. Cuando configuren GROQ_API_KEY te responder\u00e9 de verdad. \u2728';
  }

  const userIntro = context.displayName
    ? `Te est\u00e1 hablando ${context.displayName}.`
    : '';

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.8,
        max_tokens: 350,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT + (userIntro ? '\n' + userIntro : '') },
          { role: 'user', content: cleaned },
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
  } catch (err) {
    console.error('groq error', err);
    return 'Se me ca\u00edo el wifi mental \ud83e\udd2f';
  }
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
