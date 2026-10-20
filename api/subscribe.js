import { getAuthUserId } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { groupId, subscription } = req.body;
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'Missing subscription' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY;

  try {
    // Upsert on (user_id, group_id) so re-subscribing replaces the old row
    const r = await fetch(sbUrl + '/rest/v1/push_subscriptions?on_conflict=user_id,group_id', {
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
        subscription: subscription
      })
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error('push_subscriptions upsert failed', r.status, detail);
      return res.status(500).json({ error: 'Could not save subscription', detail: detail });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
