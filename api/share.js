// 공유 링크 /p/투표ID : 카카오톡·문자·SNS 미리보기용 메타 태그를 담고, 사람은 바로 투표 화면(/?p=ID)으로 이동
import { findPoll } from './_polls.js';

export const config = { runtime: 'edge' };

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export default async function handler(req) {
  const url = new URL(req.url);
  const id = (url.searchParams.get('p') || '').slice(0, 40);
  const p = await findPoll(id, url.origin);
  const app = url.origin + '/?p=' + encodeURIComponent(id);
  const title = p ? p.q : '네아니요 - 실시간 이슈 투표';
  const opts = p && Array.isArray(p.o) ? p.o : [];
  const desc = p
    ? (opts.length === 2 ? opts[0] + ' vs ' + opts[1] : opts.join(' · ')) + ' · 지금 투표하고 결과를 확인하세요'
    : '실시간 이슈에 한 표로 답하고 결과를 바로 확인하세요.';
  const img = url.origin + '/api/og' + (p ? '?id=' + encodeURIComponent(id) : '');
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p ? title + " - 네아니요" : title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="네아니요">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url.origin + '/p/' + encodeURIComponent(id))}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="canonical" href="${esc(app)}">
<script>location.replace(${JSON.stringify(app)})</script>
</head><body><a href="${esc(app)}">${esc(title)} - 네아니요에서 투표하기</a></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60, s-maxage=300' } });
}
