// POST /api/vote {pollId, choice:[...], relay, deviceId} (+ 로그인 토큰이 있으면 계정으로)
import { handler, send, fail, db, rpc, authUser, hash, ipOf, body, ageBand } from './_lib.js';
const IP_LIMIT = +(process.env.VOTE_IP_LIMIT || 20); // 같은 IP에서 한 투표에 받을 최대 표 (학교·회사 공용망 고려)

export default handler(async (req, res) => {
  if (req.method !== 'POST') return fail(res, 405, 'method');
  const b = body(req);
  const pollId = String(b.pollId || '');
  if (!/^[\w-]{1,40}$/.test(pollId)) return fail(res, 400, 'pollId');
  const choice = [].concat(b.choice).map(Number);
  if (!choice.length || choice.length > 20 || choice.some(c => !Number.isInteger(c) || c < 0 || c > 19)) return fail(res, 400, 'choice');
  const relay = !!b.relay;
  if (!relay && new Set(choice).size !== choice.length) return fail(res, 400, 'choice');

  const user = await authUser(req);
  const device = String(b.deviceId || '');
  if (!user && !/^[\w-]{8,64}$/.test(device)) return fail(res, 400, 'deviceId');
  const voter = user ? `u:${user.id}` : `d:${hash(device)}`;
  const ipH = hash(ipOf(req));

  if (!user) {
    const same = await db(`ny_votes?select=voter&poll_id=eq.${encodeURIComponent(pollId)}&ip_hash=eq.${ipH}&limit=${IP_LIMIT}`);
    if (same.length >= IP_LIMIT) return fail(res, 429, 'too-many-from-network');
  }

  let prof = null;
  if (user) {
    const r = await db(`ny_profiles?select=gender,birth_year,region,notify_results&id=eq.${user.id}`);
    prof = r[0] || null;
  }
  const row = {
    poll_id: pollId, voter, user_id: user ? user.id : null, choice, relay,
    gender: prof?.gender || null, age_band: ageBand(prof?.birth_year), region: prof?.region || null, ip_hash: ipH
  };
  let already = false;
  try { await db('ny_votes', { method: 'POST', body: row, prefer: 'return=minimal' }); }
  catch (e) { if (e.code === '23505') already = true; else throw e; }

  // 로그인 투표자는 24시간 뒤 결과 메일 대기열에 넣는다
  if (user && !already && prof && prof.notify_results !== false) {
    await db('ny_result_alerts', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
      body: { user_id: user.id, poll_id: pollId, send_at: new Date(Date.now() + 864e5).toISOString() }
    }).catch(e => console.error('alert', e.message));
  }
  const counts = await rpc('ny_poll_counts', { ids: [pollId] });
  send(res, 200, { ok: true, already, counts: counts || {} });
});
