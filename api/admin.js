// 관리자 전용 (profiles.is_admin = true 인 계정)
// GET  /api/admin                     → 승인 대기 투표, 최근 공개 투표, 검토 대기·신고 한줄평
// GET  /api/admin?view=stats&days=14  → 방문·참여·유입·기기 통계 (ny_admin_stats)
// GET  /api/admin?view=members&q=     → 회원 목록 (ny_admin_members)
// POST /api/admin {act, id, reason}   → approve | reject | setcat{cat,sub} (투표), show | hide | delete (한줄평), setadmin | unadmin | ban | unban (회원), testmail
import { handler, send, fail, db, rpc, authUser, body, mail, SUPA_URL } from './_lib.js';
export default handler(async (req, res) => {
  const user = await authUser(req); if (!user) return fail(res, 401, 'login');
  const me = await db(`ny_profiles?select=is_admin&id=eq.${user.id}`);
  if (!me[0]?.is_admin) return fail(res, 403, 'admin-only');
  if (req.method === 'GET' && req.query.view === 'stats') {
    const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 14));
    return send(res, 200, { stats: await rpc('ny_admin_stats', { days }) });
  }
  if (req.method === 'GET' && req.query.view === 'members') {
    const q = String(req.query.q || '').slice(0, 60).replace(/[%_\\]/g, '');
    return send(res, 200, { members: await rpc('ny_admin_members', { q, lim: 300 }) });
  }
  if (req.method === 'GET') {
    const [polls, recent, review, reported] = await Promise.all([
      db('ny_user_polls?select=*&status=eq.pending&order=created_at.asc&limit=200'),
      db('ny_user_polls?select=*&status=eq.approved&vis=eq.public&order=created_at.desc&limit=100'),
      db('ny_comments?select=*&status=eq.review&order=created_at.asc&limit=200'),
      db('ny_comments?select=*&reports=gt.0&order=reports.desc&limit=200')
    ]);
    return send(res, 200, { polls, recent, review, reported }); // recent: 바로 공개된 최근 투표 (문제 있으면 reject로 내림)
  }
  if (req.method !== 'POST') return fail(res, 405, 'method');
  const b = body(req), id = String(b.id || '');
  const now = new Date().toISOString();
  switch (b.act) {
    case 'approve': await db(`ny_user_polls?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: 'approved', reject_reason: null, updated_at: now } }); break;
    case 'reject': await db(`ny_user_polls?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: 'rejected', reject_reason: String(b.reason || '').slice(0, 200) || null, updated_at: now } }); break;
    case 'setcat': { // 카테고리 바로잡기 (data.cat / data.sub)
      const cat = String(b.cat || '').slice(0, 20), sub = String(b.sub || '').slice(0, 20);
      if (!cat) return fail(res, 400, 'cat');
      const rows = await db(`ny_user_polls?id=eq.${encodeURIComponent(id)}&select=data`);
      if (!rows || !rows[0]) return fail(res, 404, 'poll');
      await db(`ny_user_polls?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { data: { ...rows[0].data, cat, sub }, updated_at: now } });
      break;
    }
    case 'show': await db(`ny_comments?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: 'visible' } }); break;
    case 'hide': await db(`ny_comments?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { status: 'hidden' } }); break;
    case 'delete': await db(`ny_comments?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }); break;
    case 'setadmin': case 'unadmin': { // 회원 관리: 관리자 지정·해제 (자기 자신은 해제 불가)
      if (b.act === 'unadmin' && id === user.id) return fail(res, 400, 'self');
      await db(`ny_profiles?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { is_admin: b.act === 'setadmin' } });
      break;
    }
    case 'ban': case 'unban': { // 회원 관리: 이용 정지·해제 (Supabase Auth ban). 정지되면 로그인·투표 저장·한줄평이 막힌다
      if (id === user.id) return fail(res, 400, 'self');
      const r = await fetch(`${SUPA_URL}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
        method: 'PUT', headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ban_duration: b.act === 'ban' ? '876000h' : 'none' })
      });
      if (!r.ok) return fail(res, 500, 'ban-failed');
      break;
    }
    case 'testmail': { // 메일 연결 시험: 로그인한 관리자 메일로 한 통 보내고 결과(실패 이유 포함)를 돌려준다
      const key = process.env.MAIL_API_KEY || process.env.RESEND_API_KEY;
      if (!key) return send(res, 200, { ok: false, error: 'Vercel에 RESEND_API_KEY(또는 MAIL_API_KEY)가 없습니다.' });
      const r = await mail({ to: user.email, subject: '[네아니요] 메일 연결 시험', text: '이 메일이 보이면 네아니요 메일 발송이 정상입니다.', html: '<p>이 메일이 보이면 <b>네아니요 메일 발송이 정상</b>입니다.</p>' });
      return send(res, 200, { ...r, to: user.email, from: process.env.MAIL_FROM || '네아니요 <noreply@iux.kr>' });
    }
    default: return fail(res, 400, 'act');
  }
  send(res, 200, { ok: true });
});
