-- 네아니요 Supabase 스키마 (IUX Cloud 공용 프로젝트에 넣을 수 있게 모든 이름에 ny_ 접두사)
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여 넣고 Run.
-- 모든 테이블은 RLS를 켜고 정책을 두지 않는다. 읽기·쓰기는 Vercel /api 함수가
-- service_role 키로만 한다. 브라우저의 anon 키는 로그인(Auth)에만 쓴다.

-- 1. 회원 프로필 (그룹별 결과용)
create table if not exists public.ny_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  gender text check (gender in ('남성','여성','응답 안 함')),
  birth_year int check (birth_year between 1900 and 2100),
  region text,
  edu text,
  stat_consent boolean not null default false,
  notify_results boolean not null default true,   -- 투표 결과 메일
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. 투표 (1인 1표)
-- voter: 로그인 'u:<user id>' / 비로그인 'd:<기기 해시>'
-- choice: vs·사진은 [i], 여러 개 고르기는 [i,j,..], 릴레이는 질문 순서대로 [a0,a1,..]
create table if not exists public.ny_votes (
  poll_id text not null,
  voter text not null,
  user_id uuid references auth.users(id) on delete set null,
  choice smallint[] not null check (cardinality(choice) between 1 and 20),
  relay boolean not null default false,
  gender text, age_band text, region text,          -- 투표 시점 프로필 (그룹별 결과)
  ip_hash text,
  created_at timestamptz not null default now(),
  primary key (poll_id, voter)
);
create index if not exists ny_votes_poll_ip on public.ny_votes (poll_id, ip_hash);
create index if not exists ny_votes_user on public.ny_votes (user_id);

-- 3. 한줄평
create table if not exists public.ny_comments (
  id uuid primary key default gen_random_uuid(),
  poll_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  side smallint not null,
  body text not null check (char_length(body) between 1 and 200),
  status text not null default 'visible' check (status in ('visible','review','hidden')),
  rule text,                                        -- 걸린 운영 규칙 id
  likes int not null default 0,
  reports int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ny_comments_poll on public.ny_comments (poll_id, created_at);

create table if not exists public.ny_comment_likes (
  comment_id uuid references public.ny_comments(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

create table if not exists public.ny_reports (
  id bigint generated always as identity primary key,
  comment_id uuid references public.ny_comments(id) on delete cascade,
  poll_id text,
  reporter uuid references auth.users(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  unique (comment_id, reporter)
);

-- 4. 사용자가 만든 투표
-- vis: public(관리자 승인 후 피드 노출) / link(링크로만) / secret(링크+비밀번호)
create table if not exists public.ny_user_polls (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  vis text not null default 'public' check (vis in ('public','link','secret')),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reject_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ny_user_polls_status on public.ny_user_polls (status, created_at desc);

-- 5. 결과 알림 메일 대기열 (투표 24시간 뒤 결과를 묶어서 보냄)
create table if not exists public.ny_result_alerts (
  user_id uuid references auth.users(id) on delete cascade,
  poll_id text not null,
  send_at timestamptz not null,
  sent_at timestamptz,
  primary key (user_id, poll_id)
);
create index if not exists ny_result_alerts_due on public.ny_result_alerts (send_at) where sent_at is null;

alter table public.ny_profiles      enable row level security;
alter table public.ny_votes         enable row level security;
alter table public.ny_comments      enable row level security;
alter table public.ny_comment_likes enable row level security;
alter table public.ny_reports       enable row level security;
alter table public.ny_user_polls    enable row level security;
alter table public.ny_result_alerts enable row level security;

-- 득표 집계: {"<poll id>": {"n": 투표자 수, "v": [[질문0 보기별 표], [질문1 ...]]}}
-- 릴레이가 아니면 v는 한 줄([[...]])만 쓴다.
create or replace function public.ny_poll_counts(ids text[])
returns jsonb language sql stable security definer set search_path = public as $$
  with picks as (
    select v.poll_id, case when v.relay then (t.ord - 1)::int else 0 end as pos, t.c::int as opt
    from ny_votes v cross join lateral unnest(v.choice) with ordinality as t(c, ord)
    where v.poll_id = any(ids)
  ),
  cells as (select poll_id, pos, opt, count(*)::int as n from picks group by 1, 2, 3),
  rows_ as (
    select poll_id, pos, jsonb_object_agg(opt::text, n) as m from cells group by 1, 2
  ),
  per_poll as (
    select poll_id, jsonb_object_agg(pos::text, m) as v from rows_ group by 1
  ),
  voters as (select poll_id, count(*)::int as n from ny_votes where poll_id = any(ids) group by 1)
  select coalesce(jsonb_object_agg(p.poll_id, jsonb_build_object('n', vt.n, 'v', p.v)), '{}'::jsonb)
  from per_poll p join voters vt using (poll_id);
$$;

-- 한줄평 공감 수를 원자적으로 바꾼다
create or replace function public.ny_bump_comment(cid uuid, d_likes int, d_reports int)
returns public.ny_comments language sql security definer set search_path = public as $$
  update ny_comments set likes = greatest(0, likes + d_likes), reports = reports + d_reports,
    status = case when reports + d_reports >= 3 and status = 'visible' then 'hidden' else status end
  where id = cid returning *;
$$;

revoke all on function public.ny_poll_counts(text[]) from anon, authenticated;
revoke all on function public.ny_bump_comment(uuid, int, int) from anon, authenticated;
