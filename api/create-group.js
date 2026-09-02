import { getAuthUserId } from './_auth.js';

function randomCode(len) {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < len; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  var userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  var { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Group name is required' });

  var sbUrl = process.env.SUPABASE_URL;
  var sbKey = process.env.SUPABASE_SERVICE_KEY;
  var headers = {
    'apikey': sbKey,
    'Authorization': 'Bearer ' + sbKey,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  // Generate a unique invite code
  var invite_code = randomCode(6);
  for (var attempt = 0; attempt < 5; attempt++) {
    var checkRes = await fetch(
      sbUrl + '/rest/v1/groups?invite_code=eq.' + invite_code + '&select=id&limit=1',
      { headers: headers }
    );
    var existing = await checkRes.json().catch(function() { return []; });
    if (!existing || existing.length === 0) break;
    invite_code = randomCode(6);
  }

  // Create the group
  var groupRes = await fetch(sbUrl + '/rest/v1/groups', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ name: name.trim(), invite_code: invite_code, created_by: userId })
  });
  var groupData = await groupRes.json().catch(function() { return {}; });
  if (!groupRes.ok) {
    return res.status(500).json({ error: (groupData && groupData.message) || 'Failed to create group' });
  }
  var group = Array.isArray(groupData) ? groupData[0] : groupData;

  // Add creator as leader
  var memRes = await fetch(sbUrl + '/rest/v1/members', {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ group_id: group.id, user_id: userId, role: 'leader' })
  });
  var memData = await memRes.json().catch(function() { return {}; });
  if (!memRes.ok) {
    return res.status(500).json({ error: (memData && memData.message) || 'Failed to add membership' });
  }
  var membership = Array.isArray(memData) ? memData[0] : memData;

  return res.json({ group: group, membership: membership });
}
