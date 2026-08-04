create table if not exists public.question_demo_events (
  id bigint generated always as identity primary key,
  session_hash text not null,
  source text not null check (source in ('expo2026', 'conference2026', 'direct')),
  event_type text not null,
  content_id text not null,
  prompt_version text,
  initial_level text check (initial_level is null or initial_level in ('L1','L2','L3')),
  revised_level text check (revised_level is null or revised_level in ('L1','L2','L3')),
  processing_ms integer,
  fallback_used boolean not null default false,
  error_code text,
  resource_id text,
  created_at timestamptz not null default now()
);

comment on table public.question_demo_events is '질문 원문·피드백 원문을 저장하지 않는 익명 UX 이벤트';
revoke all on public.question_demo_events from anon, authenticated;

create index if not exists question_demo_events_created_at_idx on public.question_demo_events (created_at desc);
create index if not exists question_demo_events_source_type_idx on public.question_demo_events (source, event_type);

create table if not exists public.question_demo_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null default now(),
  hits integer not null default 1,
  updated_at timestamptz not null default now()
);
revoke all on public.question_demo_rate_limits from anon, authenticated;

create or replace function public.consume_question_demo_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits integer;
  v_now timestamptz := now();
begin
  insert into public.question_demo_rate_limits(bucket_key, window_started_at, hits, updated_at)
  values (p_bucket_key, v_now, 1, v_now)
  on conflict (bucket_key) do update
  set hits = case
      when question_demo_rate_limits.window_started_at < v_now - make_interval(secs => p_window_seconds) then 1
      else question_demo_rate_limits.hits + 1
    end,
    window_started_at = case
      when question_demo_rate_limits.window_started_at < v_now - make_interval(secs => p_window_seconds) then v_now
      else question_demo_rate_limits.window_started_at
    end,
    updated_at = v_now
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;
revoke all on function public.consume_question_demo_limit(text, integer, integer) from public, anon, authenticated;
