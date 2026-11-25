'use strict';
// Run with: npm test (inside functions/). Uses a fake Groq: no key, no network.

const test = require('node:test');
const assert = require('node:assert/strict');
const { CircuitBreaker, RateLimiter, visitorKey, handleAsk, validate, parseDuration, NO_ANSWER } = require('../askai');

const BODY = {
  question: 'What is Simandou 2040?',
  lang: 'en',
  passages: [{ title: 'Simandou 2040 explained', text: "Simandou 2040 is Guinea's 15-year development programme." }],
};

function headers(map = {}) {
  return { get: k => (k in map ? String(map[k]) : null) };
}

function groq(content, { status = 200, hdrs = {}, finish = 'stop', tokens = 300 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: headers(hdrs),
      json: async () => ({ choices: [{ message: { content }, finish_reason: finish }], usage: { total_tokens: tokens } }),
    };
  };
  return { fetchImpl, calls };
}

const run = (fetchImpl, extra = {}) =>
  handleAsk({ body: BODY, apiKey: 'test-key', breaker: new CircuitBreaker(), fetchImpl, ...extra });

test('returns the generated answer', async () => {
  const { fetchImpl, calls } = groq('Simandou 2040 is a 15-year programme.');
  const out = await run(fetchImpl);
  assert.deepEqual(out, { status: 200, json: { source: 'ai', found: true, answer: 'Simandou 2040 is a 15-year programme.' } });
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-key');
  assert.match(sent.messages[0].content, /Answer in English/);
  assert.match(sent.messages[1].content, /\[1\] Simandou 2040 explained/);
});

test('asks for French when lang is fr', async () => {
  const { fetchImpl, calls } = groq('Réponse.');
  await handleAsk({ body: { ...BODY, lang: 'fr' }, apiKey: 'k', breaker: new CircuitBreaker(), fetchImpl });
  assert.match(JSON.parse(calls[0].init.body).messages[0].content, /Answer in French/);
});

test('reports when the passages do not contain the answer', async () => {
  for (const reply of [NO_ANSWER, ' NO_ANSWER.', '**NO_ANSWER**']) {
    const out = await run(groq(reply).fetchImpl);
    assert.deepEqual(out.json, { source: 'ai', found: false, answer: '' }, reply);
  }
});

test('falls back to local on every failure', async () => {
  const cases = {
    'http 500': groq('x', { status: 500 }).fetchImpl,
    'http 401 (bad key)': groq('x', { status: 401 }).fetchImpl,
    'http 429': groq('x', { status: 429, hdrs: { 'retry-after': 5 } }).fetchImpl,
    'empty answer': groq('   ').fetchImpl,
    'cut off by length': groq('Half an ans', { finish: 'length' }).fetchImpl,
    'network error': async () => { throw new TypeError('fetch failed'); },
    'timeout': async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); },
    'bad json': async () => ({ status: 200, ok: true, headers: headers(), json: async () => { throw new SyntaxError('x'); } }),
  };
  for (const [name, fetchImpl] of Object.entries(cases)) {
    assert.deepEqual((await run(fetchImpl)).json, { source: 'local' }, name);
  }
});

test('no API key: local, without calling Groq', async () => {
  const { fetchImpl, calls } = groq('x');
  const out = await handleAsk({ body: BODY, apiKey: '', breaker: new CircuitBreaker(), fetchImpl });
  assert.deepEqual(out.json, { source: 'local' });
  assert.equal(calls.length, 0);
});

test('rejects malformed requests without calling Groq', async () => {
  const bad = [
    null, {}, { ...BODY, question: '' }, { ...BODY, question: 'x'.repeat(501) }, { ...BODY, lang: 'de' },
    { ...BODY, passages: [] }, { ...BODY, passages: Array(6).fill(BODY.passages[0]) },
    { ...BODY, passages: [{ title: 'x' }] }, { ...BODY, passages: [{ title: 'x', text: '  ' }] },
  ];
  for (const body of bad) {
    const { fetchImpl, calls } = groq('x');
    const out = await handleAsk({ body, apiKey: 'k', breaker: new CircuitBreaker(), fetchImpl });
    assert.deepEqual(out, { status: 400, json: { source: 'local' } });
    assert.equal(calls.length, 0);
  }
  assert.equal(validate({ ...BODY, passages: [{ title: 't', text: 'y'.repeat(5000) }] }).passages[0].text.length, 1200);
});

test('breaker: skips the call before the per-minute request limit', async () => {
  const breaker = new CircuitBreaker({ rpm: 5, rpd: 1000, tpm: 1e9, tpd: 1e9 }, 0.8);
  const { fetchImpl, calls } = groq('ok');
  let t = 0;
  const now = () => t;
  const results = [];
  for (let i = 0; i < 6; i++) results.push((await handleAsk({ body: BODY, apiKey: 'k', breaker, fetchImpl, now })).json.source);
  assert.deepEqual(results, ['ai', 'ai', 'ai', 'ai', 'local', 'local']); // 80% of 5 = 4
  assert.equal(calls.length, 4);
  t = 61 * 1000; // a minute later the window has room again
  assert.equal((await handleAsk({ body: BODY, apiKey: 'k', breaker, fetchImpl, now })).json.source, 'ai');
});

test('breaker: skips the call when the tokens would pass the per-minute limit', () => {
  const b = new CircuitBreaker({ rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 }, 0.8);
  assert.ok(b.tryAcquire(3000, 0));
  assert.ok(b.tryAcquire(3000, 1));
  assert.equal(b.tryAcquire(1000, 2), null); // 7000 > 6400
  assert.ok(b.tryAcquire(400, 3)); // 6400 fits exactly
});

test('breaker: actual token counts replace the estimate', () => {
  const b = new CircuitBreaker({ rpm: 30, rpd: 1000, tpm: 1000, tpd: 1e9 }, 1);
  const t1 = b.tryAcquire(900, 0);
  assert.equal(b.tryAcquire(200, 1), null);
  b.settle(t1, 300);
  assert.ok(b.tryAcquire(200, 2));
});

test('breaker: per-day request limit', () => {
  const b = new CircuitBreaker({ rpm: 1e9, rpd: 10, tpm: 1e9, tpd: 1e9 }, 0.8);
  for (let i = 0; i < 8; i++) assert.ok(b.tryAcquire(1, i));
  assert.equal(b.tryAcquire(1, 9), null);
  assert.ok(b.tryAcquire(1, 24 * 3600 * 1000 + 10)); // a day later
});

test('breaker: pauses when Groq headers say the minute is nearly used', async () => {
  const breaker = new CircuitBreaker();
  const hdrs = { 'x-ratelimit-limit-tokens': 8000, 'x-ratelimit-remaining-tokens': 1000, 'x-ratelimit-reset-tokens': '7.5s' };
  const { fetchImpl, calls } = groq('ok', { hdrs });
  let t = 0;
  const now = () => t;
  assert.equal((await handleAsk({ body: BODY, apiKey: 'k', breaker, fetchImpl, now })).json.source, 'ai');
  assert.equal((await handleAsk({ body: BODY, apiKey: 'k', breaker, fetchImpl, now })).json.source, 'local');
  assert.equal(calls.length, 1);
  t = 8000;
  assert.equal(breaker.tryAcquire(1, t) !== null, true);
});

test('breaker: pauses after a 429 for retry-after seconds', async () => {
  const breaker = new CircuitBreaker();
  let t = 0;
  const now = () => t;
  await handleAsk({ body: BODY, apiKey: 'k', breaker, fetchImpl: groq('x', { status: 429, hdrs: { 'retry-after': 5 } }).fetchImpl, now });
  assert.equal(breaker.tryAcquire(1, 4999), null);
  assert.ok(breaker.tryAcquire(1, 5000));
});

test('parseDuration', () => {
  assert.equal(parseDuration('7.66s'), 7660);
  assert.equal(parseDuration('2m59.56s'), 179560);
  assert.equal(parseDuration('1h2m'), 3720000);
  assert.equal(parseDuration('120ms'), 120);
  assert.equal(parseDuration('soon'), null);
  assert.equal(parseDuration(null), null);
});

test('never logs the question text', async () => {
  const lines = [];
  const log = { info: (...a) => lines.push(JSON.stringify(a)) };
  await run(groq('ok').fetchImpl, { log });
  await run(async () => { throw new Error('x'); }, { log });
  assert.equal(lines.length, 2);
  for (const l of lines) assert.ok(!l.includes('Simandou'), l);
});

test('visitor limit: 5 per minute, then allowed again a minute later', () => {
  const l = new RateLimiter();
  for (let i = 0; i < 5; i++) assert.ok(l.allow('a', i * 1000), `request ${i + 1}`);
  assert.equal(l.allow('a', 5000), false);
  assert.ok(l.allow('b', 5000), 'another visitor is not affected');
  assert.ok(l.allow('a', 61 * 1000));
});

test('visitor limit: 30 per hour and 60 per day', () => {
  const l = new RateLimiter();
  const min = 60 * 1000;
  let t = 0, ok = 0;
  for (let i = 0; i < 40; i++, t += min / 2) if (l.allow('a', t)) ok++; // one every 30 s for 20 minutes
  assert.equal(ok, 30, 'hourly cap');
  const d = new RateLimiter();
  let n = 0;
  for (let i = 0; i < 100; i++) if (d.allow('a', i * 13 * min)) n++; // one every 13 minutes for ~21 h
  assert.equal(n, 60);
  assert.ok(d.allow('a', 25 * 60 * min + 100 * 13 * min), 'next day');
});

test('visitor limit: refused requests are not counted, and old visitors are swept', () => {
  const l = new RateLimiter([{ windowMs: 1000, max: 1 }], 3);
  assert.ok(l.allow('a', 0));
  for (let i = 1; i < 50; i++) l.allow('a', i);
  assert.ok(l.allow('a', 1000));
  for (const k of ['b', 'c', 'd', 'e']) l.allow(k, 2000);
  l.allow('f', 10 * 60 * 1000 + 5000);
  assert.ok(l.hits.size <= 3);
});

test('visitor key: uses the last X-Forwarded-For entry, never stores the IP', () => {
  const real = visitorKey({ 'x-forwarded-for': '203.0.113.7' });
  assert.equal(visitorKey({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }), real, 'a spoofed first entry is ignored');
  assert.notEqual(visitorKey({ 'x-forwarded-for': '198.51.100.9' }), real);
  assert.equal(visitorKey({}, '203.0.113.7'), real, 'falls back to req.ip');
  assert.ok(!real.includes('203'));
});
