import webpush from 'web-push';
import { getAuthUserId } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { groupId, requesterName, requestPreview } = req.body;
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
      tag: 'prayer-' + groupId
    });
    const smsBody = requesterName + ' posted a prayer request: "' + preview + '" — pray with them at group.anchoredin.app';

    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom = process.env.TWILIO_PHONE_NUMBER;
    const credentials = Buffer.from(twilioSid + ':' + twilioToken).toString('base64');

    // Send all notifications in parallel
    const tasks = (members || [])
      .filter(function(m) { return m.user_id !== userId; })
      .flatMap(function(m) {
        const profile = m.profiles;
        if (!profile) return [];
        const notifications = [];

        // Push notification
        const sub = subsByUser[m.user_id];
        if (sub) {
          notifications.push(
            webpush.sendNotification(sub, pushPayload).catch(async function(err) {
              if (err.statusCode === 410 || err.statusCode === 404) {
                // Expired subscription — clean it up
                await fetch(
                  sbUrl + '/rest/v1/push_subscriptions?user_id=eq.' + m.user_id + '&group_id=eq.' + groupId,
                  { method: 'DELETE', headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } }
                ).catch(function() {});
              }
              return { method: 'push', status: 'failed' };
            }).then(function() { return { method: 'push', status: 'sent' }; })
          );
        }

        // SMS
        if (profile.phone && twilioSid) {
          const formData = new URLSearchParams();
          formData.append('To', profile.phone);
          formData.append('From', twilioFrom);
          formData.append('Body', smsBody);
          notifications.push(
            fetch('https://api.twilio.com/2010-04-01/Accounts/' + twilioSid + '/Messages.json', {
              method: 'POST',
              headers: { 'Authorization': 'Basic ' + credentials, 'Content-Type': 'application/x-www-form-urlencoded' },
              body: formData.toString()
            }).then(function(r) { return r.json(); })
              .then(function(d) { return { method: 'sms', sid: d.sid, status: d.status }; })
              .catch(function(e) { return { method: 'sms', status: 'failed', error: e.message }; })
          );
        }

        return notifications;
      });

    const results = await Promise.all(tasks);
    res.json({ sent: results.length, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
