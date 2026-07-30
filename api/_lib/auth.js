import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { redis } from './kv.js';

const SESSION_TTL = 60 * 60 * 24 * 365; // 1 año — se renueva en cada uso, así que en la práctica no vence mientras el analista use la suite

export function normalizeUsername(u) {
  return (u || '').trim().toLowerCase();
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = (stored || '').split(':');
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, 'hex');
  const testBuf = scryptSync(password, salt, 64);
  if (hashBuf.length !== testBuf.length) return false;
  return timingSafeEqual(hashBuf, testBuf);
}

export async function createSession(usernameKey) {
  const token = randomBytes(32).toString('hex');
  await redis(['SET', `session:${token}`, usernameKey, 'EX', SESSION_TTL]);
  return token;
}

export async function destroySession(token) {
  if (!token) return;
  await redis(['DEL', `session:${token}`]);
}

function tokenFromReq(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

export async function getSessionUser(req) {
  const token = tokenFromReq(req);
  if (!token) return null;
  const usernameKey = await redis(['GET', `session:${token}`]);
  if (!usernameKey) return null;
  await redis(['EXPIRE', `session:${token}`, SESSION_TTL]);
  return usernameKey;
}

// Devuelve la clave de usuario (normalizada) o ya responde 401 y devuelve null.
export async function requireUser(req, res) {
  const usernameKey = await getSessionUser(req);
  if (!usernameKey) {
    res.status(401).json({ error: 'No autenticado' });
    return null;
  }
  return usernameKey;
}
