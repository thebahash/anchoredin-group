import webpush from 'web-push';

// Notify one member: push first, SMS only as a backup.
// SMS goes out when the member has no push subscription, or when the push fails.
// Callers must run webpush.setVapidDetails() before using this.
export async function notifyMember(opts) {
  if (opts.sub) {
    try {
      await webpush.sendNotification(opts.sub, opts.pushPayload);
      return { method: 'push', status: 'sent' };
    } catch (err) {
      // 404/410 = subscription expired (app deleted, permission revoked) — clean it up
      if ((err.statusCode === 410 || err.statusCode === 404) && opts.onExpired) {
        try { await opts.onExpired(); } catch (e) {}
      }
    }
  }

  var tw = opts.twilio || {};
  if (!opts.phone || !tw.sid) return { method: 'none', status: 'skipped' };

  var formData = new URLSearchParams();
  formData.append('To', opts.phone);
  formData.append('From', tw.from);
  formData.append('Body', opts.smsBody);
  try {
    var r = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + tw.sid + '/Messages.json', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(tw.sid + ':' + tw.token).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: formData.toString()
    });
    var d = await r.json();
    return { method: 'sms', status: d.status || 'failed', sid: d.sid };
  } catch (e) {
    return { method: 'sms', status: 'failed', error: e.message };
  }
}

export function twilioConfig() {
  return {
    sid: process.env.TWILIO_ACCOUNT_SID,
    token: process.env.TWILIO_AUTH_TOKEN,
    from: process.env.TWILIO_PHONE_NUMBER
  };
}
