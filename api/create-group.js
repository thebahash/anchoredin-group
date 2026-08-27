import { getAuthUserId } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Missing name' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY;

  try {
    // Generate a unique invite code
    let code;
    let attempts = 0;
    while (attempts < 10) {
      code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const checkRes = await fetch(sbUrl + '/rest/v1/groups?invite_code=eq.' + code + '&select=id', {
        headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey }
      });
      const existing = await checkRes.json();
      if (!existing || existing.length === 0) break;
      attempts++;
    }

    // Insert group
    const groupRes = await fetch(sbUrl + '/rest/v1/groups', {
      method: 'POST',
      headers: {
        'apikey': sbKey,
        'Authorization': 'Bearer ' + sbKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ name: name, invite_code: code, created_by: userId })
    });
    const groupData = await groupRes.json();
    if (!groupData || !groupData[0]) return res.status(500).json({ error: 'Failed to create group' });
    const group = groupData[0];

    // Insert member as leader
    await fetch(sbUrl + '/rest/v1/members', {
      method: 'POST',
      headers: {
        'apikey': sbKey,
        'Authorization': 'Bearer ' + sbKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ group_id: group.id, user_id: userId, role: 'leader' })
    });

    // Fetch the membership row
    const memRes = await fetch(
      sbUrl + '/rest/v1/members?group_id=eq.' + group.id + '&user_id=eq.' + userId + '&select=*',
      { headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } }
    );
    const memData = await memRes.json();
    const membership = memData && memData[0] ? memData[0] : null;

    res.json({ group: group, membership: membership });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
