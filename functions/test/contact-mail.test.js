'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { DailyCap, buildEmail, mailMessage, INBOX } = require('../contact-mail');

const msg = {
  name: 'Awa Camara', email: 'awa@example.org', message: 'Bonjour,\nune idée de sujet.', lang: 'fr',
  createdAt: { toDate: () => new Date('2026-11-28T10:00:00Z') },
};

function fakeFetch(status = 201) {
  const calls = [];
  const fn = async (url, opts) => { calls.push({ url, opts, body: JSON.parse(opts.body) }); return { ok: status < 300, status }; };
  fn.calls = calls;
  return fn;
}

test('buildEmail: inbox to inbox, Reply-To is the visitor, text keeps the message', () => {
  const e = buildEmail(msg, 'abc123');
  assert.deepStrictEqual(e.to, [{ email: INBOX }]);
  assert.strictEqual(e.sender.email, INBOX);
  assert.deepStrictEqual(e.replyTo, { email: 'awa@example.org', name: 'Awa Camara' });
  assert.strictEqual(e.subject, '[Diankana Cloud] Message de Awa Camara');
  assert.match(e.textContent, /Bonjour,\nune idée de sujet\./);
  assert.match(e.textContent, /messages\/abc123/);
  assert.match(e.textContent, /2026-11-28T10:00:00\.000Z/);
  assert.ok(!('htmlContent' in e), 'plain text only');
});

test('buildEmail: newlines in name cannot reach the subject or Reply-To', () => {
  const e = buildEmail({ ...msg, name: 'Eve\r\nBcc: x@y.z' }, 'id');
  assert.ok(!/[\r\n]/.test(e.subject));
  assert.ok(!/[\r\n]/.test(e.replyTo.name));
});

test('buildEmail: rejects missing fields and bad addresses', () => {
  assert.strictEqual(buildEmail(null, 'id'), null);
  assert.strictEqual(buildEmail({ ...msg, name: ' ' }, 'id'), null);
  assert.strictEqual(buildEmail({ ...msg, message: '' }, 'id'), null);
  assert.strictEqual(buildEmail({ ...msg, email: 'not-an-email' }, 'id'), null);
  assert.strictEqual(buildEmail({ ...msg, email: 'a@b.c\nBcc: x@y.z' }, 'id'), null);
});

test('mailMessage: sends to Brevo with the key in the header', async () => {
  const f = fakeFetch(201);
  const out = await mailMessage({ data: msg, id: 'id', apiKey: 'k', cap: new DailyCap(), fetchImpl: f });
  assert.strictEqual(out, 'sent');
  assert.strictEqual(f.calls.length, 1);
  assert.strictEqual(f.calls[0].url, 'https://api.brevo.com/v3/smtp/email');
  assert.strictEqual(f.calls[0].opts.headers['api-key'], 'k');
});

test('mailMessage: reports Brevo errors, network errors and timeouts without throwing', async () => {
  const cap = new DailyCap();
  assert.strictEqual(await mailMessage({ data: msg, id: 'id', apiKey: 'k', cap, fetchImpl: fakeFetch(401) }), 'brevo-401');
  const boom = async () => { throw new TypeError('fetch failed'); };
  assert.strictEqual(await mailMessage({ data: msg, id: 'id', apiKey: 'k', cap, fetchImpl: boom }), 'network-error');
  const slow = async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; };
  assert.strictEqual(await mailMessage({ data: msg, id: 'id', apiKey: 'k', cap, fetchImpl: slow }), 'timeout');
});

test('mailMessage: no key or invalid message means no call', async () => {
  const f = fakeFetch();
  assert.strictEqual(await mailMessage({ data: msg, id: 'id', apiKey: '', cap: new DailyCap(), fetchImpl: f }), 'no-key');
  assert.strictEqual(await mailMessage({ data: {}, id: 'id', apiKey: 'k', cap: new DailyCap(), fetchImpl: f }), 'invalid');
  assert.strictEqual(f.calls.length, 0);
});

test('DailyCap: stops after the cap and frees up after 24 h', async () => {
  const cap = new DailyCap(2);
  const f = fakeFetch();
  let t = 0;
  const now = () => t;
  for (const want of ['sent', 'sent', 'capped']) {
    assert.strictEqual(await mailMessage({ data: msg, id: 'id', apiKey: 'k', cap, fetchImpl: f, now }), want);
  }
  assert.strictEqual(f.calls.length, 2);
  t = 24 * 60 * 60 * 1000;
  assert.strictEqual(await mailMessage({ data: msg, id: 'id', apiKey: 'k', cap, fetchImpl: f, now }), 'sent');
});
