import crypto from 'crypto';

function makePassword(phone, secret) {
  return crypto.createHmac('sha256', secret).update(phone).digest('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  var { phone, code, name } = req.body;
  var digits = phone ? phone.replace(/\D/g, '') : '';
  if (!digits || !code) return res.status(400).json({ error: 'Missing fields' });

  var sbUrl = process.env.SUPABASE_URL;
  var sbKey = process.env.SUPABASE_SERVICE_KEY;
  var anonKey = process.env.SUPABASE_ANON_KEY;

  var serviceHeaders = {
    'apikey': sbKey,
    'Authorization': 'Bearer ' + sbKey,
    'Content-Type': 'application/json'
  };

  // Look up stored code
  var lookupRes = await fetch(
    sbUrl + '/rest/v1/otp_codes?phone=eq.' + encodeURIComponent(digits) + '&limit=1',
    { headers: serviceHeaders }
  );
  var rows = await lookupRes.json().catch(function() { return []; });
  var entry = rows && rows[0];

  if (!entry) return res.status(400).json({ error: 'No code sent to this number' });

  if (new Date(entry.expires_at) < new Date()) {
    await fetch(sbUrl + '/rest/v1/otp_codes?phone=eq.' + encodeURIComponent(digits), {
      method: 'DELETE', headers: serviceHeaders
    });
    return res.status(400).json({ error: 'Code expired. Please request a new one.' });
  }

  if (entry.code !== String(code).trim()) {
    var attempts = (entry.attempts || 0) + 1;
    if (attempts >= 5) {
      await fetch(sbUrl + '/rest/v1/otp_codes?phone=eq.' + encodeURIComponent(digits), {
        method: 'DELETE', headers: serviceHeaders
      });
      return res.status(400).json({ error: 'Too many incorrect attempts. Please request a new code.' });
    }
    await fetch(sbUrl + '/rest/v1/otp_codes?phone=eq.' + encodeURIComponent(digits), {
      method: 'PATCH',
      headers: serviceHeaders,
      body: JSON.stringify({ attempts: attempts })
    });
    var remaining = 5 - attempts;
    return res.status(400).json({ error: 'Incorrect code. ' + remaining + ' attempt' + (remaining === 1 ? '' : 's') + ' remaining.' });
  }

  // Code correct — clean up
  await fetch(sbUrl + '/rest/v1/otp_codes?phone=eq.' + encodeURIComponent(digits), {
    method: 'DELETE', headers: serviceHeaders
  });

  var phoneE164 = digits.startsWith('1') ? '+' + digits : '+1' + digits;
  var secret = process.env.OTP_PASSWORD_SECRET || 'anchored-group-otp-secret';
  var password = makePassword(phoneE164, secret);

  // Try signing in with existing account
  var signInRes = await fetch(sbUrl + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'apikey': anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: phoneE164, password: password })
  });
  var signInData = await signInRes.json().catch(function() { return {}; });

  if (!signInRes.ok || signInData.error) {
    // Try creating the user
    var createRes = await fetch(sbUrl + '/auth/v1/admin/users', {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({ phone: phoneE164, password: password, phone_confirm: true })
    });
    var createData = await createRes.json().catch(function() { return {}; });

    if (!createRes.ok || createData.error) {
      // User exists from old auth method — paginate to find them by phone
      var existingUser = null;
      var page = 1;
      while (!existingUser) {
        var listRes = await fetch(
          sbUrl + '/auth/v1/admin/users?page=' + page + '&per_page=100',
          { headers: serviceHeaders }
        );
        var listData = await listRes.json().catch(function() { return {}; });
        var users = listData.users || [];
        existingUser = users.find(function(u) { return u.phone === phoneE164; });
        if (existingUser || users.length < 100) break;
        page++;
      }

      if (!existingUser) {
        console.error('Phone exists but user not found:', createData);
        return res.status(500).json({ error: 'Failed to locate account' });
      }

      // Update their password to match our new system
      var updateRes = await fetch(sbUrl + '/auth/v1/admin/users/' + existingUser.id, {
        method: 'PUT',
        headers: serviceHeaders,
        body: JSON.stringify({ password: password, phone_confirm: true })
      });
      if (!updateRes.ok) {
        return res.status(500).json({ error: 'Failed to update account' });
      }
    }

    // Sign in (whether newly created or password updated)
    signInRes = await fetch(sbUrl + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { 'apikey': anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: phoneE164, password: password })
    });
    signInData = await signInRes.json().catch(function() { return {}; });

    if (!signInRes.ok || signInData.error) {
      console.error('Sign-in error:', signInData);
      return res.status(500).json({ error: 'Sign-in failed' });
    }
  }

  var userId = signInData.user && signInData.user.id;

  // Upsert profile if name provided
  if (name && userId) {
    await fetch(sbUrl + '/rest/v1/profiles', {
      method: 'POST',
      headers: Object.assign({}, serviceHeaders, { 'Prefer': 'resolution=merge-duplicates' }),
      body: JSON.stringify({ id: userId, name: name, phone: phoneE164 })
    });
  }

  return res.json({
    ok: true,
    session: {
      access_token: signInData.access_token,
      refresh_token: signInData.refresh_token,
      expires_in: signInData.expires_in,
      token_type: signInData.token_type
    },
    user: signInData.user
  });
}
