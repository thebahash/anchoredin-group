import webpush from 'web-push';
import { getAuthUserId } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  var userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  var { groupId, name, preview, testimony, requestId } = req.body;
  if (!groupId) return res.status(400).json({ error: 'Missing groupId' });

  var sbUrl = process.env.SUPABASE_URL;
  var sbKey = process.env.SUPABASE_SERVICE_KEY;
  var serviceHeaders = { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey };

  webpush.setVapidDetails(
    'mailto:hello@anchoredin.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  var title = name + "'s prayer was answered! 🙌";
  var body = testimony
    ? '"' + testimony.substring(0, 100) + '"'
    : (preview ? 'God came through for ' + name + '! Open the app to see.' : 'God came through! Open the app.');

  var pushPayload = JSON.stringify({
    title: title,
    body: body,
    tag: 'answered-' + groupId,
    requestId: requestId || null
  });

  var twilioSid = process.env.TWILIO_ACCOUNT_SID;
  var twilioToken = process.env.TWILIO_AUTH_TOKEN;
  var twilioFrom = process.env.TWILIO_PHONE_NUMBER;
  var credentials = Buffer.from(twilioSid + ':' + twilioToken).toString('base64');
  var smsBody = title + (testimony ? ' "' + testimony.substring(0, 80) + '"' : '') + ' — group.anchoredin.app';

  try {
    var [membersRes, subsRes] = await Promise.all([
      fetch(sbUrl + '/rest/v1/members?group_id=eq.' + groupId + '&select=user_id,profiles(name,phone)', { headers: serviceHeaders }),
      fetch(sbUrl + '/rest/v1/push_subscriptions?group_id=eq.' + groupId + '&select=user_id,subscription', { headers: serviceHeaders })
    ]);

    var members = await membersRes.json();
    var subs = await subsRes.json();

    var subsByUser = {};
    (subs || []).forEach(function(s) { subsByUser[s.user_id] = s.subscription; });

    var tasks = (members || [])
      .filter(function(m) { return m.user_id !== userId; })
      .flatMap(function(m) {
        var profile = m.profiles;
        if (!profile) return [];
        var notifications = [];

        var sub = subsByUser[m.user_id];
        if (sub) {
          notifications.push(
            webpush.sendNotification(sub, pushPayload).catch(async function(err) {
              if (err.statusCode === 410 || err.statusCode === 404) {
                await fetch(
                  sbUrl + '/rest/v1/push_subscriptions?user_id=eq.' + m.user_id + '&group_id=eq.' + groupId,
                  { method: 'DELETE', headers: serviceHeaders }
                ).catch(function() {});
              }
            })
          );
        }

        if (profile.phone && twilioSid) {
          var formData = new URLSearchParams();
          formData.append('To', profile.phone);
          formData.append('From', twilioFrom);
          formData.append('Body', smsBody);
          notifications.push(
            fetch('https://api.twilio.com/2010-04-01/Accounts/' + twilioSid + '/Messages.json', {
              method: 'POST',
              headers: { 'Authorization': 'Basic ' + credentials, 'Content-Type': 'application/x-www-form-urlencoded' },
              body: formData.toString()
            }).catch(function() {})
          );
        }

        return notifications;
      });

    await Promise.all(tasks);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
