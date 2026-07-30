import { redis, pipeline } from './_lib/kv.js';
import { requireUser } from './_lib/auth.js';

function fail(res, err) {
  if (err.message === 'KV_NOT_CONFIGURED') {
    return res.status(503).json({ error: 'Almacenamiento no configurado' });
  }
  return res.status(500).json({ error: err.message });
}

export default async function handler(req, res) {
  try {
    const usuario = await requireUser(req, res);
    if (!usuario) return;

    if (req.method === 'GET') {
      const { nombre, month, months } = req.query;
      if (!nombre) return res.status(400).json({ error: 'Falta el nombre de la marca' });

      if (month) {
        const raw = await redis(['GET', `plan:${usuario}:${nombre}:${month}`]);
        if (!raw) return res.status(404).json({ error: 'Plan no encontrado' });
        return res.status(200).json(JSON.parse(raw));
      }

      const all = (await redis(['SMEMBERS', `plans:index:${usuario}:${nombre}`])) || [];
      const sorted = all.sort().reverse();

      if (!months) return res.status(200).json({ months: sorted });

      const top = sorted.slice(0, parseInt(months, 10) || 3);
      if (!top.length) return res.status(200).json({ plans: [] });
      const results = await pipeline(top.map(m => ['GET', `plan:${usuario}:${nombre}:${m}`]));
      const plans = results
        .map(r => (r.result ? JSON.parse(r.result) : null))
        .filter(Boolean);
      return res.status(200).json({ plans });
    }

    if (req.method === 'POST') {
      const nombre = (req.body?.nombre || '').trim();
      const month = (req.body?.month || '').trim();
      if (!nombre || !month) return res.status(400).json({ error: 'Falta nombre o mes' });
      const plan = {
        nombre,
        month,
        notas: req.body.notas || '',
        canales: req.body.canales || [],
        accionesCat: req.body.accionesCat || {},
        filas: req.body.filas || [],
        analisis: req.body.analisis || '',
        updatedAt: new Date().toISOString()
      };
      await pipeline([
        ['SET', `plan:${usuario}:${nombre}:${month}`, JSON.stringify(plan)],
        ['SADD', `plans:index:${usuario}:${nombre}`, month]
      ]);
      return res.status(200).json(plan);
    }

    if (req.method === 'DELETE') {
      const nombre = (req.query.nombre || '').trim();
      const month = (req.query.month || '').trim();
      if (!nombre || !month) return res.status(400).json({ error: 'Falta nombre o mes' });
      await pipeline([
        ['DEL', `plan:${usuario}:${nombre}:${month}`],
        ['SREM', `plans:index:${usuario}:${nombre}`, month]
      ]);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return fail(res, err);
  }
}
