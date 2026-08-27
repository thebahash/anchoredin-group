import webpush from 'web-push';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { groupId, requesterId, requesterName, requestPreview } = req.body;
  if (!groupId) return res.status(400).json({ error: 'Missing groupId' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY;

  webpush.setVapidDetails(
    'mailto:hello@anchoredin.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  try {
    // Get all members with profiles and push subscriptions
    const membersRes = await fetch(
      sbUrl + '/rest/v1/members?group_id=eq.' + groupId + '&select=user_id,profiles(name,phone)',
      { headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } }
    );
    const members = await membersRes.json();

    const subsRes = await fetch(
      sbUrl + '/rest/v1/push_subscriptions?group_id=eq.' + groupId + '&select=user_id,subscription',
      { headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } }
    );
    const subs = await subsRes.json();
    const subsByUser = {};
    (subs || []).forEach(function(s) { subsByUser[s.user_id] = s.subscription; });

    const preview = (requestPreview || '').length > 80
      ? requestPreview.substring(0, 80) + '...'
      : (requestPreview || '');
    const pushTitle = requesterName + ' posted a prayer request';
    const pushBody = preview || 'Open the app to read and pray.';
    const smsBody = requesterName + ' posted a prayer request: "' + preview + '" — pray with them at group.anchoredin.app';

    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom = process.env.TWILIO_PHONE_NUMBER;
    const credentials = Buffer.from(twilioSid + ':' + twilioToken).toString('base64');

    const results = [];

    for (const m of (members || [])) {
      // Skip the requester
      if (m.user_id === requesterId) continue;
      const profile = m.profiles;
      if (!profile) continue;

      // Send push if subscribed
      const sub = subsByUser[m.user_id];
      if (sub) {
        try {
          await webpush.sendNotification(sub, JSON.stringify({
            title: pushTitle,
            body: pushBody,
            tag: 'prayer-' + groupId
          }));
          results.push({ user: m.user_id, method: 'push', status: 'sent' });
        } catch (pushErr) {
          // Subscription may be expired — remove it
          if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
            await fetch(
              sbUrl + '/rest/v1/push_subscriptions?user_id=eq.' + m.user_id + '&group_id=eq.' + groupId,
              { method: 'DELETE', headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } }
            );
          }
          results.push({ user: m.user_id, method: 'push', status: 'failed', error: pushErr.message });
        }
      }

      // Also send SMS if they have a phone (belt + suspenders for now)
      if (profile.phone && twilioSid) {
        const formData = new URLSearchParams();
        formData.append('To', profile.phone);
        formData.append('From', twilioFrom);
        formData.append('Body', smsBody);
        const smsRes = await fetch(
          'https://api.twilio.com/2010-04-01/Accounts/' + twilioSid + '/Messages.json',
          {
            method: 'POST',
            headers: { 'Authorization': 'Basic ' + credentials, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString()
          }
        );
        const smsData = await smsRes.json();
        results.push({ user: m.user_id, method: 'sms', sid: smsData.sid, status: smsData.status });
      }
    }

    res.json({ sent: results.length, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
