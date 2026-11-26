// GET /api/profile → 내 프로필, POST /api/profile → 저장, DELETE /api/profile → 회원 탈퇴
// GET /api/profile?follow=1 → 내가 팔로우하는 사람 키(ck) 목록과 내 팔로워 수
// POST /api/profile {follow:<pollId>, on:true|false} → 그 투표를 만든 사람 팔로우/취소
import { handler, send, fail, db, authUser, body, hash, SUPA_URL } from './_lib.js';
import crypto from 'node:crypto';
const ckOf = uid => crypto.createHash('sha256').update('ny-ck:' + uid).digest('hex').slice(0, 12);
const G = ['남성', '여성', '응답 안 함'];
const R = ['서울', '경기·인천', '부산·울산·경남', '대구·경북', '광주·전라', '대전·세종·충청', '강원', '제주'];
const E = ['', '고졸 이하', '대학 재학', '대졸', '대학원 이상'];
const COLS = 'gender,birth_year,region,edu,stat_consent,notify_results,is_admin,nickname,rank_public,created_at,updated_at';
const BAD_NICK = /관리자|운영자|admin|네아니요|neaniyo|운영진/i;

export default handler(async (req, res) => {
  const user = await authUser(req);
  if (!user) return fail(res, 401, 'login');
  if (req.method === 'GET' && req.query.follow) {
    const [mine, fans] = await Promise.all([
      db(`ny_follows?select=followee&follower=eq.${user.id}&limit=1000`),
      db(`ny_follows?select=follower&followee=eq.${user.id}&limit=10000`)
    ]);
    return send(res, 200, { keys: mine.map(x => ckOf(x.followee)), followers: fans.length, me: ckOf(user.id) });
  }
  if (req.method === 'GET') {
    const r = await db(`ny_profiles?select=${COLS}&id=eq.${user.id}`);
    const votes = await db(`ny_votes?select=poll_id,choice,created_at&user_id=eq.${user.id}&order=created_at.desc&limit=1000`);
    return send(res, 200, { email: user.email, provider: user.app_metadata?.provider || 'email', profile: r[0] || null, votes });
  }
  if (req.method === 'DELETE') {
    // 탈퇴: 투표 기록은 집계에 남기되 계정과 끊고(프로필 정보도 지움), 계정을 지우면 프로필·한줄평·만든 투표는 함께 삭제된다
    await db(`ny_votes?user_id=eq.${user.id}`, { method: 'PATCH', body: { voter: `x:${hash(user.id)}`, user_id: null, gender: null, age_band: null, region: null }, prefer: 'return=minimal' });
    const URL_ = SUPA_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const r = await fetch(`${URL_}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    if (!r.ok) return fail(res, 500, 'delete-failed');
    return send(res, 200, { ok: true });
  }
  if (req.method !== 'POST') return fail(res, 405, 'method');
  const b = body(req), y = new Date().getFullYear();
  if (b.follow) {
    const pid = String(b.follow);
    if (!/^u[\w-]{1,39}$/.test(pid)) return fail(res, 400, 'poll');
    const r = await db(`ny_user_polls?select=user_id&id=eq.${pid}`);
    if (!r.length || !r[0].user_id) return fail(res, 404, 'poll');
    const who = r[0].user_id;
    if (who === user.id) return fail(res, 400, 'self');
    if (b.on === false) await db(`ny_follows?follower=eq.${user.id}&followee=eq.${who}`, { method: 'DELETE', prefer: 'return=minimal' });
    else await db('ny_follows', { method: 'POST', body: { follower: user.id, followee: who }, prefer: 'resolution=ignore-duplicates,return=minimal' });
    return send(res, 200, { ok: true, key: ckOf(who), on: b.on !== false });
  }
  // 투표왕 랭킹 닉네임·공개 여부만 바꾸기
  if (b.only === 'rank') {
    const nick = String(b.nick || '').trim().replace(/\s+/g, ' ');
    if (nick && (!/^[가-힣a-zA-Z0-9_ ]{2,10}$/.test(nick) || BAD_NICK.test(nick))) return fail(res, 400, 'nick');
    if (!nick && b.rankPublic) return fail(res, 400, 'nick-required');
    if (nick) {
      const dup = await db(`ny_profiles?select=id&nickname=ilike.${encodeURIComponent(nick.replace(/[%_]/g, '\\$&'))}&id=neq.${user.id}&limit=1`);
      if (dup.length) return fail(res, 409, 'nick-taken');
    }
    const out = await db(`ny_profiles?id=eq.${user.id}`, { method: 'PATCH', body: { nickname: nick || null, rank_public: !!(nick && b.rankPublic), updated_at: new Date().toISOString() }, prefer: 'return=representation' });
    if (!out.length) return fail(res, 400, 'profile');
    return send(res, 200, { nickname: out[0].nickname, rank_public: out[0].rank_public });
  }
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
  const out = await db('ny_profiles?on_conflict=id', { method: 'POST', body: row, prefer: 'resolution=merge-duplicates,return=representation' });
  // 처음 가입한 경로만 남긴다 (이미 있으면 그대로)
  const src = String(b.src || '');
  if (/^[a-z0-9_.-]{1,30}$/.test(src) && out[0] && !out[0].src) await db(`ny_profiles?id=eq.${user.id}&src=is.null`, { method: 'PATCH', body: { src } }).catch(() => {});
  send(res, 200, { profile: out[0] });
});
