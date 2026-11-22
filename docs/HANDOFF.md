# 네아니요 작업 인수인계 (2026-11-16 기준)

다른 Claude 계정에서 이어 작업할 때 이 파일 → **`docs/POLICY.md`(운영·기획 결정, 정식 오픈 체크리스트)** → `docs/BACKEND.md` → `data/README.md` 순서로 읽는다.

> 2026-11-18에 Claude 계정을 바꿀 예정. 지금 계정의 예약 작업(피드 자동 수집)은 계정 변경 후 멈추므로 새 계정에서 다시 만들어야 한다(아래 '자동 수집 예약 작업').

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

0. **정식 오픈 전**: `docs/POLICY.md` 1장 체크리스트 — 특히 Vercel `DEMO_VOTES=off`(시험 참여 끄기).

1. **배포 확인**: `https://neaniyo.iux.kr/api/config` 가 `{"enabled":true}` 인지 → 투표 후 `ny_votes`에 행 → 이메일 로그인 → `ny_profiles` 행 → 내 행 `is_admin=true`.
2. **Resend 연결**: iux.kr 도메인 인증(DNS는 Vercel), Supabase SMTP(`smtp.resend.com:465`, user `resend`, pass API 키, 보내는 사람 `IUX <no-reply@iux.kr>`), Vercel에 `MAIL_PROVIDER=resend`, `MAIL_API_KEY`, `MAIL_FROM`, `ADMIN_EMAIL`.
3. **관리자 화면**: `admin.html`에 Supabase 로그인 + `/api/admin` 승인·반려·숨김 탭. 공개 투표는 이제 바로 공개되므로 `recent`(최근 공개) 목록에서 `reject`로 내리는 화면이 필요.
4. **사진 투표 이미지** → Supabase Storage (지금은 jsonb에 data URL, 1.5MB 제한).
5. **그룹별 실제 통계 API** (`ny_votes`의 gender·age_band·region 집계) → 상세 통계 화면 연결.
6. 카카오·Google 로그인: Supabase Providers 켜고 `AUTH_PROVIDERS`에 추가.

## 사용자 작업 방식

- 작업 끝나면 main에 바로 올려 배포하길 원함.
- 응답은 한국어, 순서대로 짧게.

## 2026-11-19 작업 (Claude)

- **그룹별 실제 통계**: Supabase 함수 `ny_poll_breakdown(pid)` (iux-cloud에 적용 완료, `schema.sql` 8장) + `GET /api/stats?id=` (로그인 필요, 30명 미만 그룹은 수치 비공개). 화면은 서버 연결·실제 투표·DEMO 꺼짐일 때만 실제 집계를 쓰고, 그 밖에는 예시 분포. 학력은 투표에 저장하지 않아 실제 통계에서 뺌.
- **관리자 검토 화면**: `admin.html#reports` (검토·신고). 사이트에서 로그인한 세션을 그대로 써서 `/api/admin` 호출 → 승인 대기·최근 공개 투표 공개/반려/내리기, 한줄평 보이기/숨김/삭제.
- **투표별 공유 미리보기**: 공유 링크가 `/p/<id>` 로 바뀜 → `api/share.js`가 og 태그 페이지를 주고 바로 `/?p=<id>`로 이동. 이미지는 `/api/share?id=&img=1` (`@vercel/og`, 글꼴은 Google Fonts Noto Sans KR). 비밀방·예약 전 투표는 제목 비공개. 실패하면 `assets/og.jpg`.
- **개인정보처리방침·이용약관**: `/privacy`, `/terms`. 보호책임자 성명·이메일은 `privacy.html`의 `data-fill` 칸을 채워야 함.
- **회원 탈퇴**: 내 정보 → 회원 탈퇴 (`DELETE /api/profile`). 투표는 계정·프로필과 끊어 집계에만 남김.
- **사진 → Storage**: 사용자 투표 사진(img·gal·imgs의 data URL)을 저장할 때 Supabase Storage 공개 버킷 `ny-poll-images`(iux-cloud에 생성 완료)에 올리고 주소만 DB에 남김.
- Vercel 함수 수: 11개 (Hobby 한도 12).

## 2026-11-22 작업 (Claude)

- **관리자 분석·회원 실제 데이터**: 방문·참여 통계, 유입 경로, 기기·환경, 회원 관리 4개 메뉴가 예시 숫자 대신 실제 값을 보여줌.
  - 방문 기록: IUX Cloud 공용 `public.pageviews` (site_id `neaniyo`, `public.sites`에 등록함). 사이트 `index.html`의 `trackVisit()`이 `rpc/track`·`rpc/track_time` 호출. 탭마다 새 임의 ID, 개인정보 없음. 개인정보처리방침 1항에 '방문 기록' 줄 추가.
  - 집계: `ny_admin_stats(days)`, 회원 목록: `ny_admin_members(q, lim)` (schema.sql 9장, iux-cloud에 적용 완료, service role만 호출).
  - API: `GET /api/admin?view=stats&days=` · `?view=members&q=`, `POST {act: ban|unban|setadmin|unadmin, id}` (정지는 Supabase Auth ban).
  - studio 관리자에도 '네아니요' 사이트가 생겨 같은 방문 통계를 볼 수 있음.
