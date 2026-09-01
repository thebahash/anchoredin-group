import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  var { phone } = req.body;
  var digits = phone ? phone.replace(/\D/g, '') : '';
  if (!digits || digits.length < 10) {
    return res.status(400).json({ error: 'Invalid phone number' });
  }

  var sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  // Generate 6-digit code
  var code = String(Math.floor(100000 + Math.random() * 900000));
  var expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  var { error: dbErr } = await sb
    .from('otp_codes')
    .upsert({ phone: digits, code: code, expires_at: expiresAt, attempts: 0 });

  if (dbErr) return res.status(500).json({ error: 'Failed to store code' });

  var accountSid = process.env.TWILIO_ACCOUNT_SID;
  var authToken = process.env.TWILIO_AUTH_TOKEN;
  var from = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !from) {
    // Dev mode: log the code
    console.log('OTP for ' + digits + ': ' + code);
    return res.json({ ok: true });
  }

  var to = digits.startsWith('1') ? '+' + digits : '+1' + digits;

  var twilioRes = await fetch(
    'https://api.twilio.com/2010-04-01/Accounts/' + accountSid + '/Messages.json',
    {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(accountSid + ':' + authToken).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        To: to,
        From: from,
        Body: 'Your Anchored In Group code: ' + code
      })
    }
  );

  if (!twilioRes.ok) {
    var errBody = await twilioRes.json().catch(function() { return {}; });
    console.error('Twilio error:', errBody);
    return res.status(502).json({ error: 'Failed to send SMS. Please check your number and try again.' });
  }

  return res.json({ ok: true });
}
