// POST /api/comment-action {id, act: like|unlike|report|edit|delete, reason, text}
import { handler, send, fail, db, rpc, authUser, body, mailAdmin, SITE, moderation, judge } from './_lib.js';
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
  } else if (act === 'edit' || act === 'delete') {
    // 내 글만 고치거나 지울 수 있다
    const own = await db(`ny_comments?select=id,user_id,status&id=eq.${id}`);
    if (!own.length || own[0].user_id !== user.id) return fail(res, 403, 'not-mine');
    if (act === 'delete') {
      await db(`ny_comments?id=eq.${id}`, { method: 'DELETE', prefer: 'return=minimal' });
      return send(res, 200, { ok: true, deleted: true });
    }
    const text = String(b.text || '').trim();
    const jd = judge(text, await moderation(), []);
    if (jd.action === 'block') return send(res, 200, { ok: false, message: jd.message });
    const patch = { body: text, edited_at: new Date().toISOString() };
    if (jd.action === 'review') { patch.status = 'review'; patch.rule = jd.rule || null; }
    const r = await db(`ny_comments?id=eq.${id}`, { method: 'PATCH', body: patch, prefer: 'return=representation' });
    if (jd.action === 'review') await mailAdmin('검토 대기 한줄평 (수정됨)', [`규칙: ${jd.name}`, `투표: ${SITE}/?p=${r[0].poll_id}`, `내용: ${text}`]);
    return send(res, 200, { ok: true, text, review: jd.action === 'review', message: jd.message });
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
