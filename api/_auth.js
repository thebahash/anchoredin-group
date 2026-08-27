// Shared JWT verification helper for API routes
// Verifies the Supabase access token and returns the authenticated user ID.
// Returns null if the token is missing or invalid.

export async function getAuthUserId(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY;

  try {
    const res = await fetch(sbUrl + '/auth/v1/user', {
      headers: {
        'apikey': sbKey,
        'Authorization': 'Bearer ' + token
      }
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user && user.id ? user.id : null;
  } catch (e) {
    return null;
  }
}
