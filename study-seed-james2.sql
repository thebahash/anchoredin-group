-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: James 2 as Week 2 for the "Pinnacle Believers" group.
-- Run once in the Supabase SQL Editor. Skips itself if already added.
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
  IF EXISTS (SELECT 1 FROM study_sessions WHERE group_id = gid AND passage_id = 'JAS.2') THEN
    RAISE NOTICE 'James 2 is already in this group. Nothing added.';
    RETURN;
  END IF;

  INSERT INTO study_sessions (group_id, series, week_number, title, subtitle, passage_ref, passage_id, unlock_at, content)
  VALUES (gid, 'James', 2, 'James 2', 'Faith that shows up', 'James 2:1–26', 'JAS.2', DATE '2026-11-02', $json${
    "background": [
      { "title": "Where they met", "body": "James calls the gathering a synagōgē (v2). It's the only place in the New Testament where that word describes a Christian meeting. Early Jewish believers likely met much like a synagogue, with good seats for some and the floor for others (compare Matthew 23:6)." },
      { "title": "Patrons and clients", "body": "Roman society ran on patronage. A wealthy patron gave protection and favors, and clients repaid him with honor and loyalty. Fussing over a rich visitor (v3) wasn't just snobbery. It was a bid for a powerful friend." },
      { "title": "The rich in James's world", "body": "Many of James's readers were poor laborers. Wealthy landowners could drag debtors into court (v6) and hold back workers' wages (5:4). James asks why the church would honor the very people exploiting it." },
      { "title": "James and Paul", "body": "Paul says we are justified by faith apart from works of the law (Romans 3:28). James says a person is justified by works and not by faith alone (2:24). Both quote Genesis 15:6, but they use words differently. Paul means being declared right with God, and he is fighting the idea that keeping the law earns it. James means being shown to be right, and he is fighting a faith that never acts." }
    ],
    "words": [
      { "greek": "προσωπολημψία", "tr": "prosōpolēmpsia", "gloss": "favoritism, partiality", "note": "Literally \"receiving the face.\" It comes from a Hebrew idiom for judging by appearance. Leviticus 19:15 forbids it just three verses before the \"love your neighbor\" command James quotes in v8. Scripture says God never does it (Deuteronomy 10:17; Romans 2:11).", "refs": [1, 9] },
      { "greek": "χρυσοδακτύλιος", "tr": "chrysodaktylios", "gloss": "gold-fingered", "note": "The rich man is \"gold-fingered,\" maybe wearing several rings. The word appears only here in the New Testament. His \"fine clothing\" is literally \"shining\" clothing, the same phrase Luke uses for the robe Herod's soldiers put on Jesus to mock Him (Luke 23:11).", "refs": [2] },
      { "greek": "ῥυπαρός", "tr": "rhyparos", "gloss": "filthy, grimy", "note": "The poor man's clothes are rhyparos. One chapter earlier James told us to put away all rhyparia, \"filthiness\" (1:21). The real filth isn't on the poor man's coat.", "refs": [2] },
      { "greek": "διακρίνω", "tr": "diakrinō", "gloss": "to make distinctions; to be divided", "note": "\"Have you not made distinctions among yourselves?\" (v4) uses the same verb as the doubter in 1:6, the one who is divided. Favoritism is double-mindedness showing up in the seating chart.", "refs": [4] },
      { "greek": "πτωχός", "tr": "ptōchos", "gloss": "poor, destitute", "note": "Not the working poor but the beggar-poor, people who depend on others to eat. It's the word in \"Blessed are the poor in spirit\" (Matthew 5:3) and in \"has not God chosen those who are poor\" (v5).", "refs": [2, 3, 5, 6] },
      { "greek": "ἕλκω", "tr": "helkō", "gloss": "to drag", "note": "The rich \"drag you into court\" (v6). It's the root of the word for being \"dragged away\" by desire in 1:14.", "refs": [6] },
      { "greek": "νόμος βασιλικός", "tr": "nomos basilikos", "gloss": "the royal law", "note": "\"Love your neighbor as yourself\" (Leviticus 19:18). Royal because it comes from the King, and because Jesus named it, beside loving God, as the greatest command (Mark 12:31).", "refs": [8] },
      { "greek": "φρίσσω", "tr": "phrissō", "gloss": "to shudder, bristle", "note": "Used of hair standing on end in terror, and found only here in the New Testament. The demons agree with the Shema, \"God is one\" (Deuteronomy 6:4), and it makes them shake, not obey.", "refs": [19] },
      { "greek": "ἀργός", "tr": "argos", "gloss": "useless, idle", "note": "From a-ergos, \"without work.\" In v20 James makes a pun: faith without erga (works) is argē (workless). Some manuscripts read \"dead\" here instead.", "refs": [20] },
      { "greek": "δικαιόω", "tr": "dikaioō", "gloss": "to justify; to show to be right", "note": "Abraham was declared righteous in Genesis 15:6. Years later, offering Isaac (Genesis 22), he showed it. James uses the word for the showing, Paul usually for the declaring.", "refs": [21, 24, 25] }
    ],
    "challenge": {
      "text": "Before you write \"praying for you\" on a request this week, ask what one practical need you could meet, and meet it.",
      "note": "James's warning in v15–16 isn't about praying too much. It's about words that cost nothing. Living faith moves toward the need.",
      "ref": 16
    }
  }$json$::jsonb)
  RETURNING id INTO sid;

  INSERT INTO study_questions (session_id, position, title, prompt, refs)
  VALUES (sid, 1, 'Who gets the good seat?', $t$In a culture built on patrons, favoring the rich man wasn't just snobbery. It was a bet on who could help you. James uses the same word for it as for the divided doubter in chapter 1. Who do you naturally move toward in a room, and who do you drift away from? What are you hoping to get from the people you favor?$t$, '{1,2,3,4}')
  RETURNING id INTO qid;
  INSERT INTO study_question_notes (question_id, note)
  VALUES (qid, $t$Keep it concrete: church, work, school pickup, social media. Watch for answers that only name other people's favoritism.$t$);

  INSERT INTO study_questions (session_id, position, title, prompt, refs)
  VALUES (sid, 2, 'Go in peace', $t$James pictures someone telling a cold, hungry brother, "Go in peace, be warmed and filled" (v16). It sounds like a blessing, and it's empty. In a group built around prayer requests, where could "I'll pray for you" become our version of that? What would it look like to pray and also act?$t$, '{14,15,16,17}')
  RETURNING id INTO qid;
  INSERT INTO study_question_notes (question_id, note)
  VALUES (qid, $t$This one hits close for a prayer group. Let it. The point isn't less prayer, it's prayer with hands. Ask if anyone can name a need in the group right now.$t$);

  INSERT INTO study_questions (session_id, position, title, prompt, refs)
  VALUES (sid, 3, 'The patriarch and the prostitute', $t$Read Romans 3:28 next to James 2:24. Both writers quote Genesis 15:6. How can both be true? Then look at James's two examples: Abraham, the father of Israel, and Rahab, a Canaanite prostitute. One was the ultimate insider, the other an outsider, and both acted when it was risky. What do you say you believe that hasn't cost you anything yet?$t$, '{21,23,24,25}')
  RETURNING id INTO qid;
  INSERT INTO study_question_notes (question_id, note)
  VALUES (qid, $t$Don't let this turn into a doctrine debate. Spend about five minutes on Paul and James using the "James and Paul" background note, then land on the last question.$t$);

  RAISE NOTICE 'James 2 added as Week 2.';
END
$seed$;
