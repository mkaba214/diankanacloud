'use strict';
// Firebase entry points: the Ask AI endpoint (logic in askai.js) and the
// contact-form mailer (logic in contact-mail.js).

const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { CircuitBreaker, RateLimiter, visitorKey, handleAsk, MAX_BODY_BYTES, LOCAL } = require('./askai');
const { DailyCap, mailMessage } = require('./contact-mail');

// Set with: firebase functions:secrets:set GROQ_API_KEY
const GROQ_API_KEY = defineSecret('GROQ_API_KEY');

const ORIGINS = ['https://diankanacloud.com', 'https://www.diankanacloud.com'];
if (process.env.FUNCTIONS_EMULATOR === 'true') ORIGINS.push(/^http:\/\/localhost(:\d+)?$/);

// One instance holds all the traffic, so the breaker's and the limiter's counts are exact.
const breaker = new CircuitBreaker();
const limiter = new RateLimiter();

exports.askAI = onRequest(
  {
    region: 'europe-west1',
    secrets: [GROQ_API_KEY],
    cors: ORIGINS,
    maxInstances: 1,
    cpu: 1,
    concurrency: 80,
    timeoutSeconds: 10,
    invoker: 'public',
  },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.status(405).json(LOCAL);
      return;
    }
    if (!limiter.allow(visitorKey(req.headers, req.ip), Date.now())) {
      logger.info('askAI', { outcome: 'rate-limited' });
      res.status(429).json(LOCAL);
      return;
    }
    if (req.rawBody && req.rawBody.length > MAX_BODY_BYTES) {
      logger.info('askAI', { outcome: 'too-large' });
      res.status(413).json(LOCAL);
      return;
    }
    const out = await handleAsk({ body: req.body, apiKey: GROQ_API_KEY.value(), breaker, log: logger });
    res.status(out.status).json(out.json);
  },
);

// Set with: firebase functions:secrets:set BREVO_API_KEY
const BREVO_API_KEY = defineSecret('BREVO_API_KEY');
const mailCap = new DailyCap();

// Emails each new contact-form message to contact@diankanacloud.com.
// The Firestore database is in nam5 (US), which triggers from us-central1.
// No retries: a failed email is logged and the message stays in Firestore.
exports.mailContactMessage = onDocumentCreated(
  {
    document: 'messages/{messageId}',
    region: 'us-central1',
    secrets: [BREVO_API_KEY],
    maxInstances: 1,
    timeoutSeconds: 30,
  },
  async event => {
    const snap = event.data;
    const outcome = await mailMessage({
      data: snap && snap.data(),
      id: event.params.messageId,
      apiKey: BREVO_API_KEY.value(),
      cap: mailCap,
    });
    const log = outcome === 'sent' ? logger.info : logger.warn;
    log('mailContactMessage', { messageId: event.params.messageId, outcome });
  },
);
