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
