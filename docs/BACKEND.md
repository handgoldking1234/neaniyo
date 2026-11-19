# 백엔드 연결 (Supabase + 이메일 + /api)

환경 변수를 넣기 전에는 사이트가 지금처럼 **시안 모드**(브라우저 저장)로 돌아갑니다. 아래 순서대로 설정하면 실제 집계·로그인·한줄평이 켜집니다.

## 구성

| 부분 | 하는 일 |
|---|---|
| Supabase Auth | 이메일 로그인 링크(비밀번호 없음), 선택: 카카오·Google |
| Supabase DB | 투표(1인 1표), 프로필, 한줄평·공감·신고, 사용자 투표, 결과 알림 대기열 |
| Vercel `/api/*` | 브라우저와 DB 사이. service_role 키는 서버에만 있음 |
| 메일 | 로그인 링크는 Supabase가 SMTP로 보냄. 결과 알림·관리자 알림은 `/api`가 메일 API로 보냄 |

| API | 설명 |
|---|---|
| `GET /api/config` | 브라우저용 공개 설정 |
| `GET /api/counts?ids=` | 실제 득표 |
| `POST /api/vote` | 투표 (로그인 없으면 기기 단위, 같은 망 20표 제한) |
| `GET·POST /api/profile` | 내 프로필·투표 기록 |
| `GET·POST /api/comments` | 한줄평 (투표한 회원만, 운영 규칙 자동 적용) |
| `POST /api/comment-action` | 공감·취소·신고 (신고 3회면 자동 숨김) |
| `GET·POST /api/polls` | 사용자 투표. 공개는 승인 후 노출, 링크·비밀방은 바로 |
| `GET·POST /api/admin` | 승인·반려, 한줄평 보이기·숨기기·삭제 (`ny_profiles.is_admin`) |
| `/api/cron/results` | 매일 10:00(KST) 투표 24시간 지난 회원에게 결과 메일 |

## 1. Supabase

새 프로젝트를 만들지 않고 **IUX Cloud(studio.iux.kr이 쓰는 공용 Supabase 프로젝트)**에 넣습니다. 테이블·함수 이름이 모두 `ny_`로 시작해서 다른 서비스 테이블과 겹치지 않습니다. 회원 계정(auth.users)은 IUX 서비스끼리 공유됩니다.

1. IUX Cloud 프로젝트를 엽니다.
2. **SQL Editor**에 `supabase/schema.sql`을 붙여 넣고 Run. 기존 테이블은 건드리지 않습니다.
3. **Authentication → URL Configuration**
   - Site URL은 바꾸지 않습니다 (다른 서비스가 쓰는 값).
   - Redirect URLs에 `https://neaniyo.iux.kr/**`, 미리보기용 `https://neaniyo-*.vercel.app/**` 를 **추가**합니다.
4. **Authentication → Emails → SMTP Settings**: 이미 IUX ART용으로 넣어 둔 SMTP가 있으면 그대로 씁니다. 보내는 이름을 `IUX`처럼 공통으로 두면 네아니요 로그인 메일에도 어색하지 않습니다.
5. (선택) **Authentication → Providers**에서 Kakao·Google을 켜면 버튼이 생깁니다. 켠 것만 `AUTH_PROVIDERS`에 적습니다.
6. 운영자 계정: 사이트에서 한 번 로그인한 뒤 Table Editor → `ny_profiles`에서 내 행의 `is_admin`을 `true`로 바꿉니다.

## 2. Vercel 환경 변수

| 이름 | 값 |
|---|---|
| `SUPABASE_URL` | Project Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | 같은 화면의 anon public 키 |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role 키 (**절대 브라우저·저장소에 넣지 말 것**) |
| `AUTH_PROVIDERS` | `email` 또는 `email,kakao,google` |
| `HASH_SALT` | 아무 긴 임의 문자열 (기기·IP 해시용) |
| `SITE_URL` | `https://neaniyo.iux.kr` |
| `MAIL_PROVIDER` | `resend` · `sendgrid` · `postmark` · `webhook` 중 하나 |
| `MAIL_API_KEY` | 메일 서비스 API 키 |
| `MAIL_FROM` | `네아니요 <no-reply@인증한도메인>` |
| `ADMIN_EMAIL` | 신고·승인 대기 알림 받을 주소 (쉼표로 여러 개) |
| `CRON_SECRET` | 임의 문자열 (Vercel이 크론 호출 때 자동으로 붙임) |
| `VOTE_IP_LIMIT` | (선택) 같은 망에서 한 투표에 받는 최대 표, 기본 20 |

변수를 넣은 뒤 다시 배포해야 적용됩니다.

## 3. 확인

- `https://<도메인>/api/config` 가 `{"enabled":true,...}` 를 돌려주면 연결된 것입니다.
- 투표 → Supabase `ny_votes` 테이블에 행이 생기는지 확인.
- 로그인 → 메일 링크 → 프로필 입력 → `ny_profiles`에 행.

## 아직 남은 것

- 사진 투표의 이미지를 Supabase Storage로 옮기기 (지금은 1.5MB까지 DB에 그대로 저장).

