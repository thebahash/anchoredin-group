// Vercel Cron sends "Authorization: Bearer <CRON_SECRET>" when the CRON_SECRET
// environment variable is set in the Vercel project. Anything else is rejected.
export function isCronRequest(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return (req.headers.authorization || '') === 'Bearer ' + secret;
}
