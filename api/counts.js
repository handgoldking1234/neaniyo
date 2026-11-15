// GET /api/counts?ids=a,b,c → 실제 득표 집계
import { handler, send, fail, rpc } from './_lib.js';
export default handler(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(s => s.trim()).filter(s => /^[\w-]{1,40}$/.test(s)).slice(0, 300);
  if (!ids.length) return fail(res, 400, 'ids');
  const counts = await rpc('ny_poll_counts', { ids });
  send(res, 200, { counts: counts || {} }, 'public, s-maxage=15, stale-while-revalidate=60');
});
