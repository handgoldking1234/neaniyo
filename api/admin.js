// 관리자 전용 (profiles.is_admin = true 인 계정)
// GET  /api/admin                     → 승인 대기 투표, 검토 대기·신고 한줄평
// POST /api/admin {act, id, reason}   → approve | reject (투표), show | hide | delete (한줄평)
import { handler, send, fail, db, authUser, body } from './_lib.js';
export default handler(async (req, res) => {
  const user = await authUser(req); if (!user) return fail(res, 401, 'login');
  const me = await db(`ny_profiles?select=is_admin&id=eq.${user.id}`);
  if (!me[0]?.is_admin) return fail(res, 403, 'admin-only');
  if (req.method === 'GET') {
    const [polls, review, reported] = await Promise.all([
      db('ny_user_polls?select=*&status=eq.pending&order=created_at.asc&limit=200'),
      db('ny_comments?select=*&status=eq.review&order=created_at.asc&limit=200'),
      db('ny_comments?select=*&reports=gt.0&order=reports.desc&limit=200')
    ]);
    return send(res, 200, { polls, review, reported });
  }
  if (req.method !== 'POST') return fail(res, 405, 'method');
  const b = body(req), id = String(b.id || '');
  const now = new Date().toISOString();
  switch (b.act) {
    case 'approve': await db(`ny_user_polls?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: 'approved', reject_reason: null, updated_at: now } }); break;
    case 'reject': await db(`ny_user_polls?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: 'rejected', reject_reason: String(b.reason || '').slice(0, 200) || null, updated_at: now } }); break;
    case 'show': await db(`ny_comments?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: 'visible' } }); break;
    case 'hide': await db(`ny_comments?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: 'hidden' } }); break;
    case 'delete': await db(`ny_comments?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }); break;
    default: return fail(res, 400, 'act');
  }
  send(res, 200, { ok: true });
});
