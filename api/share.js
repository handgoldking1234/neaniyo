// 투표별 공유 미리보기 (카카오톡·SNS)
// GET /p/<id>               → (vercel.json 재작성) /api/share?id=<id>
//                              미리보기 태그(og:*)만 담은 작은 페이지. 사람은 바로 /?p=<id> 로 이동, 크롤러는 태그를 읽는다
// GET /api/share?id=<id>&img=1 → 그 투표 제목·보기로 만든 1200×630 PNG
// 비밀방 투표와 아직 공개 전인 예약 투표는 제목을 내보내지 않는다
import { ImageResponse } from '@vercel/og';
import { db, configured, esc, SITE } from './_lib.js';

const FEED = 'https://raw.githubusercontent.com/handgoldking1234/neaniyo/feed/data/polls.json';
const MAIN = 'https://raw.githubusercontent.com/handgoldking1234/neaniyo/main/data/polls.json';
let cache = { t: 0, list: [] };
async function sitePolls() {
  if (Date.now() - cache.t < 300_000) return cache.list;
  const lists = await Promise.all([FEED, `${SITE}/data/polls.json`, MAIN].map(u =>
    fetch(u).then(r => (r.ok ? r.json() : [])).catch(() => [])));
  cache = { t: Date.now(), list: lists.flat().filter(p => p && p.id) };
  return cache.list;
}

async function findPoll(id) {
  if (/^u[\w-]{1,39}$/.test(id)) {
    if (!configured()) return null;
    const r = await db(`ny_user_polls?select=data,vis,status&id=eq.${id}`).catch(() => []);
    if (!r.length || r[0].status !== 'approved') return null;
    if (r[0].vis === 'secret') return { secret: true };
    const d = r[0].data || {};
    return { q: d.q, o: d.o || [], cat: d.cat, type: d.type };
  }
  if (/^(f\d{10}|d\d{6}-\d+)$/.test(id)) {
    const p = (await sitePolls()).find(x => x.id === id);
    if (!p) return null;
    if (p.at && Date.parse(p.at) > Date.now()) return null; // 예약 공개 전
    return { q: p.q, o: p.o || [], cat: p.cat, type: p.type, desc: p.desc };
  }
  return null;
}

// ---------- 이미지 ----------
const A = '#E8336D', B = '#2F5BEA', INK = '#14161F', MUTED = '#5E6378';
const OPC = [A, B, '#F2A93B', '#1F9D6B', '#8B5CF6', '#0EA5E9'];
async function font(weight, text) {
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@${weight}&text=${encodeURIComponent(text)}`)).text();
  const m = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/);
  if (!m) throw new Error('font');
  return (await fetch(m[1])).arrayBuffer();
}
const h = (type, style, children) => ({ type, props: { style: { display: 'flex', ...style }, children } });
const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

async function image(p) {
  const q = p ? (p.secret ? '비밀방 투표에 초대받았어요' : clip(p.q, 70)) : '당신은 어느 쪽?';
  const opts = p && !p.secret ? p.o.slice(0, 4).map(o => clip(o, 16)) : ['네', '아니요'];
  const cat = p && !p.secret && p.cat ? p.cat : '';
  const text = '네아니요당신은어느쪽?투표하기→ VS…' + q + opts.join('') + cat + '0123456789';
  const [bold, mid] = await Promise.all([font(800, text), font(500, text)]);
  const qSize = q.length > 44 ? 54 : q.length > 26 ? 64 : 76;
  const vs = opts.length === 2;
  const optRow = vs
    ? h('div', { alignItems: 'center', gap: 24, width: '100%' }, [
        h('div', { flex: 1, background: A, color: '#fff', borderRadius: 22, padding: '26px 30px', fontSize: 40, fontWeight: 800, justifyContent: 'center' }, opts[0]),
        h('div', { fontSize: 34, fontWeight: 800, color: MUTED }, 'VS'),
        h('div', { flex: 1, background: B, color: '#fff', borderRadius: 22, padding: '26px 30px', fontSize: 40, fontWeight: 800, justifyContent: 'center' }, opts[1])
      ])
    : h('div', { flexWrap: 'wrap', gap: 16, width: '100%' }, opts.map((o, i) =>
        h('div', { border: `4px solid ${OPC[i]}`, color: INK, borderRadius: 18, padding: '14px 24px', fontSize: 32, fontWeight: 800 }, o)));
  const tree = h('div', { width: 1200, height: 630, background: '#fff', flexDirection: 'column', padding: '54px 64px', fontFamily: 'NotoKR', color: INK }, [
    h('div', { alignItems: 'center', gap: 14, width: '100%' }, [
      h('div', { width: 44, height: 44, borderRadius: 12, overflow: 'hidden' }, [h('div', { width: 22, height: 44, background: A }, []), h('div', { width: 22, height: 44, background: B }, [])]),
      h('div', { fontSize: 34, fontWeight: 800 }, '네아니요'),
      cat ? h('div', { marginLeft: 8, fontSize: 24, fontWeight: 500, color: MUTED, border: '2px solid #E2E4EC', borderRadius: 99, padding: '4px 16px' }, cat) : h('div', {}, [])
    ]),
    h('div', { flex: 1, alignItems: 'center', fontSize: qSize, fontWeight: 800, lineHeight: 1.25, letterSpacing: -1 }, q),
    optRow,
    h('div', { marginTop: 26, justifyContent: 'flex-end', width: '100%', fontSize: 26, fontWeight: 500, color: MUTED }, '당신은 어느 쪽? 투표하기 →')
  ]);
  const img = new ImageResponse(tree, { width: 1200, height: 630, fonts: [{ name: 'NotoKR', data: bold, weight: 800 }, { name: 'NotoKR', data: mid, weight: 500 }] });
  return Buffer.from(await img.arrayBuffer());
}

// GET /sitemap.xml → (vercel.json 재작성) /api/share?sitemap=1 : 검색 등록용 사이트맵 (공개된 투표만)
async function sitemap(res) {
  const now = Date.now(), urls = [{ loc: `${SITE}/`, at: new Date().toISOString() }];
  for (const p of await sitePolls().catch(() => [])) {
    if (!/^(f\d{10}|d\d{6}-\d+)$/.test(p.id)) continue;
    const at = Date.parse(p.at || ''); if (!isNaN(at) && at > now) continue;
    urls.push({ loc: `${SITE}/p/${encodeURIComponent(p.id)}`, at: isNaN(at) ? null : new Date(at).toISOString() });
  }
  if (configured()) {
    const r = await db('ny_user_polls?select=id,created_at&status=eq.approved&vis=eq.public&order=created_at.desc&limit=2000').catch(() => []);
    for (const x of r) urls.push({ loc: `${SITE}/p/${encodeURIComponent(x.id)}`, at: x.created_at });
  }
  urls.push({ loc: `${SITE}/privacy` }, { loc: `${SITE}/terms` });
  const seen = new Set();
  const body = urls.filter(u => !seen.has(u.loc) && seen.add(u.loc)).map(u => `<url><loc>${esc(u.loc)}</loc>${u.at ? `<lastmod>${u.at.slice(0, 10)}</lastmod>` : ''}</url>`).join('');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  return res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`);
}

export default async function (req, res) {
  if (req.query.sitemap) return sitemap(res);
  const id = String(req.query.id || '');
  const ok = /^[\w-]{1,40}$/.test(id);
  const p = ok ? await findPoll(id).catch(() => null) : null;

  if (req.query.img) {
    try {
      const png = await image(p);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
      return res.end(png);
    } catch (e) {
      console.error('og', e);
      res.statusCode = 302; res.setHeader('Location', '/assets/og.jpg?v=2'); return res.end();
    }
  }

  const target = ok ? `/?p=${encodeURIComponent(id)}` : '/';
  const title = p && !p.secret && p.q ? `${p.q} · 네아니요` : p && p.secret ? '비밀방 투표 · 네아니요' : '네아니요 · 당신은 어느 쪽?';
  const desc = p && !p.secret && p.o.length ? `${p.o.slice(0, 4).join(' vs ')} — 당신은 어느 쪽? 투표하고 결과를 바로 확인해보세요.` : '지금 뜨는 이슈, 한 번에 투표하고 결과를 바로 확인해보세요.';
  const img = p ? `${SITE}/api/share?id=${encodeURIComponent(id)}&img=1&v=${Buffer.from(String(p.q || 's')).toString('base64url').slice(0, 10)}` : `${SITE}/assets/og.jpg?v=2`;
  const url = ok ? `${SITE}/p/${encodeURIComponent(id)}` : SITE;
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="네아니요">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(img)}">
<script>location.replace(${JSON.stringify(target)}+location.hash)</script>
</head><body style="font-family:system-ui,sans-serif;padding:24px"><a href="${esc(target)}">네아니요에서 투표 보기</a></body></html>`;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400');
  res.end(html);
}
