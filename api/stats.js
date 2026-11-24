// GET /api/stats?id=<pollId> → 성별·연령·지역·시간대별 실제 결과 (로그인 필요)
// {stats:{gender:{"남성":{n:41,c:[20,21]}, "여성":{n:12,hidden:true}}, ...}, min:30}
// 30명 미만 그룹은 선택 수를 내려보내지 않는다 (개인 선택 추정 방지)
import { handler, send, fail, rpc, authUser } from './_lib.js';
const MIN_N = 30;
export default handler(async (req, res) => {
  // GET /api/stats?view=voters&days=7|30|0 → 투표왕 랭킹 (로그인 불필요, 로그인하면 내 순위 포함)
  if (req.query.view === 'creators') {
    const days = [7, 30, 0].includes(+req.query.days) ? +req.query.days : 7;
    const user = await authUser(req).catch(() => null);
    const j = (await rpc('ny_top_creators', { days, lim: 30, me: user ? user.id : null })) || {};
    return send(res, 200, { top: j.top || [], total: j.total || 0, me: j.me || null, myTotal: j.myTotal || 0, myWins: j.myWins || 0, myNext: j.myNext || 0, myPolls: j.myPolls || 0, days }, user ? 'private, max-age=30' : 'public, max-age=60');
  }
  if (req.query.view === 'voters') {
    const days = [7, 30, 0].includes(+req.query.days) ? +req.query.days : 7;
    const user = await authUser(req).catch(() => null);
    const j = (await rpc('ny_top_voters', { days, lim: 30, me: user ? user.id : null })) || {};
    return send(res, 200, { top: j.top || [], total: j.total || 0, me: j.me || null, myTotal: j.myTotal || 0, days }, user ? 'private, max-age=30' : 'public, max-age=60');
  }
  const id = String(req.query.id || '');
  if (!/^[\w-]{1,40}$/.test(id)) return fail(res, 400, 'id');
  const user = await authUser(req); if (!user) return fail(res, 401, 'login');
  const raw = (await rpc('ny_poll_breakdown', { pid: id })) || {};
  const stats = {};
  for (const [dim, groups] of Object.entries(raw)) {
    stats[dim] = {};
    for (const [g, x] of Object.entries(groups || {})) {
      const n = +x.n || 0;
      if (n < MIN_N) { stats[dim][g] = { n, hidden: true }; continue; }
      const c = []; for (const [k, v] of Object.entries(x.c || {})) c[+k] = +v;
      stats[dim][g] = { n, c: Array.from(c, v => v || 0) };
    }
  }
  send(res, 200, { stats, min: MIN_N }, 'private, max-age=60');
});
