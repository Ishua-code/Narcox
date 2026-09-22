const {getDb} = require('../../lib/db');
const {analyze} = require('../../lib/detector');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({error: 'Use POST'});
  }

  const {username, text, mediaType} = req.body;

  if (!username || !text) {
    return res.status(400).json({error: 'username and text are required'});
  }

  const a = analyze(text);

  const db = await getDb();
  await db.collection('detections').insertOne({
    platform: 'instagram',
    chatId: 'simulated',
    chatTitle: 'IG DM (simulated)',
    userId: String(username),
    username,
    text,
    mediaType: mediaType || 'text',
    ts: new Date(),
    risk: a.risk,
    level: a.level,
    categories: a.categories,
    matches: a.matches,
    identifiers: a.identifiers,
    reasons: a.reasons,
    imageLabels: [],
    simulated: true
  });

  res.json({ok: true});
};