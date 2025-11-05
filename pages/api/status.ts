import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const host = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : `http://${req.headers.host}`;
  const r = await fetch(`${host}/services.json`, { cache: 'no-store' });
  if (!r.ok) {
    res.status(500).json({ error: 'Failed to load services.json' });
    return;
  }
  const json = await r.json();
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.status(200).json(json);
}
