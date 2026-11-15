// GET /api/profile → 내 프로필, POST /api/profile → 저장
import { handler, send, fail, db, authUser, body } from './_lib.js';
const G = ['남성', '여성', '응답 안 함'];
const R = ['서울', '경기·인천', '부산·울산·경남', '대구·경북', '광주·전라', '대전·세종·충청', '강원', '제주'];
const E = ['', '고졸 이하', '대학 재학', '대졸', '대학원 이상'];
const COLS = 'gender,birth_year,region,edu,stat_consent,notify_results,is_admin,created_at,updated_at';

export default handler(async (req, res) => {
  const user = await authUser(req);
  if (!user) return fail(res, 401, 'login');
  if (req.method === 'GET') {
    const r = await db(`profiles?select=${COLS}&id=eq.${user.id}`);
    const votes = await db(`votes?select=poll_id,choice&user_id=eq.${user.id}&order=created_at.desc&limit=1000`);
    return send(res, 200, { email: user.email, provider: user.app_metadata?.provider || 'email', profile: r[0] || null, votes });
  }
  if (req.method !== 'POST') return fail(res, 405, 'method');
  const b = body(req), y = new Date().getFullYear();
  const row = {
    id: user.id,
    gender: G.includes(b.gender) ? b.gender : null,
    birth_year: Number.isInteger(+b.birth) && +b.birth <= y - 14 && +b.birth >= y - 100 ? +b.birth : null,
    region: R.includes(b.region) ? b.region : null,
    edu: E.includes(b.edu || '') ? (b.edu || null) : null,
    stat_consent: !!b.stat,
    notify_results: b.notify !== false,
    updated_at: new Date().toISOString()
  };
  if (!row.gender || !row.birth_year || !row.region) return fail(res, 400, 'profile');
  const out = await db('profiles?on_conflict=id', { method: 'POST', body: row, prefer: 'resolution=merge-duplicates,return=representation' });
  send(res, 200, { profile: out[0] });
});
