// 공용 도우미: Supabase REST(service_role), 로그인 확인, 메일, 운영 규칙
import crypto from 'node:crypto';

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ANON = process.env.SUPABASE_ANON_KEY || '';
export const SITE = (process.env.SITE_URL || 'https://neaniyo.iux.kr').replace(/\/$/, '');
export const configured = () => !!(URL_ && SERVICE && ANON);

export function send(res, status, body, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache || 'no-store');
  res.end(JSON.stringify(body));
}
export const fail = (res, status, message) => send(res, status, { error: message });

// 같은 사이트에서 온 쓰기 요청만 받는다 (임베드 iframe도 같은 출처)
export function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  const allow = [SITE, ...(process.env.EXTRA_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)];
  return allow.includes(o) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(o);
}

export function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

// PostgREST 호출 (service_role)
export async function db(path, { method = 'GET', body: b, prefer, headers } = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}), ...(headers || {})
    },
    body: b === undefined ? undefined : JSON.stringify(b)
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) { const e = new Error((data && (data.message || data.hint)) || `DB ${r.status}`); e.status = r.status; e.code = data && data.code; throw e; }
  return data;
}
export const rpc = (fn, args) => db(`rpc/${fn}`, { method: 'POST', body: args });

// Authorization: Bearer <access token> → Supabase 사용자 (없으면 null)
export async function authUser(req) {
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!tok) return null;
  const r = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${tok}` } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u : null;
}

export async function adminGetUser(id) {
  const r = await fetch(`${URL_}/auth/v1/admin/users/${id}`, { headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` } });
  return r.ok ? r.json() : null;
}

export const hash = s => crypto.createHash('sha256').update(String(s) + (process.env.HASH_SALT || 'neaniyo')).digest('hex').slice(0, 32);
export function ipOf(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
}

export function ageBand(y) {
  if (!y) return null;
  const a = new Date().getFullYear() - y;
  return a < 20 ? '10대' : a < 30 ? '20대' : a < 40 ? '30대' : a < 50 ? '40대' : a < 60 ? '50대' : '60대 이상';
}

// ===== 메일 =====
// MAIL_PROVIDER: resend(기본) | sendgrid | postmark | webhook
// MAIL_FROM 예: "네아니요 <no-reply@iux.kr>"
export async function mail({ to, subject, html, text }) {
  const from = process.env.MAIL_FROM;
  const key = process.env.MAIL_API_KEY;
  const p = (process.env.MAIL_PROVIDER || 'resend').toLowerCase();
  if (!to || !from || (!key && p !== 'webhook')) return { skipped: true };
  let r;
  if (p === 'resend') {
    r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [].concat(to), subject, html, text })
    });
  } else if (p === 'sendgrid') {
    const m = /<([^>]+)>/.exec(from); const name = from.replace(/<[^>]+>/, '').trim();
    r = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [].concat(to).map(email => ({ email })) }],
        from: { email: m ? m[1] : from, name: name || undefined }, subject,
        content: [...(text ? [{ type: 'text/plain', value: text }] : []), { type: 'text/html', value: html }]
      })
    });
  } else if (p === 'postmark') {
    r = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST', headers: { 'X-Postmark-Server-Token': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ From: from, To: [].concat(to).join(','), Subject: subject, HtmlBody: html, TextBody: text })
    });
  } else {
    r = await fetch(process.env.MAIL_WEBHOOK_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ from, to: [].concat(to), subject, html, text })
    });
  }
  if (!r.ok) console.error('mail failed', p, r.status, await r.text().catch(() => ''));
  return { ok: r.ok };
}
export async function mailAdmin(subject, lines) {
  const to = (process.env.ADMIN_EMAIL || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!to.length) return;
  const text = lines.join('\n');
  await mail({ to, subject: `[네아니요 관리] ${subject}`, text, html: `<div style="font-family:sans-serif;line-height:1.6">${lines.map(esc).join('<br>')}<br><br><a href="${SITE}/admin">관리 화면 열기</a></div>` }).catch(e => console.error(e));
}
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ===== 운영 규칙 (index.html의 modJudge와 같은 규칙) =====
let modCache = { at: 0, mod: null };
export async function moderation() {
  if (modCache.mod && Date.now() - modCache.at < 600000) return modCache.mod;
  for (const u of [
    'https://raw.githubusercontent.com/handgoldking1234/neaniyo/feed/data/moderation.json',
    `${SITE}/data/moderation.json`
  ]) {
    try { const r = await fetch(u); if (r.ok) { const j = await r.json(); if (j && Array.isArray(j.rules)) { modCache = { at: Date.now(), mod: j }; return j; } } } catch {}
  }
  return { rules: [], limits: { minLength: 2, maxLength: 80 } };
}
const norm = s => String(s).toLowerCase().replace(/[\s​.,·_\-~!@#$%^&*()+=[\]{}|\\/:;"'<>?`0-9]/g, '');
export function judge(text, mod, recent = []) {
  const t = String(text || '').trim(), L = (mod && mod.limits) || {}, n = norm(t);
  const mk = (action, rule, name, message) => ({ action, rule, name, message });
  if ([...t].length < (L.minLength || 2)) return mk('block', 'length', '길이', '두 글자 이상 써 주세요.');
  if (L.maxLength && [...t].length > L.maxLength) return mk('block', 'length', '길이', `${L.maxLength}자까지 쓸 수 있어요.`);
  let review = null;
  for (const r of (mod && mod.rules) || []) {
    const hit = (r.words || []).some(w => { const x = norm(w); return x && n.includes(x); }) ||
      (r.patterns || []).some(p => { try { return new RegExp(p, 'iu').test(t); } catch { return false; } });
    if (!hit) continue;
    const v = mk(r.action || 'block', r.id, r.name, r.message || '등록할 수 없는 내용이 있어요.');
    if (v.action === 'block') return v;
    review = review || v;
  }
  const now = Date.now();
  if (L.sameTextBlock && recent.some(c => norm(c.body) === n)) return mk('block', 'same', '같은 글 반복', L.sameTextMessage || '방금 쓴 것과 같은 글이에요.');
  if (L.maxPerMinute && recent.filter(c => now - Date.parse(c.created_at) < 60000).length >= L.maxPerMinute)
    return mk('block', 'rate', '짧은 시간 연속 작성', L.rateMessage || '잠시 후 다시 써 주세요.');
  return review || mk('allow', '', '', '');
}

// 핸들러 감싸기: 설정 누락·예외를 JSON으로 돌려준다
export const handler = fn => async (req, res) => {
  if (!configured()) return fail(res, 503, 'backend-not-configured');
  if (req.method !== 'GET' && !sameOrigin(req)) return fail(res, 403, 'origin');
  try { await fn(req, res); }
  catch (e) { console.error(e); fail(res, e.status && e.status < 500 ? e.status : 500, e.message || 'error'); }
};
