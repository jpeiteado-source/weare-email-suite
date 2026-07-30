import { redis, pipeline } from './_lib/kv.js';
import { normalizeUsername, hashPassword, verifyPassword, createSession, destroySession, getSessionUser } from './_lib/auth.js';

function fail(res, err) {
  if (err.message === 'KV_NOT_CONFIGURED') {
    return res.status(503).json({ error: 'Almacenamiento no configurado' });
  }
  return res.status(500).json({ error: err.message });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const action = req.body?.action;

      if (action === 'logout') {
        const auth = req.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
        await destroySession(token);
        return res.status(200).json({ ok: true });
      }

      const usernameRaw = (req.body?.username || '').trim();
      const password = req.body?.password || '';
      const key = normalizeUsername(usernameRaw);

      if (action === 'register') {
        if (!usernameRaw || !password) return res.status(400).json({ error: 'Falta usuario o contraseña' });
        if (password.length < 4) return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
        const exists = await redis(['GET', `user:${key}`]);
        if (exists) return res.status(409).json({ error: 'Ese usuario ya existe' });
        const user = { username: usernameRaw, passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
        await pipeline([
          ['SET', `user:${key}`, JSON.stringify(user)],
          ['SADD', 'users:index', key]
        ]);
        const token = await createSession(key);
        return res.status(200).json({ token, username: usernameRaw });
      }

      if (action === 'login') {
        if (!usernameRaw || !password) return res.status(400).json({ error: 'Falta usuario o contraseña' });
        const raw = await redis(['GET', `user:${key}`]);
        if (!raw) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
        const user = JSON.parse(raw);
        if (!verifyPassword(password, user.passwordHash)) return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
        const token = await createSession(key);
        return res.status(200).json({ token, username: user.username });
      }

      return res.status(400).json({ error: 'Acción inválida' });
    }

    if (req.method === 'GET') {
      const usernameKey = await getSessionUser(req);
      if (!usernameKey) return res.status(401).json({ error: 'No autenticado' });
      const raw = await redis(['GET', `user:${usernameKey}`]);
      const display = raw ? JSON.parse(raw).username : usernameKey;
      return res.status(200).json({ username: display });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return fail(res, err);
  }
}
