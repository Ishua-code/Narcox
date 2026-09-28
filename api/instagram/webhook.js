const { getDb } = require('../../lib/db');
const { analyze } = require('../../lib/detector');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.IG_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  if (req.method === 'POST') {
    try {
      const entries = (req.body && req.body.entry) || [];
      const items = [];

      for (const e of entries) {
        if (e.messaging) {
          for (const m of e.messaging) {
            if (!m.message || !m.sender) continue;
            const text = m.message.text || '';
            const images = (m.message.attachments || [])
              .filter(a => a.type === 'image' && a.payload && a.payload.url)
              .map(a => a.payload.url);
            if (!text && images.length === 0) continue;

            items.push({
              userId: String(m.sender.id),
              username: String(m.sender.id),
              text,
              imageUrls: images,
              ts: new Date(m.timestamp || Date.now()),
              mediaType: images.length ? 'photo' : 'text',
              chat: 'IG DM'
            });
          }
        }

        if (e.changes) {
          for (const c of e.changes) {
            if (c.field === 'comments' && c.value && c.value.text) {
              items.push({
                userId: String(c.value.from.id),
                username: c.value.from.username,
                text: c.value.text,
                imageUrls: [],
                ts: new Date(),
                mediaType: 'comment',
                chat: 'IG post ' + c.value.media.id
              });
            }
          }
        }
      }

      const db = await getDb();

      for (const item of items) {
        const a = analyze(item.text);
        let imageLabels = [];
        let imageRisk = 0;
        const isPhoto = item.imageUrls.length > 0;

        if (isPhoto) {
          try {
            const vision = require('../../lib/vision');
            // Instagram CDN links expire, so analyze right away
            const vr = await vision.analyzeImage(item.imageUrls[0]);
            imageLabels = vr.labels || [];
            imageRisk = vr.risk || 0;
          } catch (err) {
            console.error('IG vision failed', err);
          }
        }

        const risk = Math.max(a.risk, imageRisk, isPhoto ? 2 : 0);
        if (risk === 0) continue;

        let level = 'low';
        if (risk >= 7) level = 'high';
        else if (risk >= 4) level = 'medium';

        await db.collection('detections').insertOne({
          platform: 'instagram',
          chatId: item.chat,
          chatTitle: item.chat,
          userId: item.userId,
          username: item.username,
          text: item.text || '[photo]',
          mediaType: item.mediaType,
          ts: item.ts,
          risk,
          level,
          categories: a.categories || [],
          matches: a.matches || [],
          identifiers: a.identifiers || {},
          reasons: a.reasons || [],
          imageLabels
        });
      }
    } catch (err) {
      console.error('IG WEBHOOK ERROR:', err);
    }

    // Always 200 so Meta doesn't retry and disable the webhook
    return res.json({ ok: true });
  }

  res.status(405).send('Method Not Allowed');
};
