// 브라우저가 로그인에 쓸 공개 설정 (anon 키는 공개해도 되는 키)
import { send, configured } from './_lib.js';
export default function (req, res) {
  if (!configured()) return send(res, 200, { enabled: false }, 'public, max-age=60');
  send(res, 200, {
    enabled: true,
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    providers: (process.env.AUTH_PROVIDERS || 'email').split(',').map(s => s.trim()).filter(Boolean),
    demo: process.env.DEMO_VOTES !== 'off' // 정식 오픈 때 DEMO_VOTES=off 로 시험 참여 끄기
  }, 'public, max-age=300');
}
