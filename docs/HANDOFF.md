# 네아니요 작업 인수인계 (2026-11-15 기준)

다른 Claude 계정에서 이어 작업할 때 이 파일과 `docs/BACKEND.md`, `data/README.md`부터 읽는다.

## 저장소·배포

| 브랜치 | 용도 |
|---|---|
| `main` | 사이트 본체. push하면 Vercel(프로젝트 `iux-neaniyo`)이 neaniyo.iux.kr로 배포 |
| `feed` | 자동 수집 투표 `data/polls.json`. 배포 안 됨, 사이트가 GitHub raw에서 10분마다 읽음 |
| `backend` | Supabase 연결 작업 브랜치. 2026-11-15에 main으로 합침 |

- 사이트는 단일 `index.html`(+ `admin.html`), 서버는 Vercel 함수 `api/*.js`(의존성 없음, Node 18+, ESM).
- 커밋 작성자: `handgoldking1234 <handgoldking1234@users.noreply.github.com>`

## 자동 수집 예약 작업 (피드)

- 3시간마다 실행, 지금부터 3시간 뒤까지 5분 칸을 채워 feed 브랜치에 push.
- 규칙은 `data/README.md` (카테고리 비율, 이슈 찾는 곳, 작성 규칙, 600개 유지).
- 새 계정에서는 예약 작업을 다시 만들어야 한다. 프롬프트 요지: 저장소 클론(feed) → README 읽기 → 빈 칸 계산 → 이슈 검색 → 투표 작성 → python 검증 → `피드 HH:MM~HH:MM (N개)` 커밋·push → 알림.

## 백엔드 현재 상태

| 항목 | 상태 |
|---|---|
| Supabase 프로젝트 | **iux-cloud** (studio.iux.kr·IUX ART와 공용). 테이블·함수는 모두 `ny_` 접두사 |
| `supabase/schema.sql` | iux-cloud SQL Editor에서 실행 완료 |
| Vercel 환경 변수 (Production) | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`(Legacy JWT 키), `AUTH_PROVIDERS=email`, `SITE_URL`, `HASH_SALT`, `CRON_SECRET` 입력 완료. Preview에는 아직 없음 |
| Supabase Auth Redirect URLs | `https://neaniyo.iux.kr/**`, `https://neaniyo-*.vercel.app/**` 추가하도록 안내함 (사용자 확인 필요) |
| Supabase SMTP | 꺼 둠 → 로그인 메일은 Supabase 기본 메일(시간당 2~3통) |
| 메일 API (`MAIL_*`, `ADMIN_EMAIL`) | 미설정 → 결과 알림·관리자 알림 메일은 안 나감 |
| 배포 | 2026-11-15 main 반영. 실제 Supabase 연결 테스트는 아직 |

## 다음 할 일 (우선순위)

1. **배포 확인**: `https://neaniyo.iux.kr/api/config` 가 `{"enabled":true}` 인지 → 투표 후 `ny_votes`에 행 → 이메일 로그인 → `ny_profiles` 행 → 내 행 `is_admin=true`.
2. **Resend 연결**: iux.kr 도메인 인증(DNS는 Vercel), Supabase SMTP(`smtp.resend.com:465`, user `resend`, pass API 키, 보내는 사람 `IUX <no-reply@iux.kr>`), Vercel에 `MAIL_PROVIDER=resend`, `MAIL_API_KEY`, `MAIL_FROM`, `ADMIN_EMAIL`.
3. **관리자 화면**: `admin.html`에 Supabase 로그인 + `/api/admin` 승인·반려·숨김 탭.
4. **사진 투표 이미지** → Supabase Storage (지금은 jsonb에 data URL, 1.5MB 제한).
5. **그룹별 실제 통계 API** (`ny_votes`의 gender·age_band·region 집계) → 상세 통계 화면 연결.
6. 카카오·Google 로그인: Supabase Providers 켜고 `AUTH_PROVIDERS`에 추가.

## 사용자 작업 방식

- 작업 끝나면 main에 바로 올려 배포하길 원함.
- 응답은 한국어, 순서대로 짧게.
