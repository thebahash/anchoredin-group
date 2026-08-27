export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { groupId, requesterName, requestPreview } = req.body;
  if (!groupId) return res.status(400).json({ error: 'Missing groupId' });

  // Use service role key to bypass RLS and fetch member phones
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY;

  try {
    // Get all members of the group with their phone numbers
    const membersRes = await fetch(
      sbUrl + '/rest/v1/members?group_id=eq.' + groupId + '&select=user_id,profiles(name,phone)',
      {
        headers: {
          'apikey': sbKey,
          'Authorization': 'Bearer ' + sbKey,
          'Content-Type': 'application/json'
        }
      }
    );
    const members = await membersRes.json();

    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom = process.env.TWILIO_PHONE_NUMBER;

    const preview = requestPreview.length > 80 ? requestPreview.substring(0, 80) + '...' : requestPreview;
    const msgBody = requesterName + ' posted a prayer request: "' + preview + '" — pray with them at group.anchoredin.app';

    const credentials = Buffer.from(twilioSid + ':' + twilioToken).toString('base64');
    const results = [];

    for (const m of members) {
      const profile = m.profiles;
      if (!profile || !profile.phone) continue;
      // Skip the person who posted
      if (profile.name === requesterName) continue;

      const formData = new URLSearchParams();
      formData.append('To', profile.phone);
      formData.append('From', twilioFrom);
      formData.append('Body', msgBody);

      const smsRes = await fetch(
        'https://api.twilio.com/2010-04-01/Accounts/' + twilioSid + '/Messages.json',
        {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + credentials,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: formData.toString()
        }
      );
      const smsData = await smsRes.json();
      results.push({ phone: profile.phone, sid: smsData.sid, status: smsData.status });
    }

    res.json({ sent: results.length, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
