// 브라우저가 로그인에 쓸 공개 설정 (anon 키는 공개해도 되는 키)
import { send, configured, SUPA_URL } from './_lib.js';
const NAVER_LIVE = false;
export default function (req, res) {
  if (!configured()) return send(res, 200, { enabled: false }, 'public, max-age=60');
  send(res, 200, {
    enabled: true,
    url: SUPA_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    // 카카오·네이버(custom:naver)·구글은 Supabase에 연결 완료(2026-11-24)
    // 네이버는 개발자센터 검수 통과 전이라 관리자·테스터만 로그인 가능 → 통과하면 NAVER_LIVE 를 true 로 (또는 AUTH_PROVIDERS 에 naver)
    providers: ['kakao', 'naver', 'google', 'email'].filter(p => p !== 'naver' || NAVER_LIVE || (process.env.AUTH_PROVIDERS || '').split(',').map(s => s.trim()).includes('naver')),
    kakaoJs: process.env.KAKAO_JS_KEY || '026d98ff118c4e521776d069a11c6cdf', // 카카오 공유용 JavaScript 키 (웹페이지에 공개되는 키, neaniyo.iux.kr 도메인만 허용)
    demo: process.env.DEMO_VOTES !== 'off' // 정식 오픈 때 DEMO_VOTES=off 로 시험 참여 끄기
  }, 'public, max-age=300');
}
