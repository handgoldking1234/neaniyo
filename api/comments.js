// GET /api/comments?poll=<id>        → 한줄평 목록 (보이는 것 + 내 검토 대기 글)
// POST /api/comments {pollId, text}  → 등록 (로그인 + 그 투표에 참여한 사람만, 내 선택 쪽으로)
import { handler, send, fail, db, rpc, authUser, body, moderation, judge, mailAdmin, SITE } from './_lib.js';

const shape = (c, uid, liked) => ({
  id: c.id, o: c.side, text: c.body, likes: c.likes, ts: Date.parse(c.created_at),
  mine: !!uid && c.user_id === uid, liked: !!liked, review: c.status === 'review' ? { rule: c.rule } : undefined
});

export default handler(async (req, res) => {
  const user = await authUser(req);
  if (req.method === 'GET') {
    const poll = String(req.query.poll || '');
    if (!/^[\w-]{1,40}$/.test(poll)) return fail(res, 400, 'poll');
    const vis = await db(`comments?select=id,user_id,side,body,status,rule,likes,created_at&poll_id=eq.${poll}&status=eq.visible&order=created_at.asc&limit=500`);
    let mine = [], liked = new Set();
    if (user) {
      mine = await db(`comments?select=id,user_id,side,body,status,rule,likes,created_at&poll_id=eq.${poll}&user_id=eq.${user.id}&status=eq.review`);
      if (vis.length) {
        const ids = vis.map(c => c.id).join(',');
        (await db(`comment_likes?select=comment_id&user_id=eq.${user.id}&comment_id=in.(${ids})`)).forEach(l => liked.add(l.comment_id));
      }
    }
    return send(res, 200, { comments: vis.concat(mine).map(c => shape(c, user?.id, liked.has(c.id))) });
  }
  if (req.method !== 'POST') return fail(res, 405, 'method');
  if (!user) return fail(res, 401, 'login');
  const b = body(req), pollId = String(b.pollId || ''), text = String(b.text || '').trim();
  if (!/^[\w-]{1,40}$/.test(pollId)) return fail(res, 400, 'pollId');

  const v = await db(`votes?select=choice&poll_id=eq.${pollId}&voter=eq.${encodeURIComponent('u:' + user.id)}`);
  if (!v.length) return fail(res, 403, 'vote-first');
  const recent = await db(`comments?select=body,created_at&user_id=eq.${user.id}&created_at=gte.${new Date(Date.now() - 600000).toISOString()}`);
  const jd = judge(text, await moderation(), recent);
  if (jd.action === 'block') return send(res, 200, { ok: false, action: 'block', message: jd.message });

  const row = { poll_id: pollId, user_id: user.id, side: v[0].choice[0], body: text, status: jd.action === 'review' ? 'review' : 'visible', rule: jd.rule || null };
  const out = await db('comments', { method: 'POST', body: row, prefer: 'return=representation' });
  if (jd.action === 'review') await mailAdmin('검토 대기 한줄평', [`규칙: ${jd.name}`, `투표: ${SITE}/?p=${pollId}`, `내용: ${text}`]);
  send(res, 200, { ok: true, action: jd.action, message: jd.message, comment: shape(out[0], user.id, false) });
});
