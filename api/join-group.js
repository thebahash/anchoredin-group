import webpush from 'web-push';
import { getAuthUserId } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { inviteCode } = req.body;
  if (!inviteCode) return res.status(400).json({ error: 'Missing inviteCode' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY;

  try {
    // Find group by invite code
    const groupRes = await fetch(
      sbUrl + '/rest/v1/groups?invite_code=eq.' + inviteCode.toUpperCase() + '&select=*',
      { headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } }
    );
    const groups = await groupRes.json();
    if (!groups || !groups[0]) return res.status(404).json({ error: 'Group not found. Check the code and try again.' });
    const group = groups[0];

    // Check if already a member (so we don't notify on re-joins)
    var existingMemRes = await fetch(
      sbUrl + '/rest/v1/members?group_id=eq.' + group.id + '&user_id=eq.' + userId + '&select=id',
      { headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } }
    );
    var existingMem = await existingMemRes.json().catch(function() { return []; });
    var isNewMember = !existingMem || existingMem.length === 0;

    // Upsert membership
    await fetch(sbUrl + '/rest/v1/members', {
      method: 'POST',
      headers: {
        'apikey': sbKey,
        'Authorization': 'Bearer ' + sbKey,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({ group_id: group.id, user_id: userId, role: 'member' })
    });

    // Fetch the membership row
    const memRes = await fetch(
      sbUrl + '/rest/v1/members?group_id=eq.' + group.id + '&user_id=eq.' + userId + '&select=*',
      { headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } }
    );
    const memData = await memRes.json();
    const membership = memData && memData[0] ? memData[0] : null;

    // Notify existing members before responding (ensures completion in serverless)
    if (isNewMember) {
      await notifyGroupOfNewMember(sbUrl, sbKey, group.id, userId).catch(function() {});
    }

    res.json({ group: group, membership: membership });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function notifyGroupOfNewMember(sbUrl, sbKey, groupId, newUserId) {
  var serviceHeaders = { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey };

  // Get new member's name
  var profileRes = await fetch(
    sbUrl + '/rest/v1/profiles?id=eq.' + newUserId + '&select=name',
    { headers: serviceHeaders }
  );
  var profiles = await profileRes.json().catch(function() { return []; });
  var joinerName = (profiles && profiles[0] && profiles[0].name) ? profiles[0].name : 'Someone';

  webpush.setVapidDetails(
    'mailto:hello@anchoredin.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  var pushPayload = JSON.stringify({
    title: joinerName + ' just joined the group 👋',
    body: 'Say hello and check out the Members tab.',
    tag: 'join-' + groupId
  });

  var twilioSid = process.env.TWILIO_ACCOUNT_SID;
  var twilioToken = process.env.TWILIO_AUTH_TOKEN;
  var twilioFrom = process.env.TWILIO_PHONE_NUMBER;
  var credentials = Buffer.from(twilioSid + ':' + twilioToken).toString('base64');
  var smsBody = joinerName + ' just joined your Anchored In Group! — group.anchoredin.app';

  var [membersRes, subsRes] = await Promise.all([
    fetch(sbUrl + '/rest/v1/members?group_id=eq.' + groupId + '&select=user_id,profiles(name,phone)', { headers: serviceHeaders }),
    fetch(sbUrl + '/rest/v1/push_subscriptions?group_id=eq.' + groupId + '&select=user_id,subscription', { headers: serviceHeaders })
  ]);

  var members = await membersRes.json().catch(function() { return []; });
  var subs = await subsRes.json().catch(function() { return []; });

  var subsByUser = {};
  (subs || []).forEach(function(s) { subsByUser[s.user_id] = s.subscription; });

  var tasks = (members || [])
    .filter(function(m) { return m.user_id !== newUserId; })
    .flatMap(function(m) {
      var profile = m.profiles;
      if (!profile) return [];
      var notifications = [];
      var sub = subsByUser[m.user_id];
      if (sub) {
        notifications.push(webpush.sendNotification(sub, pushPayload).catch(function() {}));
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
}
