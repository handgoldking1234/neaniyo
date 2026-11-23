// 브라우저가 로그인에 쓸 공개 설정 (anon 키는 공개해도 되는 키)
import { send, configured, SUPA_URL } from './_lib.js';
export default function (req, res) {
  if (!configured()) return send(res, 200, { enabled: false }, 'public, max-age=60');
  send(res, 200, {
    enabled: true,
    url: SUPA_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    // 카카오·구글은 Supabase에 연결 완료(2026-11-24). 네이버 등은 AUTH_PROVIDERS 로 추가
    providers: ['kakao', 'naver', 'google', 'email'].filter(p => ['kakao', 'google', 'email'].includes(p) || (process.env.AUTH_PROVIDERS || '').split(',').map(s => s.trim()).includes(p)),
    kakaoJs: process.env.KAKAO_JS_KEY || '026d98ff118c4e521776d069a11c6cdf', // 카카오 공유용 JavaScript 키 (웹페이지에 공개되는 키, neaniyo.iux.kr 도메인만 허용)
    demo: process.env.DEMO_VOTES !== 'off' // 정식 오픈 때 DEMO_VOTES=off 로 시험 참여 끄기
  }, 'public, max-age=300');
}
