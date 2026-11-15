// POST /api/comment-action {id, act: like|unlike|report, reason}
import { handler, send, fail, db, rpc, authUser, body, mailAdmin, SITE } from './_lib.js';
export default handler(async (req, res) => {
  if (req.method !== 'POST') return fail(res, 405, 'method');
  const user = await authUser(req);
  if (!user) return fail(res, 401, 'login');
  const b = body(req), id = String(b.id || ''), act = b.act;
  if (!/^[0-9a-f-]{36}$/.test(id)) return fail(res, 400, 'id');
  let out;
  if (act === 'like' || act === 'unlike') {
    if (act === 'like') {
      const r = await db('ny_comment_likes', { method: 'POST', body: { comment_id: id, user_id: user.id }, prefer: 'resolution=ignore-duplicates,return=representation' });
      out = r.length ? await rpc('ny_bump_comment', { cid: id, d_likes: 1, d_reports: 0 }) : null;
    } else {
      const r = await db(`ny_comment_likes?comment_id=eq.${id}&user_id=eq.${user.id}`, { method: 'DELETE', prefer: 'return=representation' });
      out = r.length ? await rpc('ny_bump_comment', { cid: id, d_likes: -1, d_reports: 0 }) : null;
    }
  } else if (act === 'report') {
    const r = await db('ny_reports', { method: 'POST', body: { comment_id: id, reporter: user.id, reason: String(b.reason || '').slice(0, 200) || null }, prefer: 'resolution=ignore-duplicates,return=representation' });
    if (r.length) {
      out = await rpc('ny_bump_comment', { cid: id, d_likes: 0, d_reports: 1 });
      const c = Array.isArray(out) ? out[0] : out;
      if (c) await mailAdmin(`한줄평 신고 (${c.reports}회${c.status === 'hidden' ? ', 자동 숨김' : ''})`, [`투표: ${SITE}/?p=${c.poll_id}`, `내용: ${c.body}`, `사유: ${b.reason || '-'}`]);
    }
  } else return fail(res, 400, 'act');
  const c = Array.isArray(out) ? out[0] : out;
  send(res, 200, { ok: true, likes: c ? c.likes : undefined, status: c ? c.status : undefined });
});
