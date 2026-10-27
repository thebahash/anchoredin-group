import webpush from 'web-push';
import { getAuthUserId } from './_auth.js';
import { notifyMember, twilioConfig } from './_notify.js';

// POST /api/study-notify { sessionId } — leader only.
// Tells the group a study week is open. Push first, SMS as backup. Marks the week as notified.

var UUID_RE = /^[0-9a-f-]{36}$/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const sessionId = String((req.body || {}).sessionId || '');
  if (!UUID_RE.test(sessionId)) return res.status(400).json({ error: 'Missing study week' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY;
  const headers = { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey };

  webpush.setVapidDetails('mailto:hello@anchoredin.app', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

  try {
    const sres = await fetch(sbUrl + '/rest/v1/study_sessions?id=eq.' + sessionId + '&select=id,group_id,title,subtitle,groups(name)', { headers: headers });
    const sessions = await sres.json();
    const session = sessions && sessions[0];
    if (!session) return res.status(404).json({ error: 'Study week not found' });
    const groupId = session.group_id;

    const [membersRes, subsRes] = await Promise.all([
      fetch(sbUrl + '/rest/v1/members?group_id=eq.' + groupId + '&select=user_id,role,profiles(name,phone)', { headers: headers }),
      fetch(sbUrl + '/rest/v1/push_subscriptions?group_id=eq.' + groupId + '&select=user_id,subscription', { headers: headers })
    ]);
    const members = await membersRes.json();
    const subs = await subsRes.json();

    const me = (members || []).find(function(m) { return m.user_id === userId; });
    if (!me || me.role !== 'leader') return res.status(403).json({ error: 'Only group leaders can notify the group' });

    const subsByUser = {};
    (subs || []).forEach(function(s) { subsByUser[s.user_id] = s.subscription; });

    const groupName = (session.groups && session.groups.name) || 'your group';
    const pushPayload = JSON.stringify({
      title: 'New study week: ' + session.title,
      body: session.subtitle || 'Read and answer this week\'s questions.',
      tag: 'study-' + session.id,
      path: '#study'
    });
    const smsBody = 'New study week in ' + groupName + ': ' + session.title +
      (session.subtitle ? ' (' + session.subtitle + ')' : '') + '. Read and answer at group.anchoredin.app/#study';

    const twilio = twilioConfig();
    const results = await Promise.all((members || [])
      .filter(function(m) { return m.user_id !== userId && m.profiles; })
      .map(function(m) {
        return notifyMember({
          sub: subsByUser[m.user_id],
          phone: m.profiles.phone,
          pushPayload: pushPayload,
          smsBody: smsBody,
          twilio: twilio,
          onExpired: function() {
            return fetch(sbUrl + '/rest/v1/push_subscriptions?user_id=eq.' + m.user_id + '&group_id=eq.' + groupId, { method: 'DELETE', headers: headers });
          }
        });
      }));

    await fetch(sbUrl + '/rest/v1/study_sessions?id=eq.' + sessionId, {
      method: 'PATCH',
      headers: Object.assign({ 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }, headers),
      body: JSON.stringify({ notified_at: new Date().toISOString() })
    });

    res.json({ sent: results.length, results: results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
