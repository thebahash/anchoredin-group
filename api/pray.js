import { getAuthUserId } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { requestText, requesterName, action, verses } = req.body;
  if (!requestText) return res.status(400).json({ error: 'Missing requestText' });

  const name = requesterName || 'Someone';

  try {
    if (action === 'verses') {
      // Step 1: return 2-3 relevant Bible verses as structured JSON
      const systemPrompt = 'You are a Bible scholar. Given a prayer request, return 2-3 relevant Bible verses. Respond with ONLY a valid JSON array — no other text, no markdown, no explanation. Format: [{"reference": "Isaiah 41:10", "text": "Do not fear, for I am with you; do not be dismayed, for I am your God. I will strengthen you and help you; I will uphold you with my righteous right hand."}]';

      const userPrompt = 'Prayer request: ' + requestText;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 600,
          temperature: 0.5,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        })
      });

      const data = await response.json();
      if (!data.content || !data.content[0]) return res.status(500).json({ error: 'No response from API' });

      const raw = data.content[0].text.trim();

      // Extract JSON array defensively
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) return res.status(500).json({ error: 'Could not parse verses response' });

      let versesArr;
      try {
        versesArr = JSON.parse(match[0]);
      } catch (e) {
        return res.status(500).json({ error: 'Invalid JSON from API' });
      }

      return res.json({ verses: versesArr });

    } else {
      // Step 2: generate a prayer rooted in the provided verses
      const verseList = (verses || []).map(function(v) {
        return '"' + v.text + '" (' + v.reference + ')';
      }).join('\n');

      const systemPrompt = 'You are a prayer writer. Write a sincere, heartfelt prayer that is rooted in the specific Bible verses provided. Let the scripture shape the language and confidence of the prayer — weave it in naturally, do not just quote or list the verses. Keep it 3-5 sentences. Address God directly. Use natural, modern language. No flowery or overly formal phrasing.';

      const userPrompt = name + ' is asking for prayer: ' + requestText + '\n\nBible verses to pray from:\n' + verseList + '\n\nWrite a prayer rooted in these specific scriptures.';

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 500,
          temperature: 1.0,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        })
      });

      const data = await response.json();
      if (!data.content || !data.content[0]) return res.status(500).json({ error: 'No response from API' });
      return res.json({ prayer: data.content[0].text });
    }

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
