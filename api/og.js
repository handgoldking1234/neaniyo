// 링크 미리보기 이미지(1200x630). /api/og?id=투표ID, id 없으면 기본 카드
import { ImageResponse } from '@vercel/og';
import { findPoll } from './_polls.js';

export const config = { runtime: 'edge' };

const A = '#E8336D', B = '#2F5BEA', INK = '#16181D', MUTED = '#6B7280';
const h = (type, style, ...children) => ({ type, props: { style: { display: 'flex', ...style }, children: children.flat().filter(c => c !== null && c !== false && c !== undefined) } });

async function font(text, weight) {
  const css = await fetch('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@' + weight + '&text=' + encodeURIComponent(text)).then(r => r.text());
  const m = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/);
  if (!m) throw new Error('font');
  return fetch(m[1]).then(r => r.arrayBuffer());
}

function logo(size) {
  const r = Math.round(size * 0.28);
  return h('div', { width: size, height: size, borderRadius: r, overflow: 'hidden', position: 'relative' },
    h('div', { width: size / 2, height: size, background: A }),
    h('div', { width: size / 2, height: size, background: B }),
    h('div', { position: 'absolute', left: size * 0.28 - size * 0.13, top: size / 2 - size * 0.13, width: size * 0.26, height: size * 0.26, borderRadius: size, border: `${size * 0.08}px solid #fff` }),
    h('div', { position: 'absolute', left: size * 0.6, top: size * 0.46, width: size * 0.3, height: size * 0.08, background: '#fff', borderRadius: size, transform: 'rotate(45deg)' }),
    h('div', { position: 'absolute', left: size * 0.6, top: size * 0.46, width: size * 0.3, height: size * 0.08, background: '#fff', borderRadius: size, transform: 'rotate(-45deg)' })
  );
}

function card(p) {
  const head = h('div', { alignItems: 'center', gap: 18 },
    logo(64),
    h('div', { fontSize: 40, fontWeight: 800, color: INK }, '네아니요'),
    p ? h('div', { marginLeft: 12, fontSize: 28, fontWeight: 700, color: MUTED, padding: '6px 18px', borderRadius: 999, background: '#F1F2F5' }, p.cat + (p.sub ? ' · ' + p.sub : '')) : null
  );
  if (!p) {
    return h('div', { width: 1200, height: 630, background: '#fff', flexDirection: 'column', justifyContent: 'center', padding: '0 90px', gap: 36 },
      h('div', { alignItems: 'center', gap: 26 }, logo(110), h('div', { fontSize: 92, fontWeight: 800, color: INK }, '네아니요')),
      h('div', { fontSize: 44, fontWeight: 700, color: MUTED }, '실시간 이슈, 한 표로 답하기'),
      h('div', { gap: 0, marginTop: 10, height: 16, borderRadius: 16, overflow: 'hidden', width: 1020 }, h('div', { width: 510, background: A }), h('div', { width: 510, background: B }))
    );
  }
  const q = String(p.q || '');
  const qs = q.length > 30 ? 60 : q.length > 18 ? 70 : 80;
  const opts = (p.o || []).slice(0, 4).map(String);
  let optRow;
  if (p.type === 'vs' || opts.length === 2) {
    optRow = h('div', { alignItems: 'center', width: '100%', gap: 0, position: 'relative' },
      h('div', { flex: 1, height: 120, borderRadius: '24px 0 0 24px', background: '#FCE3EB', color: A, fontSize: 40, fontWeight: 800, alignItems: 'center', justifyContent: 'center', padding: '0 56px 0 30px' }, opts[0] || '네'),
      h('div', { flex: 1, height: 120, borderRadius: '0 24px 24px 0', background: '#E3E9FD', color: B, fontSize: 40, fontWeight: 800, alignItems: 'center', justifyContent: 'center', padding: '0 30px 0 56px' }, opts[1] || '아니요'),
      h('div', { position: 'absolute', left: 520 - 42, top: 18, width: 84, height: 84, borderRadius: 84, background: '#fff', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 800, color: INK }, 'VS')
    );
  } else {
    optRow = h('div', { flexWrap: 'wrap', gap: 16, width: '100%' },
      opts.map((o, i) => h('div', { width: 500, height: 76, borderRadius: 18, background: '#F4F5F8', border: '2px solid #E5E7EB', alignItems: 'center', padding: '0 26px', gap: 16, fontSize: 32, fontWeight: 700, color: INK },
        h('div', { width: 40, height: 40, borderRadius: 40, background: i % 2 ? B : A, color: '#fff', fontSize: 24, alignItems: 'center', justifyContent: 'center' }, String(i + 1)), o))
    );
  }
  return h('div', { width: 1200, height: 630, background: '#fff', flexDirection: 'column', padding: '54px 80px 50px', justifyContent: 'space-between' },
    head,
    h('div', { fontSize: qs, fontWeight: 800, color: INK, lineHeight: 1.25, letterSpacing: -1 }, q),
    optRow,
    h('div', { fontSize: 28, fontWeight: 700, color: MUTED, justifyContent: 'space-between', width: '100%' }, h('div', {}, '투표하고 결과 보기 →'), h('div', {}, 'neaniyo.iux.kr'))
  );
}

function collectText(node, out) {
  if (typeof node === 'string') out.push(node);
  else if (node && node.props) [].concat(node.props.children || []).forEach(c => collectText(c, out));
  return out;
}

export default async function handler(req) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  const p = id ? await findPoll(id, url.origin) : null;
  const el = card(p);
  const text = Array.from(new Set(collectText(el, []).join('') + '0123456789 →·')).join('');
  const [f7, f8] = await Promise.all([font(text, 700), font(text, 800)]);
  return new ImageResponse(el, {
    width: 1200, height: 630,
    fonts: [{ name: 'Noto Sans KR', data: f7, weight: 700 }, { name: 'Noto Sans KR', data: f8, weight: 800 }],
    headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800' }
  });
}
