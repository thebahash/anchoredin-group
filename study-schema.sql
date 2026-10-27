-- ─────────────────────────────────────────────────────────────────────────────
-- Study tab — tables, access rules, helper functions
-- Run once in the Supabase SQL Editor (after rls-policies.sql). Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- One row per study week
CREATE TABLE IF NOT EXISTS study_sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  series text not null default '',          -- e.g. 'James'
  week_number int not null default 1,
  title text not null,                      -- e.g. 'James 1'
  subtitle text,                            -- e.g. 'Trials, wisdom & the mirror'
  passage_ref text,                         -- e.g. 'James 1:1–27'
  passage_id text,                          -- API.Bible id, e.g. 'JAS.1'
  unlock_at date not null default current_date,
  meets_at date,
  content jsonb not null default '{}'::jsonb, -- { background: [...], words: [...], challenge: {...} }
  notified_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now()
);
CREATE INDEX IF NOT EXISTS study_sessions_group_idx ON study_sessions (group_id, unlock_at);

CREATE TABLE IF NOT EXISTS study_questions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references study_sessions(id) on delete cascade,
  position int not null default 0,
  title text not null default '',
  prompt text not null,
  refs int[] not null default '{}'
);
CREATE INDEX IF NOT EXISTS study_questions_session_idx ON study_questions (session_id, position);

-- Leader-only notes, kept in their own table so members can't read them
CREATE TABLE IF NOT EXISTS study_question_notes (
  question_id uuid primary key references study_questions(id) on delete cascade,
  note text not null
);

CREATE TABLE IF NOT EXISTS study_answers (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references study_questions(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (question_id, user_id)
);

CREATE TABLE IF NOT EXISTS study_answer_hearts (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references study_answers(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  unique (answer_id, user_id)
);

-- "I did this" on the weekly challenge
CREATE TABLE IF NOT EXISTS study_checkins (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references study_sessions(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz default now(),
  unique (session_id, user_id)
);

-- Supabase no longer auto-grants API access to new tables (Oct 30, 2026). No anon access.
GRANT SELECT, INSERT, UPDATE, DELETE ON study_sessions, study_questions, study_question_notes,
  study_answers, study_answer_hearts, study_checkins TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper functions (SECURITY DEFINER bypasses RLS to avoid circular checks)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION study_session_group(sid uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT group_id FROM study_sessions WHERE id = sid;
$$;

CREATE OR REPLACE FUNCTION study_question_group(qid uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT s.group_id FROM study_questions q JOIN study_sessions s ON s.id = q.session_id WHERE q.id = qid;
$$;

CREATE OR REPLACE FUNCTION study_answer_group(aid uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT s.group_id FROM study_answers a
    JOIN study_questions q ON q.id = a.question_id
    JOIN study_sessions s ON s.id = q.session_id
  WHERE a.id = aid;
$$;

CREATE OR REPLACE FUNCTION study_has_answered(qid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM study_answers WHERE question_id = qid AND user_id = auth.uid());
$$;

-- Answer counts per question, visible before you've answered (the answers themselves stay hidden)
CREATE OR REPLACE FUNCTION study_answer_counts(sid uuid)
RETURNS TABLE (question_id uuid, answers bigint)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT q.id, count(a.id)
  FROM study_questions q LEFT JOIN study_answers a ON a.question_id = q.id
  WHERE q.session_id = sid AND is_group_member(study_session_group(sid))
  GROUP BY q.id;
$$;

-- How many members have answered at least one question this week
CREATE OR REPLACE FUNCTION study_session_stats(sid uuid)
RETURNS TABLE (members bigint, answered_members bigint)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT
    (SELECT count(*) FROM members m WHERE m.group_id = study_session_group(sid)),
    (SELECT count(DISTINCT a.user_id) FROM study_answers a
       JOIN study_questions q ON q.id = a.question_id WHERE q.session_id = sid)
  WHERE is_group_member(study_session_group(sid));
$$;

GRANT EXECUTE ON FUNCTION study_session_group(uuid), study_question_group(uuid), study_answer_group(uuid),
  study_has_answered(uuid), study_answer_counts(uuid), study_session_stats(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Row level security
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE study_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_question_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_answer_hearts ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_checkins ENABLE ROW LEVEL SECURITY;

-- study_sessions: members read, leaders write
DROP POLICY IF EXISTS "Members can view study weeks" ON study_sessions;
CREATE POLICY "Members can view study weeks" ON study_sessions FOR SELECT TO authenticated
  USING (is_group_member(group_id));
DROP POLICY IF EXISTS "Leaders can add study weeks" ON study_sessions;
CREATE POLICY "Leaders can add study weeks" ON study_sessions FOR INSERT TO authenticated
  WITH CHECK (is_group_leader(group_id));
DROP POLICY IF EXISTS "Leaders can edit study weeks" ON study_sessions;
CREATE POLICY "Leaders can edit study weeks" ON study_sessions FOR UPDATE TO authenticated
  USING (is_group_leader(group_id)) WITH CHECK (is_group_leader(group_id));
DROP POLICY IF EXISTS "Leaders can delete study weeks" ON study_sessions;
CREATE POLICY "Leaders can delete study weeks" ON study_sessions FOR DELETE TO authenticated
  USING (is_group_leader(group_id));

-- study_questions: members read, leaders write
DROP POLICY IF EXISTS "Members can view study questions" ON study_questions;
CREATE POLICY "Members can view study questions" ON study_questions FOR SELECT TO authenticated
  USING (is_group_member(study_session_group(session_id)));
DROP POLICY IF EXISTS "Leaders can manage study questions" ON study_questions;
CREATE POLICY "Leaders can manage study questions" ON study_questions FOR ALL TO authenticated
  USING (is_group_leader(study_session_group(session_id)))
  WITH CHECK (is_group_leader(study_session_group(session_id)));

-- study_question_notes: leaders only
DROP POLICY IF EXISTS "Leaders can manage question notes" ON study_question_notes;
CREATE POLICY "Leaders can manage question notes" ON study_question_notes FOR ALL TO authenticated
  USING (is_group_leader(study_question_group(question_id)))
  WITH CHECK (is_group_leader(study_question_group(question_id)));

-- study_answers: you see your own; others' only after you've answered (leaders see all)
DROP POLICY IF EXISTS "Members can view answers after answering" ON study_answers;
CREATE POLICY "Members can view answers after answering" ON study_answers FOR SELECT TO authenticated
  USING (
    is_group_member(study_question_group(question_id)) AND (
      user_id = auth.uid()
      OR study_has_answered(question_id)
      OR is_group_leader(study_question_group(question_id))
    )
  );
DROP POLICY IF EXISTS "Members can post answers" ON study_answers;
CREATE POLICY "Members can post answers" ON study_answers FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_group_member(study_question_group(question_id)));
DROP POLICY IF EXISTS "Users can edit their own answers" ON study_answers;
CREATE POLICY "Users can edit their own answers" ON study_answers FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "Users can delete their own answers" ON study_answers;
CREATE POLICY "Users can delete their own answers" ON study_answers FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- study_answer_hearts
DROP POLICY IF EXISTS "Members can view answer hearts" ON study_answer_hearts;
CREATE POLICY "Members can view answer hearts" ON study_answer_hearts FOR SELECT TO authenticated
  USING (is_group_member(study_answer_group(answer_id)));
DROP POLICY IF EXISTS "Members can heart answers" ON study_answer_hearts;
CREATE POLICY "Members can heart answers" ON study_answer_hearts FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_group_member(study_answer_group(answer_id)));
DROP POLICY IF EXISTS "Users can remove their own answer hearts" ON study_answer_hearts;
CREATE POLICY "Users can remove their own answer hearts" ON study_answer_hearts FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- study_checkins
DROP POLICY IF EXISTS "Members can view check-ins" ON study_checkins;
CREATE POLICY "Members can view check-ins" ON study_checkins FOR SELECT TO authenticated
  USING (is_group_member(study_session_group(session_id)));
DROP POLICY IF EXISTS "Members can check in" ON study_checkins;
CREATE POLICY "Members can check in" ON study_checkins FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND is_group_member(study_session_group(session_id)));
DROP POLICY IF EXISTS "Users can remove their own check-ins" ON study_checkins;
CREATE POLICY "Users can remove their own check-ins" ON study_checkins FOR DELETE TO authenticated
  USING (user_id = auth.uid());
