import { getAuthUserId } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const userId = await getAuthUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { requestText, requesterName } = req.body;
  if (!requestText) return res.status(400).json({ error: 'Missing requestText' });

  const name = requesterName || 'Someone';

  const systemPrompt = 'You are a prayer writer who crafts heartfelt, scripture-based prayers. Write a sincere, personal prayer for the specific situation shared. Include 1-2 relevant scripture references woven naturally into the prayer — cite the reference in parentheses after the verse. Keep it 3-5 sentences. Write in second person addressing God directly. Do not use flowery or overly formal language. Make it feel like a real, genuine person praying for a friend.';

  const userPrompt = name + ' is asking for prayer: ' + requestText + '\n\nWrite a scripture-based prayer for this situation.';

  try {
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
    res.json({ prayer: data.content[0].text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
