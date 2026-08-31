import { createClient } from '@supabase/supabase-js';
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

  const userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Group name is required' });

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  // Generate a unique invite code
  var invite_code = randomCode(6);
  var attempts = 0;
  while (attempts < 5) {
    var { data: existing } = await sb.from('groups').select('id').eq('invite_code', invite_code).single();
    if (!existing) break;
    invite_code = randomCode(6);
    attempts++;
  }

  // Create the group
  var { data: group, error: groupErr } = await sb
    .from('groups')
    .insert({ name: name.trim(), invite_code, created_by: userId })
    .select()
    .single();

  if (groupErr) return res.status(500).json({ error: groupErr.message });

  // Add creator as leader
  var { data: membership, error: memErr } = await sb
    .from('members')
    .insert({ group_id: group.id, user_id: userId, role: 'leader' })
    .select()
    .single();

  if (memErr) return res.status(500).json({ error: memErr.message });

  return res.json({ group, membership });
}
