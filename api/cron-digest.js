import webpush from 'web-push';

// Cron: called Sunday mornings (e.g. 8am via Vercel Cron or external scheduler)
// Sends each group a weekly digest push notification summarizing activity.
export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  const secret = req.headers['x-cron-secret'] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY;

  webpush.setVapidDetails(
    'mailto:hello@anchoredin.app',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch all groups
    const groupsRes = await fetch(sbUrl + '/rest/v1/groups?select=id,name', {
      headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey }
    });
    const groups = await groupsRes.json();

    const summary = [];

    for (const group of (groups || [])) {
      // Count new requests this week
      const newReqRes = await fetch(
        sbUrl + '/rest/v1/requests?group_id=eq.' + group.id +
        '&is_answered=eq.false&created_at=gt.' + weekAgo + '&select=id',
        { headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } }
      );
      const newReqs = await newReqRes.json();

      // Count answered prayers this week
      const answeredRes = await fetch(
        sbUrl + '/rest/v1/requests?group_id=eq.' + group.id +
        '&is_answered=eq.true&updated_at=gt.' + weekAgo + '&select=id',
        { headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } }
      );
      const answered = await answeredRes.json();

      const newCount = (newReqs || []).length;
      const answeredCount = (answered || []).length;

      if (newCount === 0 && answeredCount === 0) continue; // Quiet week — skip

      // Build digest message
      var parts = [];
      if (newCount > 0) parts.push(newCount + ' new request' + (newCount === 1 ? '' : 's'));
      if (answeredCount > 0) parts.push(answeredCount + ' answered prayer' + (answeredCount === 1 ? '' : 's'));
      var body = parts.join(' and ') + ' this week. Open to pray and celebrate with your group.';

      const payload = JSON.stringify({
        title: group.name + ' — Weekly Digest',
        body: body,
        tag: 'digest-' + group.id
      });

      // Get all push subscriptions for this group
      const subsRes = await fetch(
        sbUrl + '/rest/v1/push_subscriptions?group_id=eq.' + group.id + '&select=user_id,subscription',
        { headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } }
      );
      const subs = await subsRes.json();

      for (const s of (subs || [])) {
        try {
          await webpush.sendNotification(s.subscription, payload);
          summary.push({ groupId: group.id, userId: s.user_id, status: 'sent' });
        } catch (err) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await fetch(
              sbUrl + '/rest/v1/push_subscriptions?user_id=eq.' + s.user_id + '&group_id=eq.' + group.id,
              { method: 'DELETE', headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } }
            ).catch(function() {});
          }
          summary.push({ groupId: group.id, userId: s.user_id, status: 'failed' });
        }
      }
    }

    res.json({ groupsProcessed: (groups || []).length, sent: summary.length, summary });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
