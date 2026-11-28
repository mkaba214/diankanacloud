'use strict';
// Emails each new contact-form message (Firestore "messages") to the site inbox
// through Brevo's transactional email API. Reply-To is the visitor, so replying
// from the inbox answers them directly.
//
// Kept free of firebase-functions so it can be tested with a fake fetch.

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const INBOX = 'contact@diankanacloud.com';
const SENDER = { name: 'Diankana Cloud', email: INBOX };

const BREVO_TIMEOUT_MS = 10000;
// Brevo's free plan sends 300 emails a day; anyone can post the form, so a flood
// of messages stops being emailed after this many (they are still in Firestore).
const DAILY_CAP = 100;
const DAY = 24 * 60 * 60 * 1000;

// Rolling 24 h count. The function runs on one instance, so the count is exact
// until that instance restarts.
class DailyCap {
  constructor(cap = DAILY_CAP) {
    this.cap = cap;
    this.sent = [];
  }
  allow(now) {
    this.sent = this.sent.filter(t => now - t < DAY);
    if (this.sent.length >= this.cap) return false;
    this.sent.push(now);
    return true;
  }
}

const oneLine = (s, max) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Builds the Brevo request body from a stored message, or returns null when the
// document isn't a usable message.
function buildEmail(data, id) {
  if (!data || typeof data !== 'object') return null;
  const name = oneLine(data.name, 100);
  const email = oneLine(data.email, 200);
  const message = String(data.message ?? '').trim().slice(0, 5000);
  if (!name || !message || !EMAIL.test(email)) return null;
  const lang = data.lang === 'en' ? 'en' : 'fr';
  const when = data.createdAt && typeof data.createdAt.toDate === 'function'
    ? data.createdAt.toDate().toISOString() : new Date().toISOString();

  return {
    sender: SENDER,
    to: [{ email: INBOX }],
    replyTo: { email, name },
    subject: oneLine(`[Diankana Cloud] Message de ${name}`, 150),
    textContent: [
      `Nom / Name: ${name}`,
      `Email: ${email}`,
      `Langue / Language: ${lang}`,
      `Date: ${when}`,
      `Firestore: messages/${id}`,
      '',
      message,
      '',
      '--',
      'Répondez à cet e-mail pour écrire directement à la personne.',
      'Reply to this email to answer the sender directly.',
    ].join('\n'),
    tags: ['contact-form'],
  };
}

// Sends one message. Never throws and never logs the message text or the
// visitor's address; returns a short outcome string for the logs.
async function mailMessage({ data, id, apiKey, cap, fetchImpl = fetch, now = Date.now }) {
  const payload = buildEmail(data, id);
  if (!payload) return 'invalid';
  if (!apiKey) return 'no-key';
  if (!cap.allow(now())) return 'capped';
  try {
    const res = await fetchImpl(BREVO_URL, {
      method: 'POST',
      headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(BREVO_TIMEOUT_MS),
    });
    return res.ok ? 'sent' : `brevo-${res.status}`;
  } catch (e) {
    return e && e.name === 'TimeoutError' ? 'timeout' : 'network-error';
  }
}

module.exports = { DailyCap, buildEmail, mailMessage, INBOX, DAILY_CAP };
