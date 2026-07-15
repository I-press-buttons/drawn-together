-- Drawn Together — schema + row-level security.
-- Paste into the Supabase SQL editor and run once.

create table if not exists public.packs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.packs(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 300),
  rarity text not null default 'common' check (rarity in ('common','uncommon','rare','epic','legendary','mythic')),
  category text not null default 'Custom' check (char_length(category) <= 60),
  created_at timestamptz not null default now()
);

create table if not exists public.marks (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  list text not null check (list in ('favorites','retired')),
  qkey text not null check (char_length(qkey) between 1 and 80),
  primary key (user_id, list, qkey)
);

create table if not exists public.sessions (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.packs enable row level security;
alter table public.questions enable row level security;
alter table public.marks enable row level security;
alter table public.sessions enable row level security;

create policy "own packs" on public.packs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own questions" on public.questions
  for all using (
    exists (select 1 from public.packs p where p.id = pack_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.packs p where p.id = pack_id and p.user_id = auth.uid())
  );

create policy "own marks" on public.marks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own session" on public.sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.pack_shares (
  code text primary key check (code ~ '^[A-Z2-9]{12}$'),
  pack_id uuid not null unique references public.packs(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.pack_shares enable row level security;

create policy "own shares" on public.pack_shares
  for all using (
    exists (select 1 from public.packs p where p.id = pack_id and p.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.packs p where p.id = pack_id and p.user_id = auth.uid())
  );

-- Redeems a share code by copying the shared pack into the caller's account.
-- security definer is the one sanctioned door through RLS: it may read the
-- source pack/questions the caller can't see, and writes the copy as the caller.
create or replace function public.unlock_pack(share_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  src_pack public.packs%rowtype;
  new_pack public.packs%rowtype;
  qs jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to unlock a pack';
  end if;
  share_code := upper(regexp_replace(share_code, '[^A-Za-z0-9]', '', 'g'));
  select p.* into src_pack
    from public.pack_shares s
    join public.packs p on p.id = s.pack_id
    where s.code = share_code;
  if not found then
    raise exception 'That code didn''t match a shared pack';
  end if;
  insert into public.packs (user_id, name, enabled)
    values (auth.uid(), src_pack.name, true)
    returning * into new_pack;
  insert into public.questions (pack_id, text, rarity, category)
    select new_pack.id, q.text, q.rarity, q.category
    from public.questions q
    where q.pack_id = src_pack.id
    order by q.created_at;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'text', q.text, 'rarity', q.rarity, 'category', q.category)
           order by q.created_at), '[]'::jsonb)
    into qs
    from public.questions q
    where q.pack_id = new_pack.id;
  return jsonb_build_object(
    'id', new_pack.id, 'name', new_pack.name,
    'enabled', new_pack.enabled, 'questions', qs);
end;
$$;

revoke execute on function public.unlock_pack(text) from public, anon;
grant execute on function public.unlock_pack(text) to authenticated;
