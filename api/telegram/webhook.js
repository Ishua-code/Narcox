'use strict';

const { getStore } = require('../../lib/getStore');
const { ingestDetection } = require('../../lib/ingest');
const { readJsonBody } = require('../../lib/readJsonBody');

/**
 * POST /api/telegram/webhook
 *
 * Receives a Telegram Bot API "Update" object (as configured via
 * https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook), pulls the
 * message text/identity fields out of it, normalizes them to the shared
 * "detections" shape (see api/detect.js), tags platform: "telegram", and
 * runs them through the existing, unmodified detector (lib/detector.js
 * analyze(), via lib/ingest.js).
 *
 * This file does not verify or use TELEGRAM_BOT_TOKEN itself - that
 * credential is what you call the Telegram API *with* (e.g. to register
 * this URL via setWebhook, or to send replies later); nothing about
 * receiving and reading an update requires it. No outbound Telegram API
 * calls are made here.
 *
 * Every code path below is defensive: a missing/odd field degrades to a
 * safe default instead of throwing, and Telegram always gets a fast 200
 * so it doesn't queue retries.
 */

/** Pull the most relevant message-like object out of a Telegram Update. */
function extractMessage(update) {
  return (
    update?.message ||
    update?.edited_message ||
    update?.channel_post ||
    update?.edited_channel_post ||
    null
  );
}

/** Safely normalize a Telegram Update into the shared detection shape. */
function normalizeTelegramUpdate(update) {
  const msg = extractMessage(update) || {};
  const from = msg.from || {};
  const chat = msg.chat || {};

  const text =
    typeof msg.text === 'string' ? msg.text :
    typeof msg.caption === 'string' ? msg.caption :
    '';

  const username =
    from.username ||
    [from.first_name, from.last_name].filter(Boolean).join(' ').trim() ||
    undefined;

  const chatTitle =
    chat.title ||
    chat.username ||
    [chat.first_name, chat.last_name].filter(Boolean).join(' ').trim() ||
    undefined;

  // Telegram sends `date` as Unix seconds; fall back to receipt time if absent/invalid.
  const ts = Number.isFinite(msg.date) ? msg.date * 1000 : undefined;

  return {
    text,
    userId: from.id != null ? String(from.id) : undefined,
    username,
    chatId: chat.id != null ? String(chat.id) : undefined,
    chatTitle,
    platform: 'telegram',
    mediaType: typeof msg.caption === 'string' && typeof msg.text !== 'string' ? 'caption' : 'text',
    ts
  };
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed, expected POST' });
  }

  let update;
  try {
    update = await readJsonBody(req);
  } catch (err) {
    console.error('telegram webhook: failed to read body:', err);
    update = {};
  }
  if (!update || typeof update !== 'object') update = {};

  try {
    const normalized = normalizeTelegramUpdate(update);
    const store = await getStore().catch(err => {
      console.error('telegram webhook: store unavailable, continuing without persistence:', err);
      return null;
    });
    const outcome = await ingestDetection(store, normalized);
    return res.status(200).json({ ok: true, ...outcome });
  } catch (err) {
    // Telegram will retry non-2xx responses; an update we couldn't process
    // is not something retrying fixes, so still ack with 200 and just log it.
    console.error('telegram webhook: failed to process update:', err);
    return res.status(200).json({ ok: true, skipped: true, reason: 'processing error' });
  }
}

module.exports = handler;
module.exports.normalizeTelegramUpdate = normalizeTelegramUpdate;
