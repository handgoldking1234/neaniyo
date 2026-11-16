// GET  /api/polls            → 승인된 공개 투표 (피드에 합침)
// GET  /api/polls?id=<id>    → 링크·비밀방 투표 하나
// GET  /api/polls?mine=1     → 내가 만든 투표 (로그인)
// POST /api/polls {poll}     → 만들기·수정 (로그인). 공개 투표는 바로 노출(사후 관리). 운영 규칙에 걸리면 승인 대기, 금지어면 거절
//                               POLL_REVIEW=pre 로 두면 예전처럼 공개 투표 전부 승인 후 노출
import { handler, send, fail, db, authUser, body, mailAdmin, SITE, moderation, judge } from './_lib.js';
const MAX = 1_500_000; // data(jsonb) 최대 크기. 사진은 나중에 Supabase Storage로 옮길 것
const KEEP = ['id', 'cat', 'sub', 'q', 'o', 'type', 'qs', 'n', 'vis', 'comments', 'story', 'img', 'gal', 'imgs', 'link', 'multiSel', 'pw', 'created'];
const out = r => ({ ...r.data, id: r.id, vis: r.vis, status: r.status, created: Date.parse(r.created_at) });

export default handler(async (req, res) => {
  if (req.method === 'GET') {
    if (req.query.id) {
      const id = String(req.query.id);
      if (!/^u[\w-]{1,39}$/.test(id)) return fail(res, 400, 'id');
      const r = await db(`ny_user_polls?select=*&id=eq.${id}&status=eq.approved`);
      return r.length ? send(res, 200, { poll: out(r[0]) }, 'public, s-maxage=30') : fail(res, 404, 'not-found');
    }
    if (req.query.mine) {
      const user = await authUser(req); if (!user) return fail(res, 401, 'login');
      const r = await db(`ny_user_polls?select=*&user_id=eq.${user.id}&order=created_at.desc&limit=200`);
      return send(res, 200, { polls: r.map(out) });
    }
    const r = await db('ny_user_polls?select=*&status=eq.approved&vis=eq.public&order=created_at.desc&limit=300');
    return send(res, 200, { polls: r.map(out) }, 'public, s-maxage=60, stale-while-revalidate=300');
  }
  if (req.method !== 'POST') return fail(res, 405, 'method');
  const user = await authUser(req); if (!user) return fail(res, 401, 'login');
  const p = body(req).poll || {};
  if (!/^u[\w-]{1,39}$/.test(p.id || '') || !p.q || !Array.isArray(p.o) || p.o.length < 2) return fail(res, 400, 'poll');
  const data = {}; KEEP.forEach(k => { if (p[k] !== undefined) data[k] = p[k]; });
  if (Array.isArray(data.qs)) data.qs = data.qs.map(x => ({ q: x.q, o: x.o }));
  if (JSON.stringify(data).length > MAX) return fail(res, 413, 'too-large');
  const vis = ['public', 'link', 'secret'].includes(p.vis) ? p.vis : 'public';
  const prev = await db(`ny_user_polls?select=user_id,status&id=eq.${p.id}`);
  if (prev.length && prev[0].user_id !== user.id) return fail(res, 403, 'not-owner');
  // 제목·보기·내용을 한줄평과 같은 운영 규칙으로 검사 (길이 제한은 제외)
  const mod = await moderation();
  const text = [data.q, ...(data.o || []), ...((data.qs || []).flatMap(x => [x.q, ...(x.o || [])])), data.story || ''].join(' ');
  const jd = judge(text, { ...mod, limits: { minLength: 1 } });
  if (jd.action === 'block') return fail(res, 422, 'blocked:' + (jd.rule || ''));
  const pre = (process.env.POLL_REVIEW || 'post') === 'pre';
  // 관리자가 내린(rejected) 투표를 고쳐 올리면 다시 승인 대기로
  const wasRejected = prev.length && prev[0].status === 'rejected';
  const status = (vis === 'public' && (pre || wasRejected || jd.action === 'review')) ? 'pending' : 'approved';
  const row = { id: p.id, user_id: user.id, data, vis, status, updated_at: new Date().toISOString() };
  const r = await db('ny_user_polls?on_conflict=id', { method: 'POST', body: row, prefer: 'resolution=merge-duplicates,return=representation' });
  if (status === 'pending') await mailAdmin('승인 대기 새 투표', [jd.name ? `규칙: ${jd.name}` : '사전 승인 모드', `[${data.cat || '-'}] ${data.q}`, `보기: ${data.o.join(' / ')}`, `미리보기: ${SITE}/?p=${p.id}`]);
  else if (!prev.length && vis === 'public') await mailAdmin('새 투표 (바로 공개됨)', [`[${data.cat || '-'}] ${data.q}`, `보기: ${data.o.join(' / ')}`, `보기·숨기기: ${SITE}/admin`]);
  send(res, 200, { ok: true, poll: out(r[0]) });
});
