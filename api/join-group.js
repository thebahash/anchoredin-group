export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { inviteCode, userId } = req.body;
  if (!inviteCode || !userId) return res.status(400).json({ error: 'Missing inviteCode or userId' });

  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY;

  try {
    // Find group by invite code (service key bypasses RLS)
    const groupRes = await fetch(
      sbUrl + '/rest/v1/groups?invite_code=eq.' + inviteCode.toUpperCase() + '&select=*',
      { headers: { 'apikey': sbKey, 'Authorization': 'Bearer ' + sbKey } }
    );
    const groups = await groupRes.json();
    if (!groups || !groups[0]) return res.status(404).json({ error: 'Group not found. Check the code and try again.' });
    const group = groups[0];

    // Upsert membership (no-op if already a member)
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

    res.json({ group: group, membership: membership });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
