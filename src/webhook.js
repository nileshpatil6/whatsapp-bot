'use strict';

const express = require('express');
const router = express.Router();
const flowRouter = require('./flows/flowRouter');

// Keep a small set of recently seen message IDs to deduplicate Meta's at-least-once delivery
const seenMessageIds = new Set();
const MAX_SEEN_IDS = 500;

// GET /webhook — Meta webhook verification handshake
router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('[Webhook] Verified successfully.');
    return res.status(200).send(challenge);
  }
  console.warn('[Webhook] Verification failed. Token mismatch.');
  return res.sendStatus(403);
});

// POST /webhook — Incoming messages from Meta
router.post('/', (req, res) => {
  // Always respond 200 immediately — Meta will retry if we don't
  res.sendStatus(200);

  // Process asynchronously so we never hold up the response
  processPayload(req.body).catch((err) => {
    console.error('[Webhook] Unhandled error in processPayload:', err);
  });
});

async function processPayload(body) {
  if (!body || body.object !== 'whatsapp_business_account') return;

  const entries = body.entry || [];
  for (const entry of entries) {
    const changes = entry.changes || [];
    for (const change of changes) {
      if (change.field !== 'messages') continue;

      const value = change.value || {};
      const messages = value.messages || [];

      for (const message of messages) {
        // Deduplicate
        if (seenMessageIds.has(message.id)) continue;
        seenMessageIds.add(message.id);
        if (seenMessageIds.size > MAX_SEEN_IDS) {
          // Remove oldest entry
          seenMessageIds.delete(seenMessageIds.values().next().value);
        }

        const from = message.from; // sender's phone number e.g. "919876543210"
        let text = '';

        if (message.type === 'text') {
          text = (message.text && message.text.body) ? message.text.body.trim() : '';
        } else if (message.type === 'interactive') {
          // Button replies or list replies
          if (message.interactive.type === 'button_reply') {
            text = message.interactive.button_reply.id || message.interactive.button_reply.title;
          } else if (message.interactive.type === 'list_reply') {
            text = message.interactive.list_reply.id || message.interactive.list_reply.title;
          }
        } else {
          // Unsupported message type (image, audio, etc.)
          await flowRouter.sendUnsupportedTypeMessage(from);
          continue;
        }

        if (!text) continue;

        await flowRouter.route(from, text).catch(async (err) => {
          console.error(`[Webhook] Error routing message from ${from}:`, err);
          try {
            const waClient = require('./whatsapp/client');
            await waClient.sendText(from, 'Something went wrong on my end. Reply *menu* to start over.');
          } catch (_) {}
        });
      }
    }
  }
}

module.exports = router;
