'use strict';
// Firebase entry point for the Ask AI endpoint. The logic lives in askai.js.

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const { CircuitBreaker, handleAsk } = require('./askai');

// Set with: firebase functions:secrets:set GROQ_API_KEY
const GROQ_API_KEY = defineSecret('GROQ_API_KEY');

const ORIGINS = ['https://diankanacloud.com', 'https://www.diankanacloud.com'];
if (process.env.FUNCTIONS_EMULATOR === 'true') ORIGINS.push(/^http:\/\/localhost(:\d+)?$/);

// One instance holds all the traffic, so the breaker's counts are exact.
const breaker = new CircuitBreaker();

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
      res.status(405).json({ source: 'local' });
      return;
    }
    const out = await handleAsk({ body: req.body, apiKey: GROQ_API_KEY.value(), breaker, log: logger });
    res.status(out.status).json(out.json);
  },
);
