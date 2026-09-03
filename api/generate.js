import { requireUser } from './_lib/auth.js';

// Este endpoint corre sobre la API gratuita de Google Gemini (en vez de Anthropic),
// pero mantiene EXACTAMENTE el mismo contrato de entrada/salida que ya esperaba el
// resto de la app (formato Anthropic: entrada { prompt } o { messages, max_tokens },
// salida { content:[{type:'text', text}] }) — así no hace falta tocar index.html.

const SYSTEM = 'Respondés siempre en español. Cuando el usuario pide JSON, respondés ÚNICAMENTE con JSON válido, sin texto antes ni después, sin markdown, sin bloques de código.';
const MODEL = 'gemini-3.6-flash';

// Traduce mensajes estilo Anthropic (role:'user'|'assistant', content: string o
// array de bloques {type:'text'|'image', ...}) al formato de Gemini (contents[]
// con role:'user'|'model' y parts[]).
function toGeminiContents(msgs) {
  return msgs.map(m => {
    const role = m.role === 'assistant' ? 'model' : 'user';
    let parts;
    if (typeof m.content === 'string') {
      parts = [{ text: m.content }];
    } else {
      parts = (m.content || []).map(block => {
        if (block.type === 'image') {
          return { inlineData: { mimeType: block.source.media_type, data: block.source.data } };
        }
        return { text: block.text || '' };
      });
    }
    return { role, parts };
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const usuario = await requireUser(req, res);
  if (!usuario) return;

  const { prompt, messages, max_tokens } = req.body;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key no configurada en el servidor' });

  // Soporta tanto { prompt } como { messages, max_tokens }
  const finalMessages = messages || [{ role: 'user', content: prompt }];
  if (!finalMessages || !finalMessages.length) {
    return res.status(400).json({ error: 'Missing prompt or messages' });
  }

  const body = JSON.stringify({
    contents: toGeminiContents(finalMessages),
    systemInstruction: { parts: [{ text: SYSTEM }] },
    generationConfig: { maxOutputTokens: max_tokens || 4000 }
  });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  // El nivel gratuito de Gemini devuelve "modelo con alta demanda" (429/503) con
  // bastante frecuencia — es transitorio, así que reintentamos un par de veces
  // con espera antes de rendirnos, en vez de que el usuario tenga que reintentar a mano.
  const MAX_INTENTOS = 3;
  try {
    let response, err;
    for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
      response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      if (response.ok) break;
      err = await response.json().catch(() => ({}));
      const reintentable = response.status === 429 || response.status === 503;
      if (!reintentable || intento === MAX_INTENTOS) {
        return res.status(response.status).json({ error: err.error?.message || 'Error de API', _debug: req.body.debug ? err : undefined });
      }
      await new Promise(r => setTimeout(r, 1500 * intento));
    }

    const data = await response.json();
    const candidate = data.candidates && data.candidates[0];
    const text = (candidate?.content?.parts || []).map(p => p.text || '').join('');

    if (!text) {
      // Bloqueo de seguridad, corte por longitud sin contenido, etc.
      const reason = candidate?.finishReason || 'sin respuesta';
      return res.status(200).json({ content: [{ type: 'text', text: '' }], _finishReason: reason, _debug: req.body.debug ? data : undefined });
    }

    // Misma forma que ya esperaba el resto de la app (formato Anthropic).
    return res.status(200).json({ content: [{ type: 'text', text }], _debug: req.body.debug ? data : undefined });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
