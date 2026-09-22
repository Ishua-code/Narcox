'use strict';

const crypto = require('crypto');

/**
 * Builds an evidence package from a detection record.
 * Hash is computed from a canonical (stable key order) JSON representation
 * of the core fields, so the same detection always produces the same hash -
 * letting us detect tampering by recomputing and comparing.
 */
function packageEvidence(detection) {
  const raw = {
    platform: detection.platform,
    userId: detection.userId,
    chatId: detection.chatId,
    text: detection.text
  };

  const canonical = JSON.stringify(raw, Object.keys(raw).sort());
  const hash = crypto.createHash('sha256').update(canonical).digest('hex');

  const caseId = crypto
    .createHash('md5')
    .update(String(detection._id || detection.userId + detection.ts))
    .digest('hex')
    .slice(0, 4);

  return {
    caseId,
    packageHash: hash,
    verified: true, // always true at generation time; re-verify on read if ever stored
    rawContent: raw,
    custodyChain: [
      { action: 'CAPTURED', by: 'system', at: detection.ts || detection.createdAt },
      { action: 'PACKAGED', by: 'system', at: new Date().toISOString() }
    ]
  };
}

module.exports = { packageEvidence };
