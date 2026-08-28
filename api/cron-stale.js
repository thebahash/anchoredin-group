import webpush from 'web-push';

// Cron: called daily (e.g. via Vercel Cron or external scheduler)
// Finds requests older than 21 days with no update and nudges the requester.
export default async function handler(req, res) {
  // Allow GET (cron pings) or POST
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();

  // Simple shared secret to prevent unauthenticated calls
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
    // Find requests older than 21 days, not answered, with no updates
    const cutoff = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString();

    const reqRes = await fetch(
      sbUrl + '/rest/v1/requests?is_answered=eq.false&created_at=lt.' + cutoff +
      '&select=id,body,user_id,group_id,profiles(name),request_updates(id)',
      { headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } }
    );
    const requests = await reqRes.json();

    const stale = (requests || []).filter(function(r) {
      return !r.request_updates || r.request_updates.length === 0;
    });

    const results = [];

    for (const r of stale) {
      // Get push subscriptions for this user
      const subsRes = await fetch(
        sbUrl + '/rest/v1/push_subscriptions?user_id=eq.' + r.user_id + '&select=subscription',
        { headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } }
      );
      const subs = await subsRes.json();

      const preview = (r.body || '').length > 60 ? r.body.substring(0, 60) + '...' : (r.body || '');
      const payload = JSON.stringify({
        title: 'Still on your heart?',
        body: 'Your request "' + preview + '" is 3 weeks old. Want to share an update?',
        tag: 'stale-' + r.id,
        requestId: r.id
      });

      for (const s of (subs || [])) {
        try {
          await webpush.sendNotification(s.subscription, payload);
          results.push({ requestId: r.id, status: 'sent' });
        } catch (err) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await fetch(
              sbUrl + '/rest/v1/push_subscriptions?user_id=eq.' + r.user_id,
              { method: 'DELETE', headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } }
            ).catch(function() {});
          }
          results.push({ requestId: r.id, status: 'failed' });
        }
      }
    }

    res.json({ staleFound: stale.length, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
