'use strict';

const { getStore } = require('../../lib/getStore');
const { ingestDetection } = require('../../lib/ingest');
const { readJsonBody } = require('../../lib/readJsonBody');

/**
 * GET  /api/instagram/webhook  - Meta's webhook verification handshake.
 * POST /api/instagram/webhook  - incoming Instagram messaging events.
 *
 * Verification (GET): Meta calls this URL with
 *   ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 * when the webhook is registered in the Meta App Dashboard. We must echo
 * back hub.challenge as plain text if, and only if, hub.verify_token
 * matches INSTAGRAM_VERIFY_TOKEN - otherwise reject with 403. This route
 * does not use INSTAGRAM_ACCESS_TOKEN; that token is for making outbound
 * calls to the Instagram Graph API (e.g. sending replies), not for
 * verifying inbound webhook calls, and no outbound calls are made here.
 *
 * Events (POST): each entry can carry direct-message events under
 * `messaging` (Messenger-platform style, used for Instagram DMs) and/or
 * comment/mention events under `changes` (used for public interactions).
 * Every event we can pull text out of is normalized to the shared
 * detection shape (see api/detect.js), tagged platform: "instagram", and
 * run through the existing, unmodified detector (lib/detector.js
 * analyze(), via lib/ingest.js).
 */

/** Normalize one messaging (DM) event into the shared detection shape. */
function normalizeMessagingEvent(event) {
  const senderId = event?.sender?.id;
  const text = typeof event?.message?.text === 'string' ? event.message.text : '';
  const ts = Number.isFinite(event?.timestamp) ? event.timestamp : undefined;

  return {
    text,
    userId: senderId != null ? String(senderId) : undefined,
    username: undefined, // Instagram DM webhooks don't include a username, only an IG-scoped sender id
    chatId: senderId != null ? String(senderId) : undefined,
    chatTitle: 'Instagram DM',
    platform: 'instagram',
    mediaType: 'text',
    ts
  };
}

/** Normalize one `changes` event (e.g. a comment) into the shared shape. */
function normalizeChangeEvent(change) {
  const value = change?.value || {};
  const text =
    typeof value.text === 'string' ? value.text :
    typeof value.comment_text === 'string' ? value.comment_text :
    typeof value.caption === 'string' ? value.caption :
    '';
  const fromId = value?.from?.id;
  const username = value?.from?.username;

  return {
    text,
    userId: fromId != null ? String(fromId) : undefined,
    username,
    chatId: value.media?.id != null ? String(value.media.id) : (fromId != null ? String(fromId) : undefined),
    chatTitle: `Instagram ${change?.field || 'event'}`,
    platform: 'instagram',
    mediaType: typeof value.caption === 'string' ? 'caption' : 'text',
    ts: undefined
  };
}

/** Flatten a full Instagram webhook payload into a list of normalized events. */
function normalizeInstagramPayload(body) {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  const normalizedEvents = [];

  for (const entry of entries) {
    for (const event of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      normalizedEvents.push(normalizeMessagingEvent(event));
    }
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      normalizedEvents.push(normalizeChangeEvent(change));
    }
  }

  return normalizedEvents;
}

function handleVerification(req, res) {
  const mode = req.query?.['hub.mode'];
  const token = req.query?.['hub.verify_token'];
  const challenge = req.query?.['hub.challenge'];

  const expectedToken = process.env.INSTAGRAM_VERIFY_TOKEN;

  if (mode === 'subscribe' && expectedToken && token === expectedToken) {
    res.status(200);
    res.setHeader('Content-Type', 'text/plain');
    return res.send(challenge != null ? String(challenge) : '');
  }

  return res.status(403).json({ error: 'invalid verify token' });
}

async function handlePost(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    console.error('instagram webhook: failed to read body:', err);
    body = {};
  }
  if (!body || typeof body !== 'object') body = {};

  try {
    const events = normalizeInstagramPayload(body);
    const store = await getStore().catch(err => {
      console.error('instagram webhook: store unavailable, continuing without persistence:', err);
      return null;
    });

    const outcomes = [];
    for (const normalized of events) {
      outcomes.push(await ingestDetection(store, normalized));
    }

    // Meta expects a fast 200 regardless of downstream processing details.
    return res.status(200).json({ ok: true, eventCount: events.length, outcomes });
  } catch (err) {
    console.error('instagram webhook: failed to process payload:', err);
    return res.status(200).json({ ok: true, skipped: true, reason: 'processing error' });
  }
}

async function handler(req, res) {
  if (req.method === 'GET') {
    return handleVerification(req, res);
  }
  if (req.method === 'POST') {
    return handlePost(req, res);
  }
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'method not allowed, expected GET or POST' });
}

module.exports = handler;
module.exports.normalizeInstagramPayload = normalizeInstagramPayload;
