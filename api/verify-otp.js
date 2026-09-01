import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

function makePassword(phone, secret) {
  return crypto.createHmac('sha256', secret).update(phone).digest('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  var { phone, code, name } = req.body;
  var digits = phone ? phone.replace(/\D/g, '') : '';
  if (!digits || !code) return res.status(400).json({ error: 'Missing fields' });

  var sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Look up stored code
  var { data: entry } = await sb
    .from('otp_codes')
    .select('*')
    .eq('phone', digits)
    .single();

  if (!entry) return res.status(400).json({ error: 'No code sent to this number' });

  if (new Date(entry.expires_at) < new Date()) {
    await sb.from('otp_codes').delete().eq('phone', digits);
    return res.status(400).json({ error: 'Code expired. Please request a new one.' });
  }

  if (entry.code !== String(code).trim()) {
    var attempts = (entry.attempts || 0) + 1;
    if (attempts >= 5) {
      await sb.from('otp_codes').delete().eq('phone', digits);
      return res.status(400).json({ error: 'Too many incorrect attempts. Please request a new code.' });
    }
    await sb.from('otp_codes').update({ attempts: attempts }).eq('phone', digits);
    var remaining = 5 - attempts;
    return res.status(400).json({ error: 'Incorrect code. ' + remaining + ' attempt' + (remaining === 1 ? '' : 's') + ' remaining.' });
  }

  // Code is correct — clean up
  await sb.from('otp_codes').delete().eq('phone', digits);

  // Build E.164 phone and deterministic password
  var phoneE164 = digits.startsWith('1') ? '+' + digits : '+1' + digits;
  var secret = process.env.OTP_PASSWORD_SECRET || 'anchored-group-otp-secret';
  var password = makePassword(phoneE164, secret);

  // Try signing in with existing account
  var sbAnon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  var signInResult = await sbAnon.auth.signInWithPassword({ phone: phoneE164, password: password });

  if (signInResult.error) {
    // User doesn't exist yet — create them
    var createResult = await sb.auth.admin.createUser({
      phone: phoneE164,
      password: password,
      phone_confirm: true
    });

    if (createResult.error) {
      return res.status(500).json({ error: 'Failed to create account: ' + createResult.error.message });
    }

    // Sign in the newly created user
    signInResult = await sbAnon.auth.signInWithPassword({ phone: phoneE164, password: password });

    if (signInResult.error) {
      return res.status(500).json({ error: 'Sign-in failed: ' + signInResult.error.message });
    }
  }

  var userId = signInResult.data.user.id;

  // Create/update profile if name was provided
  if (name) {
    await sb.from('profiles').upsert(
      { id: userId, name: name, phone: phoneE164 },
      { onConflict: 'id' }
    );
  }

  return res.json({
    ok: true,
    session: signInResult.data.session,
    user: signInResult.data.user
  });
}
