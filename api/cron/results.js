// Vercel Cron (vercel.json): 하루 한 번, 투표 24시간이 지난 회원에게 결과를 한 통으로 묶어 보낸다.
import { send, fail, db, rpc, adminGetUser, mail, esc, SITE, configured } from '../_lib.js';

async function pollTitles(ids) {
  // 피드·기본 투표는 JSON 파일에서, 사용자 투표는 DB에서 제목·보기를 찾는다
  const map = {};
  for (const u of ['https://raw.githubusercontent.com/handgoldking1234/neaniyo/feed/data/polls.json', `${SITE}/data/polls.json`]) {
    try { const r = await fetch(u); if (r.ok) (await r.json()).forEach(p => { if (ids.includes(p.id)) map[p.id] = p; }); } catch {}
  }
  const up = ids.filter(i => i.startsWith('u') && !map[i]);
  if (up.length) (await db(`ny_user_polls?select=id,data&id=in.(${up.join(',')})`)).forEach(r => { map[r.id] = r.data; });
  return map;
}

export default async function (req, res) {
  if (!configured()) return fail(res, 503, 'backend-not-configured');
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return fail(res, 401, 'cron');
  const due = await db(`ny_result_alerts?select=user_id,poll_id&sent_at=is.null&send_at=lte.${new Date().toISOString()}&order=user_id&limit=2000`);
  if (!due.length) return send(res, 200, { sent: 0 });
  const ids = [...new Set(due.map(d => d.poll_id))];
  const [counts, polls] = await Promise.all([rpc('ny_poll_counts', { ids }), pollTitles(ids)]);
  const byUser = {};
  due.forEach(d => { (byUser[d.user_id] = byUser[d.user_id] || []).push(d.poll_id); });
  let sent = 0;
  for (const [uid, list] of Object.entries(byUser)) {
    const u = await adminGetUser(uid);
    const items = list.map(id => {
      const p = polls[id], c = counts?.[id];
      if (!p || !c || p.vis === 'secret' || p.type === 'relay') return '';
      const row = c.v?.['0'] || {}, tot = Object.values(row).reduce((a, b) => a + b, 0) || 1;
      const bars = p.o.map((o, i) => `<tr><td style="padding:2px 8px 2px 0">${esc(o)}</td><td style="padding:2px 0"><b>${Math.round((row[i] || 0) * 1000 / tot) / 10}%</b></td></tr>`).join('');
      return `<div style="margin:0 0 18px"><a href="${SITE}/?p=${encodeURIComponent(id)}" style="font-weight:700;color:#111;text-decoration:none">${esc(p.q)}</a><div style="color:#888;font-size:12px">${c.n}명 참여</div><table style="font-size:14px;margin-top:4px">${bars}</table></div>`;
    }).filter(Boolean);
    if (u?.email && items.length) {
      const r = await mail({
        to: u.email, subject: `내가 참여한 투표 결과 ${items.length}개가 나왔어요`,
        html: `<div style="font-family:-apple-system,sans-serif;max-width:520px;line-height:1.5"><h2 style="font-size:18px">네아니요 · 투표 결과</h2>${items.join('')}<p style="color:#999;font-size:12px">결과 메일은 내 정보에서 끌 수 있어요. <a href="${SITE}/">네아니요</a></p></div>`,
        text: `내가 참여한 투표 ${items.length}개의 결과가 나왔어요. ${SITE}`
      });
      if (r.ok) sent++;
    }
    await db(`ny_result_alerts?user_id=eq.${uid}&poll_id=in.(${list.map(encodeURIComponent).join(',')})`, { method: 'PATCH', body: { sent_at: new Date().toISOString() } });
  }
  send(res, 200, { sent, users: Object.keys(byUser).length });
}
