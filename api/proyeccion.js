import { redis, pipeline } from './_lib/kv.js';

function fail(res, err) {
  if (err.message === 'KV_NOT_CONFIGURED') {
    return res.status(503).json({ error: 'Almacenamiento no configurado' });
  }
  return res.status(500).json({ error: err.message });
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { nombre, month, months } = req.query;
      if (!nombre) return res.status(400).json({ error: 'Falta el nombre de la marca' });

      if (month) {
        const raw = await redis(['GET', `proyeccion:${nombre}:${month}`]);
        if (!raw) return res.status(404).json({ error: 'Proyección no encontrada' });
        return res.status(200).json(JSON.parse(raw));
      }

      const all = (await redis(['SMEMBERS', `proyeccion:index:${nombre}`])) || [];
      const sorted = all.sort().reverse();

      if (!months) return res.status(200).json({ months: sorted });

      const top = sorted.slice(0, parseInt(months, 10) || 3);
      if (!top.length) return res.status(200).json({ proyecciones: [] });
      const results = await pipeline(top.map(m => ['GET', `proyeccion:${nombre}:${m}`]));
      const proyecciones = results
        .map(r => (r.result ? JSON.parse(r.result) : null))
        .filter(Boolean);
      return res.status(200).json({ proyecciones });
    }

    if (req.method === 'POST') {
      const nombre = (req.body?.nombre || '').trim();
      const month = (req.body?.month || '').trim();
      if (!nombre || !month) return res.status(400).json({ error: 'Falta nombre o mes' });
      const b = req.body.bajada || {};
      const f = req.body.final || {};
      const proyeccion = {
        nombre,
        month,
        bajada: { sesiones: num(b.sesiones), ordenes: num(b.ordenes), facturacion: num(b.facturacion) },
        final: {
          sesiones: num(f.sesiones),
          ordenes: num(f.ordenes),
          facturacion: num(f.facturacion),
          or: num(f.or),
          ctor: num(f.ctor)
        },
        consideraciones: req.body.consideraciones || '',
        updatedAt: new Date().toISOString()
      };
      await pipeline([
        ['SET', `proyeccion:${nombre}:${month}`, JSON.stringify(proyeccion)],
        ['SADD', `proyeccion:index:${nombre}`, month]
      ]);
      return res.status(200).json(proyeccion);
    }

    if (req.method === 'DELETE') {
      const nombre = (req.query.nombre || '').trim();
      const month = (req.query.month || '').trim();
      if (!nombre || !month) return res.status(400).json({ error: 'Falta nombre o mes' });
      await pipeline([
        ['DEL', `proyeccion:${nombre}:${month}`],
        ['SREM', `proyeccion:index:${nombre}`, month]
      ]);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return fail(res, err);
  }
}
