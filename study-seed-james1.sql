-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: James 1 as Week 1 for the "Pinnacle Believers" group.
-- Run once in the Supabase SQL Editor, after study-schema.sql. Skips itself if already added.
-- ─────────────────────────────────────────────────────────────────────────────
DO $seed$
DECLARE
  gid uuid;
  sid uuid;
  qid uuid;
BEGIN
  SELECT id INTO gid FROM groups WHERE name = 'Pinnacle Believers' LIMIT 1;
  IF gid IS NULL THEN
    RAISE NOTICE 'No group named Pinnacle Believers was found. Nothing added.';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM study_sessions WHERE group_id = gid AND passage_id = 'JAS.1') THEN
    RAISE NOTICE 'James 1 is already in this group. Nothing added.';
    RETURN;
  END IF;

  INSERT INTO study_sessions (group_id, series, week_number, title, subtitle, passage_ref, passage_id, unlock_at, content)
  VALUES (gid, 'James', 1, 'James 1', 'Trials, wisdom & the mirror', 'James 1:1–27', 'JAS.1', DATE '2026-10-26', $json${
    "background": [
      { "title": "The author", "body": "James, Jesus' brother (Galatians 1:19). He didn't believe during Jesus' ministry (John 7:5) until the risen Jesus appeared to him (1 Corinthians 15:7). He went on to lead the Jerusalem church (Acts 15), yet he calls himself only a doulos, a slave, and never mentions being family." },
      { "title": "The readers", "body": "\"The twelve tribes in the Dispersion\": Jewish believers living outside Israel. Many were poor, and some were likely scattered by persecution (Acts 8:1; 11:19). This may be one of the earliest New Testament letters." },
      { "title": "The style", "body": "It reads like Proverbs: short and direct, with about 50 commands in 108 verses. It echoes the Sermon on the Mount more than any other letter does." },
      { "title": "How chapter 1 is built", "body": "James links thoughts by repeating words. \"Greetings\" (chairein, v1) flows into \"count it all joy\" (charan, v2), and \"lacking in nothing\" (v4) into \"if any of you lacks wisdom\" (v5). The chapter previews the whole letter: trials, wisdom, rich and poor, the tongue, and doing." }
    ],
    "words": [
      { "greek": "πειρασμός", "tr": "peirasmos", "gloss": "trial · temptation", "note": "One word, two directions. In v2 it is the trial you count as joy (some translations say \"temptations\"). In v13–14 the verb means temptation. God tests to prove you. He never tempts to bring you down.", "refs": [2, 12, 13, 14] },
      { "greek": "δοκίμιον", "tr": "dokimion", "gloss": "testing, proving", "note": "The assayer's word for heating metal to show it is genuine. Its cousin dokimos in v12 means \"approved,\" like a coin that passed the test.", "refs": [3, 12] },
      { "greek": "ὑπομονή", "tr": "hypomonē", "gloss": "steadfastness, endurance", "note": "Literally \"remaining under\": staying put beneath a heavy load instead of wriggling out from under it.", "refs": [3, 4] },
      { "greek": "τέλειος", "tr": "teleios", "gloss": "complete, mature", "note": "Not flawless. It means something that has reached the end it was made for. It returns in v17 (perfect gift) and v25 (perfect law).", "refs": [4, 17, 25] },
      { "greek": "ἁπλῶς · δίψυχος", "tr": "haplōs · dipsychos", "gloss": "single-hearted · two-souled", "note": "God gives haplōs: generously, singly, holding nothing back. The doubter is dipsychos, \"two-souled.\" This is among the earliest known uses of that word, and James may have coined it.", "refs": [5, 8] },
      { "greek": "ἐξελκόμενος · δελεαζόμενος", "tr": "exelkomenos · deleazomenos", "gloss": "dragged out · lured by bait", "note": "Fishing and hunting words. Temptation works like a hook hidden in bait: first the lure, then the pull.", "refs": [14] },
      { "greek": "ἀποκυέω", "tr": "apokyeō", "gloss": "to give birth", "note": "Used only twice in the New Testament, both right here. Desire gives birth to sin, and sin to death (v15). Then God gives birth to us by the word of truth (v18).", "refs": [15, 18] },
      { "greek": "τροπῆς ἀποσκίασμα", "tr": "tropēs aposkiasma", "gloss": "shadow cast by turning", "note": "Astronomy language. The sun, moon and stars God made shift and throw moving shadows. The Father of lights does not change.", "refs": [17] },
      { "greek": "παρακύπτω", "tr": "parakyptō", "gloss": "to stoop and peer in", "note": "The verb for the disciples bending to look into the empty tomb (John 20:5, 11). Compare the quick glance in the mirror in v23–24.", "refs": [23, 24, 25] },
      { "greek": "ἐπισκέπτομαι", "tr": "episkeptomai", "gloss": "to visit, look in on", "note": "The word used when God \"visited\" His people (Luke 1:68). Visiting widows and orphans is doing for them what God did for us.", "refs": [27] }
    ],
    "challenge": {
      "text": "Visit one widow, orphan, or isolated person before we meet again.",
      "note": "\"Visit\" here is episkeptomai, the word used when God visited His people (Luke 1:68). It means looking in on someone and caring for what you find.",
      "ref": 27
    }
  }$json$::jsonb)
  RETURNING id INTO sid;

  INSERT INTO study_questions (session_id, position, title, prompt, refs)
  VALUES (sid, 1, 'Trial or temptation?', $t$James uses one word family for both, so the same circumstance can become either. A job loss can build endurance, or lure you toward bitterness or a shortcut. What decides which way it goes? Think of something hard you're in right now. What is it producing in you?$t$, '{2,13}')
  RETURNING id INTO qid;
  INSERT INTO study_question_notes (question_id, note)
  VALUES (qid, $t$If it stalls, ask for a time a hard season turned into a temptation (bitterness, a shortcut). What tipped it?$t$);

  INSERT INTO study_questions (session_id, position, title, prompt, refs)
  VALUES (sid, 2, 'Two births', $t$In v15 desire conceives and grows quietly until it brings sin, then death. In v18 God brings us to life through His word, with the same verb. What are you letting grow in you right now, through what you take in, dwell on, or excuse? Which birth is it heading toward?$t$, '{15,18}')
  RETURNING id INTO qid;
  INSERT INTO study_question_notes (question_id, note)
  VALUES (qid, $t$Read v15 and v18 aloud back to back before asking. People may jump to "big sins"; the point is slow, quiet growth.$t$);

  INSERT INTO study_questions (session_id, position, title, prompt, refs)
  VALUES (sid, 3, 'The mirror', $t$James says hearing without doing is self-deception (v22). Where have you mistaken knowing, agreeing, or feeling convicted for actually changing? Why might people who love deep Bible study be especially at risk?$t$, '{22,23,24,25}')
  RETURNING id INTO qid;
  INSERT INTO study_question_notes (question_id, note)
  VALUES (qid, $t$Close the discussion here. It applies to the group itself, so give it room before moving to This Week.$t$);

  RAISE NOTICE 'James 1 added as Week 1.';
END
$seed$;
