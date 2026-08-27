-- ─────────────────────────────────────────────
-- ANCHORED IN GROUP — Supabase Schema
-- Run this in the Supabase SQL Editor
-- ─────────────────────────────────────────────

-- 1. PROFILES (extends Supabase auth.users)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  created_at timestamptz default now()
);

-- 2. GROUPS
create table groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique not null,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- 3. MEMBERS (users in a group)
create table members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  role text not null default 'member', -- 'member' | 'leader'
  joined_at timestamptz default now(),
  unique (group_id, user_id)
);

-- 4. REQUESTS (prayer requests)
create table requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  body text not null,
  is_answered boolean not null default false,
  answered_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 5. UPDATES (user-posted updates on a request)
create table request_updates (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references requests(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  body text not null,
  is_praise boolean not null default false,
  created_at timestamptz default now()
);

-- 6. ACKNOWLEDGMENTS (🤲 "I prayed" taps)
create table acknowledgments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references requests(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  unique (request_id, user_id)
);

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────

alter table profiles enable row level security;
alter table groups enable row level security;
alter table members enable row level security;
alter table requests enable row level security;
alter table request_updates enable row level security;
alter table acknowledgments enable row level security;

-- Profiles: users can read any profile, edit only their own
create policy "profiles_read" on profiles for select using (true);
create policy "profiles_insert" on profiles for insert with check (auth.uid() = id);
create policy "profiles_update" on profiles for update using (auth.uid() = id);

-- Groups: members of the group can read it
create policy "groups_read" on groups for select using (
  exists (select 1 from members where members.group_id = groups.id and members.user_id = auth.uid())
);
create policy "groups_insert" on groups for insert with check (auth.uid() = created_by);

-- Members: group members can see other members
create policy "members_read" on members for select using (
  exists (select 1 from members m2 where m2.group_id = members.group_id and m2.user_id = auth.uid())
);
create policy "members_insert" on members for insert with check (auth.uid() = user_id);

-- Leaders can update member roles
create policy "members_update_leader" on members for update using (
  exists (select 1 from members m2 where m2.group_id = members.group_id and m2.user_id = auth.uid() and m2.role = 'leader')
);

-- Leaders can remove members
create policy "members_delete_leader" on members for delete using (
  auth.uid() = user_id or
  exists (select 1 from members m2 where m2.group_id = members.group_id and m2.user_id = auth.uid() and m2.role = 'leader')
);

-- Requests: group members can read; owner can insert/update/delete
create policy "requests_read" on requests for select using (
  exists (select 1 from members where members.group_id = requests.group_id and members.user_id = auth.uid())
);
create policy "requests_insert" on requests for insert with check (
  auth.uid() = user_id and
  exists (select 1 from members where members.group_id = requests.group_id and members.user_id = auth.uid())
);
create policy "requests_update" on requests for update using (auth.uid() = user_id);
create policy "requests_delete" on requests for delete using (auth.uid() = user_id);

-- Request updates: same group members
create policy "req_updates_read" on request_updates for select using (
  exists (
    select 1 from requests r
    join members m on m.group_id = r.group_id
    where r.id = request_updates.request_id and m.user_id = auth.uid()
  )
);
create policy "req_updates_insert" on request_updates for insert with check (auth.uid() = user_id);

-- Acknowledgments: group members
create policy "acks_read" on acknowledgments for select using (
  exists (
    select 1 from requests r
    join members m on m.group_id = r.group_id
    where r.id = acknowledgments.request_id and m.user_id = auth.uid()
  )
);
create policy "acks_insert" on acknowledgments for insert with check (auth.uid() = user_id);
create policy "acks_delete" on acknowledgments for delete using (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- HELPER: auto-update requests.updated_at
-- ─────────────────────────────────────────────
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger requests_updated_at
  before update on requests
  for each row execute function update_updated_at();

-- ─────────────────────────────────────────────
-- HELPER: generate short invite code
-- ─────────────────────────────────────────────
create or replace function generate_invite_code()
returns text language plpgsql as $$
declare
  code text;
  exists boolean;
begin
  loop
    code := upper(substring(md5(random()::text) from 1 for 6));
    select count(*) > 0 into exists from groups where invite_code = code;
    exit when not exists;
  end loop;
  return code;
end;
$$;
