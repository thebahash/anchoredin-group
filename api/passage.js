import { getAuthUserId } from './_auth.js';

// GET /api/passage?id=JAS.1 — returns the passage split into verses from API.Bible
// Accepts a chapter (JAS.1), a verse (JAS.1.5) or a range (JAS.1.1-JAS.1.12).
var ID_RE = /^[1-3A-Z]{3}\.\d{1,3}(\.\d{1,3})?(-[1-3A-Z]{3}\.\d{1,3}(\.\d{1,3})?)?$/;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const id = String(req.query.id || '').trim().toUpperCase();
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'Invalid passage id' });

  const apiKey = process.env.BIBLE_API_KEY;
  const bibleId = process.env.BIBLE_ID;
  if (!apiKey || !bibleId) return res.status(500).json({ error: 'Bible lookup is not set up' });

  const url = 'https://api.scripture.api.bible/v1/bibles/' + bibleId + '/passages/' + encodeURIComponent(id) +
    '?content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false' +
    '&include-verse-numbers=true&include-verse-spans=false';

  try {
    const r = await fetch(url, { headers: { 'api-key': apiKey } });
    if (!r.ok) return res.status(502).json({ error: 'Bible lookup failed (' + r.status + ')' });
    const d = await r.json();
    const content = (d.data && d.data.content) || '';

    // Text comes back as "[1] James, a servant ... [2] My brothers ..."
    const parts = content.split(/\[(\d+)\]/);
    const verses = [];
    for (let i = 1; i < parts.length; i += 2) {
      const text = (parts[i + 1] || '').replace(/\s+/g, ' ').trim();
      if (text) verses.push({ n: parseInt(parts[i], 10), text: text });
    }

    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.json({
      reference: (d.data && d.data.reference) || id,
      verses: verses,
      copyright: (d.data && d.data.copyright) || ''
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
