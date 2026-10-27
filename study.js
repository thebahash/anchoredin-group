// ── STUDY TAB ──
// One week at a time: Read, Background, Word study, Discuss, This week.
// Uses globals from index.html: _sb, _user, _group, _membership, esc, avatarHtml, apiHeaders, showErr, showScreen, switchTab.

var _study = { groupId: null, sessions: [], currentId: null, data: null, passages: {}, editing: null };

function stIsLeader() { return !!(_membership && _membership.role === 'leader'); }
function stPad(n) { return (n < 10 ? '0' : '') + n; }
function stToday() { var d = new Date(); return d.getFullYear() + '-' + stPad(d.getMonth() + 1) + '-' + stPad(d.getDate()); }
function stFmt(d) { return d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''; }
function stShort(d) { return d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''; }
function stUnlocked(s) { return s.unlock_at <= stToday(); }
function stSession() { return _study.sessions.find(function(s) { return s.id === _study.currentId; }) || null; }

function stToast(msg) {
  var t = document.getElementById('st-toast');
  if (!t) { t = document.createElement('div'); t.id = 'st-toast'; t.className = 'st-toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(stToast._t); stToast._t = setTimeout(function() { t.classList.remove('show'); }, 2400);
}

function stSetupMissing(err) {
  var msg = ((err && err.message) || '') + ' ' + ((err && err.code) || '');
  return /does not exist|schema cache|PGRST205|42P01/i.test(msg);
}

// ── Load ──
async function loadStudy() {
  var body = document.getElementById('study-body');
  if (_study.groupId !== _group.id) {
    _study = { groupId: _group.id, sessions: [], currentId: null, data: null, passages: _study.passages || {}, editing: null };
  }
  body.innerHTML = '<div class="loading">Loading study...</div>';

  var res = await _sb.from('study_sessions').select('*').eq('group_id', _group.id).order('unlock_at').order('week_number');
  if (res.error) {
    body.innerHTML = '<div class="empty-state"><div class="emoji">📖</div><p>' +
      (stSetupMissing(res.error) ? 'The Study tab needs its one-time database setup before it can be used.' : 'Couldn\'t load the study. Tap refresh to try again.') +
      '</p></div>';
    return;
  }
  _study.sessions = res.data || [];
  if (!_study.sessions.length) { renderStudyEmpty(); return; }

  var current = stSession();
  if (!current) {
    var open = _study.sessions.filter(stUnlocked);
    current = open.length ? open[open.length - 1] : (stIsLeader() ? _study.sessions[0] : null);
  }
  if (!current) {
    _study.currentId = null;
    body.innerHTML = renderStudyChips() + renderStudyLocked(_study.sessions[0]);
    return;
  }
  await openStudySession(current.id);
}

function renderStudyEmpty() {
  var body = document.getElementById('study-body');
  if (stIsLeader()) {
    body.innerHTML = '<div class="empty-state"><div class="emoji">📖</div><p>No study yet.<br>Add the first week. Claude can draft it from a passage, or build it from your notes or a PDF.</p>' +
      '<div style="margin-top:16px;"><button class="btn btn-word" onclick="openStudyEditor()">+ Add the first week</button></div></div>';
  } else {
    body.innerHTML = '<div class="empty-state"><div class="emoji">📖</div><p>No study yet.<br>When your leader adds a week, it will show up here.</p></div>';
  }
}

function renderStudyLocked(s) {
  return '<div class="card" style="text-align:center;padding:28px 16px;">' +
    '<div class="st-eyebrow">' + esc((s.series ? s.series + ' · ' : '') + 'Week ' + s.week_number) + '</div>' +
    '<div class="st-title" style="font-size:24px;margin-top:6px;">Opens ' + esc(stFmt(s.unlock_at)) + '</div>' +
    '<p class="st-muted" style="margin-top:8px;">You\'ll get a notification when it\'s ready.</p></div>';
}

function renderStudyChips() {
  var leader = stIsLeader();
  var html = '<div class="st-weeks" role="tablist" aria-label="Study weeks">';
  _study.sessions.forEach(function(s) {
    var locked = !stUnlocked(s);
    var label = 'Wk ' + s.week_number + ' · ' + (locked && !leader ? 'opens ' + stShort(s.unlock_at) : s.title + (locked ? ' 🔒' : ''));
    var active = s.id === _study.currentId;
    html += '<button class="st-chip' + (active ? ' active' : '') + '" role="tab" aria-selected="' + active + '"' +
      (locked && !leader ? ' disabled' : ' onclick="openStudySession(\'' + s.id + '\')"') + '>' + esc(label) + '</button>';
  });
  if (leader) html += '<button class="st-chip st-chip-add" onclick="openStudyEditor()">+ New week</button>';
  return html + '</div>';
}

async function openStudySession(id) {
  _study.currentId = id;
  _study.editing = null;
  var s = stSession();
  var body = document.getElementById('study-body');
  if (!s) return;
  if (!stUnlocked(s) && !stIsLeader()) { body.innerHTML = renderStudyChips() + renderStudyLocked(s); return; }

  body.innerHTML = renderStudyChips() + '<div class="loading">Loading...</div>';
  var leader = stIsLeader();
  var qres = await _sb.from('study_questions').select('*').eq('session_id', s.id).order('position');
  var questions = qres.data || [];
  var ids = questions.map(function(q) { return q.id; });
  var none = Promise.resolve({ data: [] });

  var results = await Promise.all([
    ids.length ? _sb.from('study_answers').select('*, profiles(name, avatar_url), study_answer_hearts(user_id)').in('question_id', ids).order('created_at') : none,
    _sb.rpc('study_answer_counts', { sid: s.id }),
    _sb.from('study_checkins').select('user_id').eq('session_id', s.id),
    (leader && ids.length) ? _sb.from('study_question_notes').select('*').in('question_id', ids) : none,
    leader ? _sb.rpc('study_session_stats', { sid: s.id }) : none
  ]);
  if (_study.currentId !== id) return; // switched weeks while loading

  var answersByQ = {};
  (results[0].data || []).forEach(function(a) { (answersByQ[a.question_id] = answersByQ[a.question_id] || []).push(a); });
  var counts = {};
  (results[1].data || []).forEach(function(c) { counts[c.question_id] = Number(c.answers) || 0; });
  var notes = {};
  (results[3].data || []).forEach(function(n) { notes[n.question_id] = n.note; });

  _study.data = {
    sessionId: s.id,
    questions: questions,
    answersByQ: answersByQ,
    counts: counts,
    checkins: (results[2].data || []).map(function(c) { return c.user_id; }),
    notes: notes,
    stats: (results[4].data || [])[0] || null
  };
  renderStudySession();
  loadStudyPassage(s);
}

// ── Render ──
function renderStudySession() {
  var s = stSession();
  var d = _study.data;
  if (!s || !d || d.sessionId !== s.id) return;
  var c = s.content || {};
  var html = renderStudyChips() + renderStudyHead(s);

  // Read
  html += '<details class="card st-sec" id="st-read" open><summary><span class="st-sec-label">Read</span>' +
    '<span class="st-sec-count">' + esc(s.passage_ref || s.title) + '</span><span class="st-chev"></span></summary><div class="st-sec-body">';
  if (s.passage_id) {
    html += '<div class="st-read-tools"><div class="st-ref">' + esc(s.passage_ref || s.title) + '</div>' +
      '<button class="btn btn-pray btn-sm" id="st-listen" onclick="studyListen()">Listen</button></div>' +
      '<div class="st-scripture" id="st-scripture"><div class="st-muted">Loading passage...</div></div>' +
      '<button class="st-expand" id="st-expand" onclick="toggleStudyScripture()">Show full chapter</button>' +
      '<div class="st-copyright" id="st-copyright"></div>';
  } else {
    html += '<p class="st-muted">Read ' + esc(s.passage_ref || s.title) + ' in your Bible before you answer.</p>';
  }
  html += '</div></details>';

  // Background
  var bg = c.background || [];
  if (bg.length) {
    html += '<details class="card st-sec"><summary><span class="st-sec-label">Background</span><span class="st-sec-count">' + bg.length +
      '</span><span class="st-chev"></span></summary><div class="st-sec-body"><div class="st-bg-list">' +
      bg.map(function(b) { return '<div class="st-bg-item"><h4>' + esc(b.title) + '</h4><p>' + esc(b.body) + '</p></div>'; }).join('') +
      '</div></div></details>';
  }

  // Word study
  var words = c.words || [];
  if (words.length) {
    html += '<details class="card st-sec" open><summary><span class="st-sec-label">Word study</span><span class="st-sec-count">' + words.length +
      (words.length === 1 ? ' word' : ' words') + '</span><span class="st-chev"></span></summary><div class="st-sec-body"><div class="st-cards" id="st-cards">' +
      words.map(function(w) {
        return '<article class="st-wcard"><div class="st-greek" lang="el">' + esc(w.greek) + '</div>' +
          '<div class="st-translit">' + esc(w.tr) + '</div><div class="st-gloss">' + esc(w.gloss) + '</div>' +
          '<p class="st-wnote">' + esc(w.note) + '</p>' + renderStudyRefChips(w.refs) + '</article>';
      }).join('') + '</div>' +
      (words.length > 1 ? '<div class="st-card-nav"><button class="st-arrow" onclick="studyCardGo(-1)" aria-label="Previous word">&#8249;</button><div class="st-dots" id="st-dots">' +
        words.map(function(_, i) { return '<span class="st-dot' + (i === 0 ? ' on' : '') + '"></span>'; }).join('') +
        '</div><button class="st-arrow" onclick="studyCardGo(1)" aria-label="Next word">&#8250;</button></div>' : '') +
      '</div></details>';
  }

  // Discuss
  if (d.questions.length) {
    html += '<details class="card st-sec" open><summary><span class="st-sec-label">Discuss</span><span class="st-sec-count">' + d.questions.length +
      (d.questions.length === 1 ? ' question' : ' questions') + '</span><span class="st-chev"></span></summary><div class="st-sec-body">';
    if (stIsLeader() && d.stats) {
      html += '<div class="st-summary"><b style="color:var(--navy);">Before group:</b> ' + Number(d.stats.answered_members) + ' of ' +
        Number(d.stats.members) + ' members have answered at least one question.</div>';
    }
    html += d.questions.map(function(q, i) { return renderStudyQuestion(q, i); }).join('') + '</div></details>';
  }

  // This week
  if (c.challenge && c.challenge.text) {
    html += '<details class="card st-sec" open><summary><span class="st-sec-label">This week</span><span class="st-sec-count">' +
      (c.challenge.ref ? 'v' + esc(String(c.challenge.ref)) : '') + '</span><span class="st-chev"></span></summary><div class="st-sec-body">' +
      '<p class="st-challenge">' + esc(c.challenge.text) + '</p>' +
      (c.challenge.note ? '<p class="st-muted">' + esc(c.challenge.note) + '</p>' : '') +
      '<div class="st-row" id="st-checkin">' + renderStudyCheckin() + '</div></div></details>';
  }

  document.getElementById('study-body').innerHTML = html;
  setupStudyCards();
  if (_study.passages[s.passage_id]) renderStudyPassage(s.passage_id);
}

function renderStudyHead(s) {
  var leader = stIsLeader();
  var unlocked = stUnlocked(s);
  var html = '<section class="card st-head"><div>' +
    '<div class="st-eyebrow">' + esc((s.series ? s.series + ' · ' : '') + 'Week ' + s.week_number) + '</div>' +
    '<h2 class="st-title">' + esc(s.title) + '</h2>' +
    (s.subtitle ? '<div class="st-sub">' + esc(s.subtitle) + '</div>' : '') + '</div>' +
    '<div class="st-meta"><span>' + (unlocked ? 'Opened ' : 'Opens ') + esc(stFmt(s.unlock_at)) + '</span>' +
    (s.meets_at ? '<span>Group meets ' + esc(stFmt(s.meets_at)) + '</span>' : '') + '</div>' +
    '<div class="st-progress" id="st-progress">' + renderStudyProgress() + '</div>';
  if (leader) {
    html += '<div class="st-leader-bar"><button class="btn btn-outline btn-sm" onclick="openStudyEditor(\'' + s.id + '\')">Edit week</button>';
    if (!unlocked) html += '<span>Opens ' + esc(stFmt(s.unlock_at)) + '. Notify the group that day.</span>';
    else if (!s.notified_at) html += '<button class="btn btn-word btn-sm" id="st-notify" onclick="notifyStudyWeek(\'' + s.id + '\')">Notify the group</button>';
    else html += '<span>Group notified ' + esc(stShort(String(s.notified_at).slice(0, 10))) + '</span>';
    html += '</div>';
  }
  return html + '</section>';
}

function renderStudyProgress() {
  var d = _study.data;
  if (!d || !d.questions.length) return '';
  var answered = d.questions.filter(function(q) { return stMyAnswer(q.id); }).length;
  var pips = d.questions.map(function(q) { return '<span class="st-pip' + (stMyAnswer(q.id) ? ' on' : '') + '"></span>'; }).join('');
  var s = stSession();
  if (s && s.content && s.content.challenge && s.content.challenge.text) {
    pips += '<span class="st-pip' + (d.checkins.indexOf(_user.id) !== -1 ? ' on' : '') + '"></span>';
  }
  return '<div class="st-pips">' + pips + '</div><span>' + answered + ' of ' + d.questions.length + ' answered</span>';
}

function renderStudyRefChips(refs) {
  refs = (refs || []).map(Number).filter(function(n) { return Number.isFinite(n) && n > 0; });
  if (!refs.length) return '';
  return '<div class="st-refs">' + refs.map(function(r) {
    return '<button class="st-refchip" onclick="studyHighlight([' + r + '])" aria-label="Show verse ' + r + '">v' + r + '</button>';
  }).join('') + '</div>';
}

function stMyAnswer(qid) {
  var list = (_study.data && _study.data.answersByQ[qid]) || [];
  return list.find(function(a) { return a.user_id === _user.id; }) || null;
}

function renderStudyAnswer(a, qid) {
  var mine = a.user_id === _user.id;
  var hearts = a.study_answer_hearts || [];
  var hearted = hearts.some(function(h) { return h.user_id === _user.id; });
  var name = mine ? 'You' : ((a.profiles && a.profiles.name) || 'Member');
  var foot = '<div class="st-ans-foot">';
  if (mine) {
    foot += (hearts.length ? '<span class="st-link">♥ ' + hearts.length + '</span>' : '') +
      '<button class="st-link" onclick="editStudyAnswer(\'' + qid + '\')">Edit</button>';
  } else {
    foot += '<button class="st-link' + (hearted ? ' on' : '') + '" onclick="toggleStudyHeart(\'' + a.id + '\',\'' + qid + '\')" aria-pressed="' + hearted + '">' +
      (hearted ? '♥ ' : '♡ ') + hearts.length + '</button>';
  }
  foot += '</div>';
  return '<div class="st-ans' + (mine ? ' mine' : '') + '">' +
    avatarHtml(a.profiles && a.profiles.name, a.profiles && a.profiles.avatar_url) +
    '<div class="st-ans-name">' + esc(name) + '</div><div class="st-ans-text">' + esc(a.body) + '</div>' + foot + '</div>';
}

function renderStudyQuestion(q, i) {
  var d = _study.data;
  var leader = stIsLeader();
  var answers = d.answersByQ[q.id] || [];
  var mine = stMyAnswer(q.id);
  var others = answers.filter(function(a) { return a.user_id !== _user.id; });
  var count = Math.max(d.counts[q.id] || 0, answers.length);

  var html = '<div class="st-q' + (i === 0 ? ' first' : '') + '" id="sq-' + q.id + '">' +
    '<div class="st-q-title"><span class="st-q-num">' + (i + 1) + '</span><h4>' + esc(q.title) + '</h4></div>' +
    '<p class="st-q-prompt">' + esc(q.prompt) + '</p>' + renderStudyRefChips(q.refs);
  if (leader && d.notes[q.id]) html += '<div class="st-lnote"><b>Leader note:</b> ' + esc(d.notes[q.id]) + '</div>';

  if (mine && _study.editing !== q.id) {
    html += '<div class="st-answers">' + renderStudyAnswer(mine, q.id) + others.map(function(a) { return renderStudyAnswer(a, q.id); }).join('') + '</div>';
  } else {
    var editing = !!(mine && _study.editing === q.id);
    html += '<textarea id="sq-in-' + q.id + '" rows="3" placeholder="Write your answer..." aria-label="Your answer to question ' + (i + 1) + '">' +
      (editing ? esc(mine.body) : '') + '</textarea><div class="st-q-actions">';
    if (editing) {
      html += '<button class="st-link" onclick="cancelStudyEdit()">Cancel</button>' +
        '<button class="btn btn-pray btn-sm" onclick="saveStudyAnswer(\'' + q.id + '\')">Save</button>';
    } else {
      var lockText = count ? '🔒 ' + count + (count === 1 ? ' answer' : ' answers') + ' · post yours to see them' : 'Be the first to answer';
      if (leader && count) lockText = count + (count === 1 ? ' answer' : ' answers') + ' so far';
      html += '<span class="st-muted" style="font-size:12px;">' + lockText + '</span>' +
        '<button class="btn btn-pray btn-sm" id="sq-post-' + q.id + '" onclick="postStudyAnswer(\'' + q.id + '\')">Post answer</button>';
    }
    html += '</div>';
    if (!editing && leader && others.length) {
      html += '<div class="st-answers-label">Leader view: answers so far</div><div class="st-answers">' +
        others.map(function(a) { return renderStudyAnswer(a, q.id); }).join('') + '</div>';
    }
  }
  return html + '</div>';
}

function renderStudyCheckin() {
  var d = _study.data;
  var did = d.checkins.indexOf(_user.id) !== -1;
  var n = d.checkins.length;
  return '<button class="btn ' + (did ? 'btn-prayed' : 'btn-word') + '" onclick="toggleStudyCheckin()" aria-pressed="' + did + '">' +
    (did ? '✓ Done' : 'I did this') + '</button><span class="st-muted" style="font-size:12px;">' +
    (n ? n + (n === 1 ? ' person has' : ' people have') + ' done this' : 'Be the first') + '</span>';
}

function rerenderStudyQuestion(qid) {
  var d = _study.data;
  var i = d.questions.findIndex(function(q) { return q.id === qid; });
  var el = document.getElementById('sq-' + qid);
  if (i === -1 || !el) return;
  el.outerHTML = renderStudyQuestion(d.questions[i], i);
  var p = document.getElementById('st-progress');
  if (p) p.innerHTML = renderStudyProgress();
}

// ── Passage ──
async function loadStudyPassage(s) {
  if (!s.passage_id || _study.passages[s.passage_id]) return;
  try {
    var r = await fetch('/api/passage?id=' + encodeURIComponent(s.passage_id), { headers: await apiHeaders() });
    var data = await r.json();
    if (!r.ok || !data.verses || !data.verses.length) throw new Error(data.error || 'No verses');
    _study.passages[s.passage_id] = data;
  } catch (e) {
    _study.passages[s.passage_id] = { error: true };
  }
  if (_study.currentId === s.id) renderStudyPassage(s.passage_id);
}

function renderStudyPassage(pid) {
  var el = document.getElementById('st-scripture');
  if (!el) return;
  var p = _study.passages[pid];
  var s = stSession();
  if (!p || p.error) {
    el.innerHTML = '<p class="st-muted">Couldn\'t load the passage right now. Open your Bible to ' + esc((s && s.passage_ref) || pid) + '.</p>';
    var ex = document.getElementById('st-expand'); if (ex) ex.style.display = 'none';
    var li = document.getElementById('st-listen'); if (li) li.style.display = 'none';
    return;
  }
  el.innerHTML = p.verses.map(function(v) { return '<span class="st-v" id="st-v' + v.n + '"><sup>' + v.n + '</sup>' + esc(v.text) + ' </span>'; }).join('');
  var cp = document.getElementById('st-copyright');
  if (cp) cp.textContent = p.copyright || '';
}

function toggleStudyScripture() {
  var el = document.getElementById('st-scripture');
  var full = el.classList.toggle('full');
  document.getElementById('st-expand').textContent = full ? 'Show less' : 'Show full chapter';
}

function studyHighlight(refs) {
  var sec = document.getElementById('st-read');
  if (sec) sec.open = true;
  var el = document.getElementById('st-scripture');
  if (!el || !el.querySelector('.st-v')) { stToast('Verse ' + refs.join(', ')); return; }
  el.classList.add('full');
  var ex = document.getElementById('st-expand'); if (ex) ex.textContent = 'Show less';
  document.querySelectorAll('.st-v.hl').forEach(function(v) { v.classList.remove('hl'); });
  refs.forEach(function(r) { var v = document.getElementById('st-v' + r); if (v) v.classList.add('hl'); });
  var first = document.getElementById('st-v' + refs[0]);
  if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(function() { refs.forEach(function(r) { var v = document.getElementById('st-v' + r); if (v) v.classList.remove('hl'); }); }, 3500);
}

function studyListen() {
  var btn = document.getElementById('st-listen');
  var s = stSession();
  var p = s && _study.passages[s.passage_id];
  if (!window.speechSynthesis || !p || !p.verses) { stToast('Listening isn\'t available here'); return; }
  if (speechSynthesis.speaking) { speechSynthesis.cancel(); btn.textContent = 'Listen'; return; }
  var u = new SpeechSynthesisUtterance((s.passage_ref || s.title) + '. ' + p.verses.map(function(v) { return v.text; }).join(' '));
  u.rate = 0.95;
  u.onend = function() { var b = document.getElementById('st-listen'); if (b) b.textContent = 'Listen'; };
  speechSynthesis.speak(u);
  btn.textContent = 'Stop';
}

// ── Word cards ──
function setupStudyCards() {
  var cards = document.getElementById('st-cards');
  if (!cards) return;
  cards.addEventListener('scroll', function() {
    var i = stCurrentCard();
    document.querySelectorAll('#st-dots .st-dot').forEach(function(d, j) { d.classList.toggle('on', j === i); });
  }, { passive: true });
}
function stCurrentCard() {
  var cards = document.getElementById('st-cards');
  var first = cards && cards.querySelector('.st-wcard');
  return first ? Math.round(cards.scrollLeft / (first.offsetWidth + 10)) : 0;
}
function studyCardGo(delta) {
  var cards = document.getElementById('st-cards');
  var first = cards && cards.querySelector('.st-wcard');
  if (!first) return;
  var n = cards.querySelectorAll('.st-wcard').length;
  var i = Math.max(0, Math.min(n - 1, stCurrentCard() + delta));
  cards.scrollTo({ left: i * (first.offsetWidth + 10), behavior: 'smooth' });
}

// ── Actions ──
async function refreshStudyAnswers(qid) {
  var res = await _sb.from('study_answers').select('*, profiles(name, avatar_url), study_answer_hearts(user_id)').eq('question_id', qid).order('created_at');
  if (!res.error) {
    _study.data.answersByQ[qid] = res.data || [];
    _study.data.counts[qid] = Math.max(_study.data.counts[qid] || 0, (res.data || []).length);
  }
  rerenderStudyQuestion(qid);
}

async function postStudyAnswer(qid) {
  var input = document.getElementById('sq-in-' + qid);
  var text = (input.value || '').trim();
  if (!text) { stToast('Write your answer first'); input.focus(); return; }
  var btn = document.getElementById('sq-post-' + qid);
  if (btn) { btn.disabled = true; btn.textContent = 'Posting...'; }
  var res = await _sb.from('study_answers').insert({ question_id: qid, user_id: _user.id, body: text });
  if (res.error) {
    if (btn) { btn.disabled = false; btn.textContent = 'Post answer'; }
    stToast('Couldn\'t post your answer. Try again.');
    return;
  }
  await refreshStudyAnswers(qid);
  stToast('Answer posted');
}

function editStudyAnswer(qid) { _study.editing = qid; rerenderStudyQuestion(qid); var t = document.getElementById('sq-in-' + qid); if (t) t.focus(); }
function cancelStudyEdit() { var qid = _study.editing; _study.editing = null; if (qid) rerenderStudyQuestion(qid); }

async function saveStudyAnswer(qid) {
  var mine = stMyAnswer(qid);
  var text = (document.getElementById('sq-in-' + qid).value || '').trim();
  if (!mine) return;
  if (!text) {
    if (!confirm('Delete your answer?')) return;
    await _sb.from('study_answers').delete().eq('id', mine.id);
  } else {
    var res = await _sb.from('study_answers').update({ body: text, updated_at: new Date().toISOString() }).eq('id', mine.id);
    if (res.error) { stToast('Couldn\'t save. Try again.'); return; }
  }
  _study.editing = null;
  await refreshStudyAnswers(qid);
}

async function toggleStudyHeart(aid, qid) {
  var a = (_study.data.answersByQ[qid] || []).find(function(x) { return x.id === aid; });
  if (!a) return;
  var hearted = (a.study_answer_hearts || []).some(function(h) { return h.user_id === _user.id; });
  if (hearted) await _sb.from('study_answer_hearts').delete().eq('answer_id', aid).eq('user_id', _user.id);
  else await _sb.from('study_answer_hearts').insert({ answer_id: aid, user_id: _user.id });
  await refreshStudyAnswers(qid);
}

async function toggleStudyCheckin() {
  var d = _study.data;
  var did = d.checkins.indexOf(_user.id) !== -1;
  if (did) await _sb.from('study_checkins').delete().eq('session_id', d.sessionId).eq('user_id', _user.id);
  else await _sb.from('study_checkins').insert({ session_id: d.sessionId, user_id: _user.id });
  var res = await _sb.from('study_checkins').select('user_id').eq('session_id', d.sessionId);
  d.checkins = (res.data || []).map(function(c) { return c.user_id; });
  var el = document.getElementById('st-checkin'); if (el) el.innerHTML = renderStudyCheckin();
  var p = document.getElementById('st-progress'); if (p) p.innerHTML = renderStudyProgress();
}

async function sendStudyNotify(sessionId) {
  var r = await fetch('/api/study-notify', { method: 'POST', headers: await apiHeaders(), body: JSON.stringify({ sessionId: sessionId }) });
  var data = await r.json().catch(function() { return {}; });
  if (!r.ok) throw new Error(data.error || 'Couldn\'t notify the group');
  var s = _study.sessions.find(function(x) { return x.id === sessionId; });
  if (s) s.notified_at = new Date().toISOString();
  return data;
}

async function notifyStudyWeek(sessionId) {
  var btn = document.getElementById('st-notify');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
  try {
    await sendStudyNotify(sessionId);
    stToast('Sent to the group');
    renderStudySession();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = 'Notify the group'; }
    stToast(e.message);
  }
}

// ── Leader editor ──
var _stEdit = null;

function stParseRefs(str) {
  var out = [];
  String(str || '').split(/[,\s]+/).forEach(function(part) {
    var m = part.match(/^v?(\d+)(?:[-–](\d+))?$/i);
    if (!m) return;
    var a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a;
    for (var n = a; n <= b && n - a < 60; n++) if (out.indexOf(n) === -1) out.push(n);
  });
  return out;
}

function stBlankQuestion() { return { id: null, title: '', prompt: '', refs: '', note: '' }; }

async function openStudyEditor(sessionId) {
  var existing = sessionId ? _study.sessions.find(function(s) { return s.id === sessionId; }) : null;
  if (existing) {
    var qs = (_study.data && _study.data.sessionId === sessionId) ? _study.data.questions : null;
    if (!qs) { var qr = await _sb.from('study_questions').select('*').eq('session_id', sessionId).order('position'); qs = qr.data || []; }
    var nr = qs.length ? await _sb.from('study_question_notes').select('*').in('question_id', qs.map(function(q) { return q.id; })) : { data: [] };
    var notes = {}; (nr.data || []).forEach(function(n) { notes[n.question_id] = n.note; });
    var c = existing.content || {};
    _stEdit = {
      id: existing.id,
      notified_at: existing.notified_at,
      s: { series: existing.series || '', week_number: String(existing.week_number || 1), title: existing.title || '', subtitle: existing.subtitle || '',
           passage_ref: existing.passage_ref || '', passage_id: existing.passage_id || '', unlock_at: existing.unlock_at || stToday(), meets_at: existing.meets_at || '' },
      background: (c.background || []).map(function(b) { return { title: b.title || '', body: b.body || '' }; }),
      words: (c.words || []).map(function(w) { return { greek: w.greek || '', tr: w.tr || '', gloss: w.gloss || '', note: w.note || '', refs: (w.refs || []).join(', ') }; }),
      questions: qs.map(function(q) { return { id: q.id, title: q.title || '', prompt: q.prompt || '', refs: (q.refs || []).join(', '), note: notes[q.id] || '' }; }),
      origQIds: qs.map(function(q) { return q.id; }),
      challenge: { text: (c.challenge && c.challenge.text) || '', note: (c.challenge && c.challenge.note) || '', ref: (c.challenge && c.challenge.ref) ? String(c.challenge.ref) : '' }
    };
  } else {
    var last = _study.sessions[_study.sessions.length - 1];
    var maxWeek = _study.sessions.reduce(function(m, s) { return Math.max(m, s.week_number || 0); }, 0);
    _stEdit = {
      id: null, notified_at: null,
      s: { series: (last && last.series) || '', week_number: String(maxWeek + 1), title: '', subtitle: '', passage_ref: '', passage_id: '', unlock_at: stToday(), meets_at: '' },
      background: [], words: [], questions: [stBlankQuestion()], origQIds: [],
      challenge: { text: '', note: '', ref: '' }
    };
  }
  document.getElementById('ste-title').textContent = existing ? 'Edit week' : 'New study week';
  renderStudyEditor();
  showScreen('screen-study-edit');
  document.getElementById('ste-body').scrollTop = 0;
}

function steField(label, key, value, opts) {
  opts = opts || {};
  var id = 'ste-f-' + key;
  var attrs = ' id="' + id + '" data-f="' + key + '"';
  var input;
  if (opts.date) input = '<input type="date" class="ste-date"' + attrs + ' value="' + esc(value) + '" />';
  else input = '<input type="' + (opts.num ? 'number' : 'text') + '"' + attrs + ' value="' + esc(value) + '" placeholder="' + esc(opts.ph || '') + '" />';
  return '<div class="form-group"><label class="form-label" for="' + id + '">' + label + '</label>' + input +
    (opts.hint ? '<div class="ste-hint">' + opts.hint + '</div>' : '') + '</div>';
}

function steListField(list, i, key, label, value, opts) {
  opts = opts || {};
  var id = 'ste-' + list + '-' + i + '-' + key;
  var attrs = ' id="' + id + '" data-list="' + list + '" data-i="' + i + '" data-k="' + key + '"';
  var input = opts.area
    ? '<textarea rows="' + (opts.rows || 3) + '"' + attrs + ' placeholder="' + esc(opts.ph || '') + '">' + esc(value) + '</textarea>'
    : '<input type="text"' + attrs + ' value="' + esc(value) + '" placeholder="' + esc(opts.ph || '') + '" />';
  return '<div class="form-group"><label class="form-label" for="' + id + '">' + label + '</label>' + input + '</div>';
}

function renderStudyEditor() {
  var e = _stEdit;
  var html = '';
  if (!e.id) {
    html += '<div class="card"><div class="st-sec-label" style="margin-bottom:6px;">Start with AI (optional)</div>' +
      '<p class="st-muted" style="margin-bottom:12px;">Name a passage and Claude drafts the whole week. Or paste your notes or upload a PDF, and it builds the week from them. You can change everything before saving.</p>' +
      '<div class="form-group"><label class="form-label" for="ste-passage">Passage or topic</label><input type="text" id="ste-passage" placeholder="James 2" /></div>' +
      '<div class="form-group"><label class="form-label" for="ste-text">Your notes or a study to use (optional)</label><textarea id="ste-text" rows="4" placeholder="Paste text here"></textarea></div>' +
      '<div class="form-group"><label class="form-label" for="ste-pdf">Or a PDF (optional, under 3 MB)</label><input type="file" id="ste-pdf" accept="application/pdf" style="font-size:14px;" /></div>' +
      '<button class="btn-gold" id="ste-draft" onclick="draftStudyWeek()">Draft with AI</button>' +
      '<div class="ste-hint" id="ste-draft-status" style="text-align:center;margin-top:8px;"></div></div>';
  }

  html += '<div class="card"><div class="st-sec-label" style="margin-bottom:10px;">The week</div>' +
    '<div class="ste-two">' + steField('Series', 'series', e.s.series, { ph: 'James' }) + steField('Week #', 'week_number', e.s.week_number, { num: true }) + '</div>' +
    steField('Title', 'title', e.s.title, { ph: 'James 2' }) +
    steField('Theme', 'subtitle', e.s.subtitle, { ph: 'Faith that works' }) +
    '<div class="ste-two">' + steField('Passage', 'passage_ref', e.s.passage_ref, { ph: 'James 2:1–26' }) +
    steField('Bible code', 'passage_id', e.s.passage_id, { ph: 'JAS.2', hint: 'Book code + chapter, so the text loads.' }) + '</div>' +
    '<div class="ste-two">' + steField('Opens on', 'unlock_at', e.s.unlock_at, { date: true }) + steField('Group meets', 'meets_at', e.s.meets_at, { date: true }) + '</div></div>';

  html += '<div class="card"><div class="st-sec-label" style="margin-bottom:10px;">Discussion questions</div>';
  e.questions.forEach(function(q, i) {
    html += '<div class="ste-item"><div class="ste-item-head"><span>Question ' + (i + 1) + '</span><button class="st-link danger" onclick="steRemove(\'questions\',' + i + ')">Remove</button></div>' +
      steListField('questions', i, 'title', 'Short title', q.title, { ph: 'Trial or temptation?' }) +
      steListField('questions', i, 'prompt', 'Question', q.prompt, { area: true, rows: 4 }) +
      steListField('questions', i, 'refs', 'Verses', q.refs, { ph: '2, 13' }) +
      steListField('questions', i, 'note', 'Leader note (only leaders see this)', q.note, { area: true, rows: 2 }) + '</div>';
  });
  html += '<button class="ste-add" onclick="steAdd(\'questions\')">+ Add question</button>';
  if (e.origQIds.length) html += '<div class="ste-hint">Removing a question also removes its answers.</div>';
  html += '</div>';

  html += '<div class="card"><div class="st-sec-label" style="margin-bottom:10px;">Word study</div>';
  e.words.forEach(function(w, i) {
    html += '<div class="ste-item"><div class="ste-item-head"><span>Word ' + (i + 1) + '</span><button class="st-link danger" onclick="steRemove(\'words\',' + i + ')">Remove</button></div>' +
      '<div class="ste-two">' + steListField('words', i, 'greek', 'Original word', w.greek, { ph: 'πειρασμός' }) + steListField('words', i, 'tr', 'Say it', w.tr, { ph: 'peirasmos' }) + '</div>' +
      steListField('words', i, 'gloss', 'Meaning', w.gloss, { ph: 'trial · temptation' }) +
      steListField('words', i, 'note', 'Why it matters', w.note, { area: true }) +
      steListField('words', i, 'refs', 'Verses', w.refs, { ph: '2, 12' }) + '</div>';
  });
  html += '<button class="ste-add" onclick="steAdd(\'words\')">+ Add word</button></div>';

  html += '<div class="card"><div class="st-sec-label" style="margin-bottom:10px;">Background</div>';
  e.background.forEach(function(b, i) {
    html += '<div class="ste-item"><div class="ste-item-head"><span>Note ' + (i + 1) + '</span><button class="st-link danger" onclick="steRemove(\'background\',' + i + ')">Remove</button></div>' +
      steListField('background', i, 'title', 'Heading', b.title, { ph: 'The author' }) +
      steListField('background', i, 'body', 'Text', b.body, { area: true }) + '</div>';
  });
  html += '<button class="ste-add" onclick="steAdd(\'background\')">+ Add background</button></div>';

  html += '<div class="card"><div class="st-sec-label" style="margin-bottom:10px;">This week</div>' +
    '<div class="form-group"><label class="form-label" for="ste-c-text">Something to do this week (optional)</label><textarea id="ste-c-text" rows="2" data-c="text">' + esc(e.challenge.text) + '</textarea></div>' +
    '<div class="form-group"><label class="form-label" for="ste-c-note">Why</label><textarea id="ste-c-note" rows="2" data-c="note">' + esc(e.challenge.note) + '</textarea></div>' +
    '<div class="form-group"><label class="form-label" for="ste-c-ref">Verse</label><input type="text" id="ste-c-ref" data-c="ref" value="' + esc(e.challenge.ref) + '" placeholder="27" /></div></div>';

  html += '<div id="ste-error" class="error-msg" style="display:none;"></div>' +
    '<button class="btn-primary" id="ste-save" onclick="saveStudyWeek()">' + (e.id ? 'Save changes' : 'Save week') + '</button>';
  if (e.id) html += '<div style="text-align:center;padding:18px 0 8px;"><button class="st-link danger" onclick="deleteStudyWeek()">Delete this week</button></div>';
  html += '<div style="height:24px;"></div>';

  document.getElementById('ste-body').innerHTML = html;
}

function steOnInput(ev) {
  var t = ev.target;
  if (!_stEdit || !t.closest || !t.closest('#ste-body') || !t.dataset) return;
  if (t.dataset.f) _stEdit.s[t.dataset.f] = t.value;
  else if (t.dataset.list) _stEdit[t.dataset.list][Number(t.dataset.i)][t.dataset.k] = t.value;
  else if (t.dataset.c) _stEdit.challenge[t.dataset.c] = t.value;
}
document.addEventListener('input', steOnInput);
document.addEventListener('change', steOnInput);

function steAdd(list) {
  var blank = { questions: stBlankQuestion(), words: { greek: '', tr: '', gloss: '', note: '', refs: '' }, background: { title: '', body: '' } }[list];
  _stEdit[list].push(blank);
  renderStudyEditor();
}
function steRemove(list, i) { _stEdit[list].splice(i, 1); renderStudyEditor(); }

function stReadPdf(file) {
  return new Promise(function(resolve, reject) {
    var r = new FileReader();
    r.onload = function() { resolve(String(r.result).split(',')[1] || ''); };
    r.onerror = function() { reject(new Error('Couldn\'t read that file')); };
    r.readAsDataURL(file);
  });
}

async function draftStudyWeek() {
  var passage = document.getElementById('ste-passage').value.trim();
  var text = document.getElementById('ste-text').value.trim();
  var file = document.getElementById('ste-pdf').files[0];
  var status = document.getElementById('ste-draft-status');
  var btn = document.getElementById('ste-draft');
  if (!passage && !text && !file) { status.textContent = 'Add a passage, some notes, or a PDF first.'; return; }
  if (file && file.size > 3 * 1024 * 1024) { status.textContent = 'That PDF is over 3 MB. Try a smaller one, or paste the text instead.'; return; }

  btn.disabled = true; btn.textContent = 'Drafting...';
  status.textContent = 'This usually takes 20 to 40 seconds.';
  try {
    var pdfBase64 = file ? await stReadPdf(file) : '';
    var r = await fetch('/api/study-import', {
      method: 'POST', headers: await apiHeaders(),
      body: JSON.stringify({ groupId: _group.id, passage: passage, text: text, pdfBase64: pdfBase64 })
    });
    var data = await r.json().catch(function() { return {}; });
    if (!r.ok || !data.week) throw new Error(data.error || 'The draft didn\'t come through. Try again.');
    var w = data.week;
    var e = _stEdit;
    e.s.series = w.series || e.s.series;
    if (w.week_number) e.s.week_number = String(w.week_number);
    e.s.title = w.title || e.s.title;
    e.s.subtitle = w.subtitle || '';
    e.s.passage_ref = w.passage_ref || '';
    e.s.passage_id = w.passage_id || '';
    e.background = (w.background || []).map(function(b) { return { title: b.title || '', body: b.body || '' }; });
    e.words = (w.words || []).map(function(x) { return { greek: x.greek || '', tr: x.tr || '', gloss: x.gloss || '', note: x.note || '', refs: (x.refs || []).join(', ') }; });
    e.questions = (w.questions || []).map(function(q) { return { id: null, title: q.title || '', prompt: q.prompt || '', refs: (q.refs || []).join(', '), note: q.leader_note || '' }; });
    if (!e.questions.length) e.questions = [stBlankQuestion()];
    e.challenge = { text: (w.challenge && w.challenge.text) || '', note: (w.challenge && w.challenge.note) || '', ref: (w.challenge && w.challenge.ref) ? String(w.challenge.ref) : '' };
    renderStudyEditor();
    stToast('Draft ready. Look it over, then save.');
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Draft with AI';
    status.textContent = err.message;
  }
}

async function saveStudyWeek() {
  var e = _stEdit;
  var errEl = document.getElementById('ste-error');
  errEl.style.display = 'none';
  var s = e.s;
  if (!s.title.trim()) { showErr(errEl, 'Give the week a title.'); return; }
  if (!s.unlock_at) { showErr(errEl, 'Pick the day this week opens.'); return; }
  var questions = e.questions.filter(function(q) { return q.prompt.trim(); });

  var btn = document.getElementById('ste-save');
  btn.disabled = true; btn.textContent = 'Saving...';

  var row = {
    group_id: _group.id,
    series: s.series.trim(),
    week_number: parseInt(s.week_number, 10) || 1,
    title: s.title.trim(),
    subtitle: s.subtitle.trim() || null,
    passage_ref: s.passage_ref.trim() || null,
    passage_id: s.passage_id.trim().toUpperCase() || null,
    unlock_at: s.unlock_at,
    meets_at: s.meets_at || null,
    content: {
      background: e.background.filter(function(b) { return b.title.trim() || b.body.trim(); }).map(function(b) { return { title: b.title.trim(), body: b.body.trim() }; }),
      words: e.words.filter(function(w) { return w.greek.trim() || w.note.trim(); }).map(function(w) {
        return { greek: w.greek.trim(), tr: w.tr.trim(), gloss: w.gloss.trim(), note: w.note.trim(), refs: stParseRefs(w.refs) };
      }),
      challenge: e.challenge.text.trim() ? { text: e.challenge.text.trim(), note: e.challenge.note.trim(), ref: parseInt(e.challenge.ref, 10) || null } : null
    }
  };

  try {
    var sessionId = e.id;
    if (sessionId) {
      var up = await _sb.from('study_sessions').update(row).eq('id', sessionId);
      if (up.error) throw up.error;
    } else {
      row.created_by = _user.id;
      var ins = await _sb.from('study_sessions').insert(row).select('id').single();
      if (ins.error) throw ins.error;
      sessionId = ins.data.id;
      e.id = sessionId;
    }

    var keptIds = [];
    for (var i = 0; i < questions.length; i++) {
      var q = questions[i];
      var qrow = { session_id: sessionId, position: i + 1, title: q.title.trim(), prompt: q.prompt.trim(), refs: stParseRefs(q.refs) };
      var qid = q.id;
      if (qid) {
        var qu = await _sb.from('study_questions').update(qrow).eq('id', qid);
        if (qu.error) throw qu.error;
      } else {
        var qi = await _sb.from('study_questions').insert(qrow).select('id').single();
        if (qi.error) throw qi.error;
        qid = qi.data.id; q.id = qid;
      }
      keptIds.push(qid);
      if (q.note.trim()) await _sb.from('study_question_notes').upsert({ question_id: qid, note: q.note.trim() });
      else await _sb.from('study_question_notes').delete().eq('question_id', qid);
    }
    var removed = e.origQIds.filter(function(id) { return keptIds.indexOf(id) === -1; });
    if (removed.length) await _sb.from('study_questions').delete().in('id', removed);
    e.origQIds = keptIds.slice();

    var openNow = row.unlock_at <= stToday();
    if (openNow && !e.notified_at && confirm('This week is open now. Notify the group?')) {
      try { await sendStudyNotify(sessionId); stToast('Saved and sent to the group'); }
      catch (err) { stToast('Saved, but the notification didn\'t send: ' + err.message); }
    } else {
      stToast('Saved');
    }

    _stEdit = null;
    _study.currentId = sessionId;
    _study.data = null;
    showScreen('screen-main');
    switchTab('study');
  } catch (err) {
    btn.disabled = false; btn.textContent = e.id ? 'Save changes' : 'Save week';
    showErr(errEl, 'Couldn\'t save: ' + (err.message || 'unknown error'));
  }
}

async function deleteStudyWeek() {
  if (!_stEdit || !_stEdit.id) return;
  if (!confirm('Delete this week, including everyone\'s answers? This can\'t be undone.')) return;
  var res = await _sb.from('study_sessions').delete().eq('id', _stEdit.id);
  if (res.error) { stToast('Couldn\'t delete. Try again.'); return; }
  _stEdit = null;
  _study.currentId = null;
  _study.data = null;
  showScreen('screen-main');
  switchTab('study');
  stToast('Week deleted');
}
