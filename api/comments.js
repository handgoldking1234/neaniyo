// GET /api/comments?poll=<id>        → 한줄평 목록 (보이는 것 + 내 검토 대기 글)
// POST /api/comments {pollId, text, parentId?}  → 등록 (로그인 + 그 투표에 참여한 사람만, 내 선택 쪽으로). parentId가 있으면 답글
import crypto from 'node:crypto';
import { handler, send, fail, db, rpc, authUser, body, moderation, judge, mailAdmin, SITE } from './_lib.js';

const COLS = 'id,user_id,parent_id,side,body,status,rule,likes,created_at,edited_at';
// 사용자 ID는 내보내지 않고, 프로필 색을 고르기 위한 짧은 값만 준다
const avKey = uid => parseInt(crypto.createHash('sha256').update('ny-av:' + uid).digest('hex').slice(0, 6), 16) % 360;
const shape = (c, uid, liked, names = {}, owner = null) => ({
  id: c.id, o: c.side, text: c.body, likes: c.likes, ts: Date.parse(c.created_at), pid: c.parent_id || undefined, ed: c.edited_at ? 1 : undefined,
  name: names[c.user_id] || null, av: avKey(c.user_id), op: !!owner && c.user_id === owner || undefined,
  mine: !!uid && c.user_id === uid, liked: !!liked, review: c.status === 'review' ? { rule: c.rule } : undefined
});
// 닉네임 공개에 동의한 사람만 이름을 보여 준다
async function namesOf(list) {
  const ids = [...new Set(list.map(c => c.user_id))]; if (!ids.length) return {};
  const r = await db(`ny_profiles?select=id,nickname,rank_public&id=in.(${ids.join(',')})`);
  const m = {}; r.forEach(x => { if (x.rank_public && x.nickname) m[x.id] = x.nickname; }); return m;
}
async function ownerOf(poll) {
  if (!/^u[\w-]{1,39}$/.test(poll)) return null;
  const r = await db(`ny_user_polls?select=user_id&id=eq.${poll}`); return r.length ? r[0].user_id : null;
}

// AI 캐릭터 의견 (iux-comment 서비스가 cc_ 표에 넣어 둔 것). 사람 한줄평과 따로 보여 주고, 공개 시각이 된 것만, 최대 3개.
// 캐릭터는 투표하지 않으므로 참여 수·한줄평 수에 들어가지 않는다. 실패해도 한줄평은 그대로 보여 준다.
const AI_ON = process.env.AI_CHARACTERS !== 'off';
async function aiOf(poll) {
  if (!AI_ON) return [];
  try {
    const rows = await db(`cc_comments?select=id,character_name,character_label,body,visible_at,cc_posts!inner(external_id),cc_sites!inner(public_key)` +
      `&cc_posts.external_id=eq.${encodeURIComponent(poll)}&cc_sites.public_key=eq.neaniyo&is_hidden=eq.false` +
      `&visible_at=lte.${encodeURIComponent(new Date().toISOString())}&order=visible_at.asc&limit=3`);
    return rows.map(r => ({ id: r.id, name: r.character_name, label: r.character_label, text: r.body, ts: Date.parse(r.visible_at) }));
  } catch { return []; }
}

export default handler(async (req, res) => {
  const user = await authUser(req);
  // GET /api/comments?mine=1 → 내 한줄평 현황(내가 쓴 글 · 받은 공감·답글)과 내가 만든 투표에 달린 한줄평 수
  if (req.method === 'GET' && req.query.mine) {
    if (!user) return fail(res, 401, 'login');
    const [mineC, myPolls] = await Promise.all([
      db(`ny_comments?select=id,poll_id,parent_id,side,body,status,likes,created_at,edited_at&user_id=eq.${user.id}&status=neq.hidden&order=created_at.desc&limit=200`),
      db(`ny_user_polls?select=id&user_id=eq.${user.id}&limit=300`)
    ]);
    const myIds = mineC.map(c => c.id), pollIds = myPolls.map(x => x.id);
    const [reps, onMade] = await Promise.all([
      myIds.length ? db(`ny_comments?select=parent_id,created_at,user_id&parent_id=in.(${myIds.join(',')})&status=eq.visible&limit=2000`) : [],
      pollIds.length ? db(`ny_comments?select=poll_id,created_at,user_id&poll_id=in.(${pollIds.join(',')})&status=eq.visible&limit=5000`) : []
    ]);
    const rc = {}, rl = {};
    reps.forEach(r => { if (r.user_id === user.id) return; rc[r.parent_id] = (rc[r.parent_id] || 0) + 1; const t = Date.parse(r.created_at); if (!rl[r.parent_id] || t > rl[r.parent_id]) rl[r.parent_id] = t; });
    const made = {};
    onMade.forEach(c => { if (c.user_id === user.id) return; const m = made[c.poll_id] || (made[c.poll_id] = { n: 0, last: 0 }); m.n++; const t = Date.parse(c.created_at); if (t > m.last) m.last = t; });
    return send(res, 200, {
      comments: mineC.map(c => ({ id: c.id, poll: c.poll_id, pid: c.parent_id || undefined, o: c.side, text: c.body, likes: c.likes, ts: Date.parse(c.created_at), review: c.status === 'review' || undefined, ed: c.edited_at ? 1 : undefined, replies: rc[c.id] || 0, lastReply: rl[c.id] || 0 })),
      made
    });
  }
  if (req.method === 'GET') {
    const poll = String(req.query.poll || '');
    if (!/^[\w-]{1,40}$/.test(poll)) return fail(res, 400, 'poll');
    const vis = await db(`ny_comments?select=${COLS}&poll_id=eq.${poll}&status=eq.visible&order=created_at.asc&limit=500`);
    let mine = [], liked = new Set();
    if (user) {
      mine = await db(`ny_comments?select=${COLS}&poll_id=eq.${poll}&user_id=eq.${user.id}&status=eq.review`);
      if (vis.length) {
        const ids = vis.map(c => c.id).join(',');
        (await db(`ny_comment_likes?select=comment_id&user_id=eq.${user.id}&comment_id=in.(${ids})`)).forEach(l => liked.add(l.comment_id));
      }
    }
    const all = vis.concat(mine), [names, owner, ai] = await Promise.all([namesOf(all), ownerOf(poll), aiOf(poll)]);
    return send(res, 200, { comments: all.map(c => shape(c, user?.id, liked.has(c.id), names, owner)), ai });
  }
  if (req.method !== 'POST') return fail(res, 405, 'method');
  if (!user) return fail(res, 401, 'login');
  const b = body(req), pollId = String(b.pollId || ''), text = String(b.text || '').trim();
  if (!/^[\w-]{1,40}$/.test(pollId)) return fail(res, 400, 'pollId');
  const pid = b.parentId ? String(b.parentId) : null;
  if (pid && !/^[0-9a-f-]{36}$/.test(pid)) return fail(res, 400, 'parent');
  // 확인할 것들을 한꺼번에 물어봐서 기다리는 시간을 줄인다
  const since = new Date(Date.now() - 600000).toISOString();
  const [pr, v, recent, mod, names, owner] = await Promise.all([
    pid ? db(`ny_comments?select=id,parent_id,poll_id,status&id=eq.${pid}`) : null,
    db(`ny_votes?select=choice&poll_id=eq.${pollId}&voter=eq.${encodeURIComponent('u:' + user.id)}`),
    db(`ny_comments?select=body,created_at&user_id=eq.${user.id}&created_at=gte.${since}`),
    moderation(),
    namesOf([{ user_id: user.id }]),
    ownerOf(pollId)
  ]);
  // 답글: 같은 투표의 한줄평에만, 답글의 답글은 맨 위 한줄평 아래로 모은다
  let parent = null;
  if (pid) {
    if (!pr.length || pr[0].poll_id !== pollId || pr[0].status === 'hidden') return fail(res, 404, 'parent');
    parent = pr[0].parent_id || pr[0].id;
  }
  if (!v.length) return fail(res, 403, 'vote-first');
  const jd = judge(text, mod, recent);
  if (jd.action === 'block') return send(res, 200, { ok: false, action: 'block', message: jd.message });

  const row = { poll_id: pollId, user_id: user.id, parent_id: parent, side: v[0].choice[0], body: text, status: jd.action === 'review' ? 'review' : 'visible', rule: jd.rule || null };
  const out = await db('ny_comments', { method: 'POST', body: row, prefer: 'return=representation' });
  if (jd.action === 'review') await mailAdmin('검토 대기 한줄평', [`규칙: ${jd.name}`, `투표: ${SITE}/?p=${pollId}`, `내용: ${text}`]);
  send(res, 200, { ok: true, action: jd.action, message: jd.message, comment: shape(out[0], user.id, false, names, owner) });
});
