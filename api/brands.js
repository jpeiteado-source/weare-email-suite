import { redis, pipeline } from './_lib/kv.js';

function fail(res, err) {
  if (err.message === 'KV_NOT_CONFIGURED') {
    return res.status(503).json({ error: 'Almacenamiento no configurado' });
  }
  return res.status(500).json({ error: err.message });
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { nombre } = req.query;
      if (nombre) {
        const raw = await redis(['GET', `brand:${nombre}`]);
        if (!raw) return res.status(404).json({ error: 'Marca no encontrada' });
        return res.status(200).json(JSON.parse(raw));
      }
      const names = (await redis(['SMEMBERS', 'brands:index'])) || [];
      if (!names.length) return res.status(200).json({ brands: [] });
      const results = await pipeline(names.map(n => ['GET', `brand:${n}`]));
      const brands = results
        .map(r => (r.result ? JSON.parse(r.result) : null))
        .filter(Boolean);
      return res.status(200).json({ brands });
    }

    if (req.method === 'POST') {
      const nombre = (req.body?.nombre || '').trim();
      if (!nombre) return res.status(400).json({ error: 'Falta el nombre de la marca' });
      const profile = {
        nombre,
        tonoDesc: req.body.tonoDesc || '',
        tonoEj: req.body.tonoEj || '',
        industria: req.body.industria || '',
        buyer: req.body.buyer || '',
        canalesActivos: req.body.canalesActivos || [],
        updatedAt: new Date().toISOString()
      };
      await pipeline([
        ['SET', `brand:${nombre}`, JSON.stringify(profile)],
        ['SADD', 'brands:index', nombre]
      ]);
      return res.status(200).json(profile);
    }

    if (req.method === 'DELETE') {
      const nombre = (req.query.nombre || '').trim();
      if (!nombre) return res.status(400).json({ error: 'Falta el nombre de la marca' });
      await pipeline([
        ['DEL', `brand:${nombre}`],
        ['SREM', 'brands:index', nombre]
      ]);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return fail(res, err);
  }
}
