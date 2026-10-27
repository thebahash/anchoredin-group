import { getAuthUserId } from './_auth.js';

// POST /api/study-import — leader only.
// Body: { groupId, passage?, text?, pdfBase64? }
// Builds one study week as JSON from a source document (pasted text or PDF),
// or drafts one from scratch when only a passage is given.

var UUID_RE = /^[0-9a-f-]{36}$/i;

var SYSTEM_PROMPT = [
  'You prepare one week of a small-group Bible study for a group app.',
  'The group wants depth (meat, not milk): few questions, hard ones, grounded in the original languages and the historical background. Never reading-comprehension questions.',
  '',
  'Return ONLY a JSON object, with no markdown and no other text, in exactly this shape:',
  '{"series":"James","week_number":2,"title":"James 2","subtitle":"short theme, under 6 words","passage_ref":"James 2:1-26","passage_id":"JAS.2",',
  '"background":[{"title":"...","body":"2-3 sentences"}],',
  '"words":[{"greek":"the word in its original script (Greek or Hebrew)","tr":"simple transliteration","gloss":"short meaning","note":"2-3 sentences: what it meant to the first hearers and why it matters here","refs":[2,5]}],',
  '"questions":[{"title":"2-4 word title","prompt":"the question, 2-4 sentences","refs":[3],"leader_note":"one practical tip for the leader"}],',
  '"challenge":{"text":"one concrete thing to do this week","note":"why, tied to the text","ref":8}}',
  '',
  'Rules:',
  '- passage_id uses API.Bible ids: the 3-letter book code, a dot, then the chapter (GEN.1, PSA.51, 1SA.16, JAS.2, 1CO.13). refs are verse numbers within that chapter.',
  '- 3-5 background items, 5-10 word studies, 2-3 questions, 1 challenge.',
  '- Questions: no fact recall. Each one surfaces a tension in the text, draws on a word meaning or background, and ends with a personal question.',
  '- Accuracy matters more than impressiveness. Only state word meanings, numbers and history that are well established. Where scholars disagree, say so briefly. Never invent details.',
  '- When a source document is given, build the week from it: keep its passage, points and good questions, tighten the wording, and fill in missing sections without contradicting it.',
  '- Plain, warm, direct English. Short sentences.'
].join('\n');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const body = req.body || {};
  const groupId = String(body.groupId || '');
  const passage = String(body.passage || '').slice(0, 200);
  const text = String(body.text || '').slice(0, 60000);
  const pdfBase64 = body.pdfBase64 ? String(body.pdfBase64) : '';
  if (!UUID_RE.test(groupId)) return res.status(400).json({ error: 'Missing group' });
  if (!passage && !text && !pdfBase64) return res.status(400).json({ error: 'Add a passage, some text, or a PDF' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY;

  // Leaders only
  const mres = await fetch(sbUrl + '/rest/v1/members?group_id=eq.' + groupId + '&user_id=eq.' + userId + '&select=role', {
    headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey }
  });
  const rows = await mres.json().catch(function() { return []; });
  if (!rows || !rows[0] || rows[0].role !== 'leader') return res.status(403).json({ error: 'Only group leaders can add study weeks' });

  const content = [];
  if (pdfBase64) {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } });
  }
  let ask = '';
  if (passage) ask += 'Passage or topic for this week: ' + passage + '\n\n';
  if (text) ask += 'Source document:\n' + text + '\n\n';
  if (pdfBase64) ask += 'The attached PDF is the source document.\n\n';
  if (!text && !pdfBase64) ask += 'There is no source document. Draft the whole week yourself.\n\n';
  ask += 'Return the JSON object now.';
  content.push({ type: 'text', text: ask });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 6000,
        temperature: 0.4,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: content }]
      })
    });
    const data = await response.json();
    if (!response.ok) return res.status(502).json({ error: (data.error && data.error.message) || 'AI request failed' });

    const raw = (data.content || []).map(function(c) { return c.text || ''; }).join('').trim();
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) return res.status(500).json({ error: 'Could not read the AI response' });

    let week;
    try { week = JSON.parse(raw.slice(start, end + 1)); }
    catch (e) { return res.status(500).json({ error: 'The AI response was not valid JSON' }); }

    week.background = Array.isArray(week.background) ? week.background : [];
    week.words = Array.isArray(week.words) ? week.words : [];
    week.questions = Array.isArray(week.questions) ? week.questions : [];
    week.challenge = week.challenge || null;
    res.json({ week: week });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
