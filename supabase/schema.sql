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

-- 8. 그룹별(성별·연령·지역·시간대) 실제 통계 (2026-11-19 추가)
-- 반환: {"gender":{"남성":{"n":12,"c":{"0":7,"1":5}}, ...}, "age":{...}, "region":{...}, "time":{...}}
-- n=그 그룹 투표자 수, c=보기별 선택 수(여러 개 고르기는 보기마다 셈). 30명 미만 숨기기는 /api/stats 에서 한다.
create or replace function public.ny_poll_breakdown(pid text)
returns jsonb language sql stable security definer set search_path = public as $$
  with v as (
    select choice, gender, age_band, region,
      case when extract(hour from created_at at time zone 'Asia/Seoul') between 6 and 11 then '오전 6~12시'
           when extract(hour from created_at at time zone 'Asia/Seoul') between 12 and 17 then '오후 12~18시'
           when extract(hour from created_at at time zone 'Asia/Seoul') between 18 and 23 then '저녁 18~24시'
           else '심야 0~6시' end as tband
    from ny_votes where poll_id = pid and not relay
  ), u as (
    select 'gender' dim, gender g, choice from v where gender is not null
    union all select 'age', age_band, choice from v where age_band is not null
    union all select 'region', region, choice from v where region is not null
    union all select 'time', tband, choice from v
  ), n as (select dim, g, count(*) n from u group by 1, 2),
  c as (select dim, g, o, count(*) k from u, unnest(choice) o group by 1, 2, 3),
  gj as (
    select n.dim, n.g, jsonb_build_object('n', n.n, 'c',
      coalesce((select jsonb_object_agg(c.o::text, c.k) from c where c.dim = n.dim and c.g = n.g), '{}'::jsonb)) j
    from n
  )
  select coalesce((select jsonb_object_agg(dim, groups) from (
    select dim, jsonb_object_agg(g, j) groups from gj group by dim) s), '{}'::jsonb);
$$;
revoke all on function public.ny_poll_breakdown(text) from public, anon, authenticated;

-- 9. 관리자 통계 (2026-11-22 추가) — /api/admin?view=stats|members 에서 service role로만 호출
-- 방문은 IUX Cloud 공용 테이블 public.pageviews (site_id='neaniyo', index.html의 trackVisit) 를 읽는다
create or replace function public.ny_admin_stats(days int default 14)
returns jsonb language sql stable security definer set search_path = public as $$
  with rng as (select (date_trunc('day', now() at time zone 'Asia/Seoul') - make_interval(days => greatest(1, least(days, 90)) - 1)) at time zone 'Asia/Seoul' as t0),
  pv as (select * from pageviews, rng where site_id = 'neaniyo' and created_at >= rng.t0),
  ses as (select sid, count(*) n, sum(duration) dur, min(created_at) t, (array_agg(source order by created_at))[1] src,
                 (array_agg(device order by created_at))[1] device, (array_agg(os order by created_at))[1] os,
                 (array_agg(browser order by created_at))[1] browser, (array_agg(screen order by created_at))[1] screen
          from pv group by sid),
  v as (select * from ny_votes, rng where created_at >= rng.t0),
  dd as (select to_char(g at time zone 'Asia/Seoul', 'YYYY-MM-DD') d from rng, generate_series(rng.t0, now(), interval '1 day') g),
  agg as (select k, count(*) v from (select coalesce(nullif(src,''),'direct') k from ses) x group by 1)
  select jsonb_build_object(
    'days', greatest(1, least(days, 90)),
    'visitors', (select count(*) from ses),
    'pageviews', (select count(*) from pv),
    'avg_ms', coalesce((select avg(dur)::bigint from ses where dur is not null), 0),
    'bounce', coalesce((select round(100.0 * count(*) filter (where n = 1) / nullif(count(*), 0), 1) from ses), 0),
    'votes', (select count(*) from v),
    'voters', (select count(distinct voter) from v),
    'member_voters', (select count(distinct user_id) from v where user_id is not null),
    'signups', (select count(*) from ny_profiles, rng where created_at >= rng.t0),
    'members', (select count(*) from ny_profiles),
    'comments', (select count(*) from ny_comments, rng where created_at >= rng.t0),
    'user_polls', (select count(*) from ny_user_polls, rng where created_at >= rng.t0),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('d', dd.d,
        'visitors', (select count(*) from ses where to_char(ses.t at time zone 'Asia/Seoul','YYYY-MM-DD') = dd.d),
        'pageviews', (select count(*) from pv where to_char(pv.created_at at time zone 'Asia/Seoul','YYYY-MM-DD') = dd.d),
        'votes', (select count(*) from v where to_char(v.created_at at time zone 'Asia/Seoul','YYYY-MM-DD') = dd.d),
        'signups', (select count(*) from ny_profiles p where to_char(p.created_at at time zone 'Asia/Seoul','YYYY-MM-DD') = dd.d)
      ) order by dd.d), '[]') from dd),
    'top_polls', (select coalesce(jsonb_agg(jsonb_build_object('id', poll_id, 'v', n) order by n desc), '[]') from
        (select poll_id, count(*) n from v where not relay group by 1 order by 2 desc limit 8) x),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', agg.v) order by agg.v desc), '[]') from agg),
    'refs', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', n) order by n desc), '[]') from
        (select ref_host k, count(distinct sid) n from pv where coalesce(ref_host,'') <> '' group by 1 order by 2 desc limit 10) x),
    'paths', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', n) order by n desc), '[]') from
        (select path k, count(*) n from pv group by 1 order by 2 desc limit 10) x),
    'device', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', n) order by n desc), '[]') from (select coalesce(device,'기타') k, count(*) n from ses group by 1) x),
    'os', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', n) order by n desc), '[]') from (select coalesce(os,'기타') k, count(*) n from ses group by 1) x),
    'browser', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', n) order by n desc), '[]') from (select coalesce(browser,'기타') k, count(*) n from ses group by 1) x),
    'screen', (select coalesce(jsonb_agg(jsonb_build_object('k', k, 'v', n) order by n desc), '[]') from (
        select case when w is null then '알 수 없음' when w < 400 then '작은 폰 (~399)' when w < 768 then '폰 (400~767)' when w < 1280 then '태블릿·작은 PC (768~1279)' else 'PC (1280~)' end k, count(*) n
        from (select nullif(split_part(screen,'x',1),'')::int w from ses where screen ~ '^[0-9]+x[0-9]+$' or screen is null) s group by 1) x)
  );
$$;
revoke all on function public.ny_admin_stats(int) from public, anon, authenticated;

create or replace function public.ny_admin_members(q text default '', lim int default 200)
returns jsonb language sql stable security definer set search_path = public, auth as $$
  select coalesce(jsonb_agg(m order by (m->>'created_at') desc), '[]') from (
    select jsonb_build_object(
      'id', p.id, 'email', u.email, 'created_at', p.created_at, 'last_sign_in', u.last_sign_in_at,
      'gender', p.gender, 'birth_year', p.birth_year, 'region', p.region, 'is_admin', p.is_admin,
      'via', coalesce(u.raw_app_meta_data->>'provider', 'email'),
      'votes', (select count(*) from ny_votes v where v.user_id = p.id),
      'votes7', (select count(*) from ny_votes v where v.user_id = p.id and v.created_at > now() - interval '7 days'),
      'comments', (select count(*) from ny_comments c where c.user_id = p.id),
      'polls', (select count(*) from ny_user_polls up where up.user_id = p.id),
      'banned', u.banned_until is not null and u.banned_until > now()
    ) m
    from ny_profiles p join auth.users u on u.id = p.id
    where coalesce(q,'') = '' or u.email ilike '%' || q || '%' or p.region ilike '%' || q || '%'
    order by p.created_at desc limit greatest(1, least(lim, 500))
  ) x;
$$;
revoke all on function public.ny_admin_members(text, int) from public, anon, authenticated;

-- 10. 투표왕 랭킹: 닉네임(선택)과 공개 동의. 동의한 사람만 닉네임이 보이고 나머지는 '익명'
alter table public.ny_profiles add column if not exists nickname text check (nickname is null or char_length(nickname) between 2 and 10);
alter table public.ny_profiles add column if not exists rank_public boolean not null default false;
create unique index if not exists ny_profiles_nick on public.ny_profiles (lower(nickname)) where nickname is not null;

create or replace function public.ny_top_voters(days int default 7, lim int default 30, me uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with c as (
    select v.user_id, count(*)::int n, max(v.created_at) last_at
    from ny_votes v
    where v.user_id is not null and (days <= 0 or v.created_at >= now() - make_interval(days => days))
    group by v.user_id
  ), r as (
    select c.user_id, c.n, rank() over (order by c.n desc)::int rk,
           row_number() over (order by c.n desc, c.last_at asc) rn,
           case when p.rank_public then p.nickname end nick
    from c left join ny_profiles p on p.id = c.user_id
  ), a as ( -- 등급은 기간과 상관없이 전체 누적 투표 수로 정함
    select v.user_id, count(*)::int t from ny_votes v
    where v.user_id in (select user_id from r where rn <= lim) or v.user_id = me
    group by v.user_id
  )
  select jsonb_build_object(
    'top', coalesce((select jsonb_agg(jsonb_build_object('r', rk, 'name', nick, 'n', n, 't', coalesce(a.t, r.n)) order by rn) from r left join a using (user_id) where rn <= lim), '[]'::jsonb),
    'total', (select count(*) from r),
    'me', (select jsonb_build_object('r', rk, 'n', n) from r where me is not null and user_id = me),
    'myTotal', (select t from a where me is not null and user_id = me)
  );
$$;
revoke all on function public.ny_top_voters(int, int, uuid) from public, anon, authenticated;

-- 11. 인기 출제자: 내가 만든(승인된) 투표가 받은 표. 로그인한 사람 표만, 만든 사람 본인 표는 제외
create or replace function public.ny_top_creators(days int default 7, lim int default 30, me uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with rv as (
    select up.user_id, v.created_at
    from ny_user_polls up join ny_votes v on v.poll_id = up.id
    where up.status = 'approved' and v.user_id is not null and v.user_id <> up.user_id
  ), c as (
    select user_id, count(*)::int n, max(created_at) last_at from rv
    where days <= 0 or created_at >= now() - make_interval(days => days)
    group by user_id
  ), r as (
    select c.user_id, c.n, rank() over (order by c.n desc)::int rk,
           row_number() over (order by c.n desc, c.last_at asc) rn,
           case when p.rank_public then p.nickname end nick
    from c left join ny_profiles p on p.id = c.user_id
  ), a as (
    select user_id, count(*)::int t from rv
    where user_id in (select user_id from r where rn <= lim) or user_id = me
    group by user_id
  )
  select jsonb_build_object(
    'top', coalesce((select jsonb_agg(jsonb_build_object('r', rk, 'name', nick, 'n', n, 't', coalesce(a.t, r.n)) order by rn) from r left join a using (user_id) where rn <= lim), '[]'::jsonb),
    'total', (select count(*) from r),
    'me', (select jsonb_build_object('r', rk, 'n', n) from r where me is not null and user_id = me),
    'myTotal', coalesce((select t from a where me is not null and user_id = me), 0),
    'myPolls', (select count(*)::int from ny_user_polls where me is not null and user_id = me and status = 'approved')
  );
$$;
revoke all on function public.ny_top_creators(int, int, uuid) from public, anon, authenticated;
