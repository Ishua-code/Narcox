'use strict';

const { getDb } = require('../lib/db');
const { packageEvidence } = require('../lib/evidence');

module.exports = async (req, res) => {
  try {
    const minRisk = Number(req.query.minRisk) || 7;
    const limit = Number(req.query.limit) || 20;

    const db = await getDb();
    const rows = await db.collection('detections')
      .find({ risk: { $gte: minRisk } })
      .sort({ ts: -1 })
      .limit(limit)
      .toArray();

    const cases = rows.map(packageEvidence);

    res.status(200).json(cases);
  } catch (err) {
    console.error('GET /api/evidence failed:', err);
    res.status(500).json({ error: 'failed to build evidence packages' });
  }
};
