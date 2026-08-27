export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { userId, groupId, subscription } = req.body;
  if (!userId || !subscription) return res.status(400).json({ error: 'Missing params' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY;

  try {
    await fetch(sbUrl + '/rest/v1/push_subscriptions', {
      method: 'POST',
      headers: {
        'apikey': sbKey,
        'Authorization': 'Bearer ' + sbKey,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({
        user_id: userId,
        group_id: groupId || null,
        endpoint: subscription.endpoint,
        subscription: subscription
      })
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
