import webpush from 'web-push';
import { notifyMember, twilioConfig } from './_notify.js';
import { getAuthUserId } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { groupId, requesterName, requestPreview, requestId } = req.body;
  if (!groupId) return res.status(400).json({ error: 'Missing groupId' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY;

  webpush.setVapidDetails(
    'mailto:hello@anchoredin.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  try {
    // Fetch members and push subscriptions in parallel
    const [membersRes, subsRes] = await Promise.all([
      fetch(sbUrl + '/rest/v1/members?group_id=eq.' + groupId + '&select=user_id,profiles(name,phone)', {
        headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey }
      }),
      fetch(sbUrl + '/rest/v1/push_subscriptions?group_id=eq.' + groupId + '&select=user_id,subscription', {
        headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey }
      })
    ]);

    const members = await membersRes.json();
    const subs = await subsRes.json();

    const subsByUser = {};
    (subs || []).forEach(function(s) { subsByUser[s.user_id] = s.subscription; });

    const preview = (requestPreview || '').length > 80
      ? requestPreview.substring(0, 80) + '...'
      : (requestPreview || '');
    const pushPayload = JSON.stringify({
      title: requesterName + ' posted a prayer request',
      body: preview || 'Open the app to read and pray.',
      tag: 'prayer-' + groupId,
      requestId: requestId || null
    });
    const smsBody = requesterName + ' posted a prayer request: "' + preview + '" — pray with them at group.anchoredin.app';

    const twilio = twilioConfig();

    // Push first; SMS only if the member has no push or the push fails
    const tasks = (members || [])
      .filter(function(m) { return m.user_id !== userId && m.profiles; })
      .map(function(m) {
        return notifyMember({
          sub: subsByUser[m.user_id],
          phone: m.profiles.phone,
          pushPayload: pushPayload,
          smsBody: smsBody,
          twilio: twilio,
          onExpired: function() {
            return fetch(
              sbUrl + '/rest/v1/push_subscriptions?user_id=eq.' + m.user_id + '&group_id=eq.' + groupId,
              { method: 'DELETE', headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } }
            );
          }
        });
      });

    const results = await Promise.all(tasks);
    res.json({ sent: results.length, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
