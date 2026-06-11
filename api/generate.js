export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, messages, max_tokens } = req.body;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key no configurada en el servidor' });

  // Soporta tanto { prompt } como { messages, max_tokens }
  const finalMessages = messages || [{ role: 'user', content: prompt }];
  if (!finalMessages || !finalMessages.length) {
    return res.status(400).json({ error: 'Missing prompt or messages' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: max_tokens || 4000,
        system: 'Respondés siempre en español. Cuando el usuario pide JSON, respondés ÚNICAMENTE con JSON válido, sin texto antes ni después, sin markdown, sin bloques de código.',
        messages: finalMessages
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || 'Error de API' });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
