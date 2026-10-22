// Tests for the data and input functions in index.js.
// Run with: node --test src/index.test.js
// Needs Node 18 or newer. No packages to install.

const test = require('node:test');
const assert = require('node:assert');
const {
  cleanQuery,
  isValidQuery,
  getPhonetic,
  getAudioUrl,
  collectSynonyms,
  parseEntry,
  getErrorMessage,
  shouldRetry,
  fetchWord,
} = require('./index.js');

// A trimmed-down copy of the new API's response for a normal word.
const sampleResponse = {
  word: 'harbor',
  entries: [
    {
      partOfSpeech: 'noun',
      pronunciations: [{ type: 'ipa', text: '/ˈhɑːbə/' }],
      senses: [
        {
          definition: 'A sheltered expanse of water.',
          examples: ['The boats stayed in the harbor.'],
          synonyms: ['port'],
          subsenses: [{ definition: 'A place of refuge.', synonyms: ['haven'] }],
        },
      ],
      synonyms: [],
    },
    {
      partOfSpeech: 'verb',
      pronunciations: [{ type: 'ipa', text: '/ˈhɑːbə/', audio: '//audio.example/harbor.mp3' }],
      senses: [{ definition: 'To provide a safe place for.' }],
      synonyms: [],
    },
  ],
  source: { url: 'https://en.wiktionary.org/wiki/harbor' },
};

/* ---------- empty and invalid input ---------- */

test('cleanQuery trims and lowercases', () => {
  assert.strictEqual(cleanQuery('  Harbor '), 'harbor');
});

test('cleanQuery handles empty, null and undefined', () => {
  assert.strictEqual(cleanQuery(''), '');
  assert.strictEqual(cleanQuery(null), '');
  assert.strictEqual(cleanQuery(undefined), '');
});

test('isValidQuery accepts normal words', () => {
  assert.ok(isValidQuery('harbor'));
  assert.ok(isValidQuery("don't"));
  assert.ok(isValidQuery('well-known'));
  assert.ok(isValidQuery('ice cream'));
});

test('isValidQuery rejects empty text, numbers and symbols', () => {
  assert.ok(!isValidQuery(''));
  assert.ok(!isValidQuery('   '));
  assert.ok(!isValidQuery('abc123'));
  assert.ok(!isValidQuery('<script>'));
  assert.ok(!isValidQuery('-start'));
  assert.ok(!isValidQuery('a'.repeat(51)));
});

/* ---------- parsing a valid response ---------- */

test('getPhonetic uses the first available pronunciation', () => {
  const entry = { pronunciations: [{ audio: '' }, { text: '/abc/' }] };
  assert.strictEqual(getPhonetic(entry), '/abc/');
});

test('getPhonetic returns empty string when there is none', () => {
  assert.strictEqual(getPhonetic({}), '');
  assert.strictEqual(getPhonetic({ pronunciations: [] }), '');
});

test('getAudioUrl adds https to protocol-relative links', () => {
  assert.strictEqual(getAudioUrl(sampleResponse.entries[1]), 'https://audio.example/harbor.mp3');
});

test('getAudioUrl returns empty string when no audio exists', () => {
  assert.strictEqual(getAudioUrl({ pronunciations: [{ text: '/x/', audio: '' }] }), '');
  assert.strictEqual(getAudioUrl({}), '');
});

test('collectSynonyms merges and removes duplicates', () => {
  const result = collectSynonyms(sampleResponse.entries[0]);
  assert.deepStrictEqual(result.sort(), ['haven', 'port']);
});

test('collectSynonyms returns empty list when there are none', () => {
  assert.deepStrictEqual(collectSynonyms({ senses: [] }), []);
  assert.deepStrictEqual(collectSynonyms({}), []);
});

test('collectSynonyms stops at 12', () => {
  const many = Array.from({ length: 30 }, (_, i) => 'word' + i);
  const entry = { senses: [{ synonyms: many }] };
  assert.strictEqual(collectSynonyms(entry).length, 12);
});

test('parseEntry builds the expected object', () => {
  const parsed = parseEntry(sampleResponse);
  assert.strictEqual(parsed.word, 'harbor');
  assert.strictEqual(parsed.phonetic, '/ˈhɑːbə/');
  assert.strictEqual(parsed.meanings.length, 2);
  assert.strictEqual(parsed.meanings[0].partOfSpeech, 'noun');
  assert.strictEqual(parsed.meanings[0].definitions[0].example, 'The boats stayed in the harbor.');
  assert.strictEqual(parsed.meanings[0].definitions[1].example, '');
  assert.deepStrictEqual(parsed.sources, ['https://en.wiktionary.org/wiki/harbor']);
});

test('parseEntry handles a word with no synonyms, audio or phonetic', () => {
  const bare = { word: 'zzz', entries: [{ partOfSpeech: 'noun', senses: [{ definition: 'Sleep.' }] }] };
  const parsed = parseEntry(bare);
  assert.strictEqual(parsed.phonetic, '');
  assert.strictEqual(parsed.audio, '');
  assert.deepStrictEqual(parsed.synonyms, []);
  assert.deepStrictEqual(parsed.sources, []);
});

test('parseEntry reads audio and examples from the Free Dictionary API format', () => {
  const parsed = parseEntry(sampleResponse);
  assert.strictEqual(parsed.word, 'harbor');
  assert.strictEqual(parsed.phonetic, '/ˈhɑːbə/');
  assert.strictEqual(parsed.audio, 'https://audio.example/harbor.mp3');
  assert.strictEqual(parsed.meanings.length, 2);
  assert.strictEqual(parsed.meanings[0].partOfSpeech, 'noun');
  assert.deepStrictEqual(parsed.meanings[0].definitions, [
    { definition: 'A sheltered expanse of water.', example: 'The boats stayed in the harbor.' },
    { definition: 'A place of refuge.', example: '' },
  ]);
  assert.deepStrictEqual(parsed.synonyms, ['port', 'haven']);
  assert.deepStrictEqual(parsed.sources, ['https://en.wiktionary.org/wiki/harbor']);
});

/* ---------- errors and fetching ---------- */

test('getErrorMessage gives a not-found message for 404', () => {
  assert.match(getErrorMessage(404), /not found/i);
});

test('getErrorMessage gives a connection message for other failures', () => {
  assert.match(getErrorMessage(500), /could not be reached/i);
  assert.match(getErrorMessage(0), /could not be reached/i);
});

test('fetchWord returns JSON on success', async () => {
  global.fetch = async () => ({ ok: true, json: async () => sampleResponse });
  const data = await fetchWord('harbor');
  assert.strictEqual(data.word, 'harbor');
});

test('fetchWord throws a not-found error on 404', async () => {
  global.fetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(() => fetchWord('asdfgh'), /not found/i);
});

test('fetchWord throws a connection error when the request fails', async () => {
  global.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(() => fetchWord('harbor', { retryDelayMs: 0 }), /could not be reached/i);
});

test('fetchWord encodes the word in the URL', async () => {
  let requested = '';
  global.fetch = async (url) => { requested = url; return { ok: true, json: async () => [] }; };
  await fetchWord('ice cream');
  assert.strictEqual(requested, 'https://freedictionaryapi.com/api/v1/entries/en/ice%20cream');
});

/* ---------- timeout and retry ---------- */

// Fast settings so the retry tests do not wait around
const fast = { timeoutMs: 30, retryDelayMs: 0 };

// A fake response object like the one fetch resolves with
const okResponse = { ok: true, status: 200, json: async () => sampleResponse };

test('shouldRetry is true for no answer, 429 and server errors', () => {
  assert.ok(shouldRetry(0));
  assert.ok(shouldRetry(429));
  assert.ok(shouldRetry(500));
  assert.ok(shouldRetry(530));
});

test('shouldRetry is false for 404 and other client errors', () => {
  assert.ok(!shouldRetry(404));
  assert.ok(!shouldRetry(400));
});

test('fetchWord retries once after a connection failure and then succeeds', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls++;
    if (calls === 1) throw new TypeError('Failed to fetch');
    return okResponse;
  };
  const data = await fetchWord('harbor', fast);
  assert.strictEqual(data.word, 'harbor');
  assert.strictEqual(calls, 2);
});

test('fetchWord retries once after a 530 and then succeeds', async () => {
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return calls === 1 ? { ok: false, status: 530 } : okResponse;
  };
  const data = await fetchWord('harbor', fast);
  assert.strictEqual(data.word, 'harbor');
  assert.strictEqual(calls, 2);
});

test('fetchWord gives up after the retry and shows the connection message', async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: false, status: 500 }; };
  await assert.rejects(() => fetchWord('harbor', fast), /could not be reached/i);
  assert.strictEqual(calls, 2);
});

test('fetchWord does not retry a 404', async () => {
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: false, status: 404 }; };
  await assert.rejects(() => fetchWord('asdfgh', fast), /not found/i);
  assert.strictEqual(calls, 1);
});

test('fetchWord cancels a slow request and retries', async () => {
  let calls = 0;
  global.fetch = (url, options) => {
    calls++;
    if (calls === 1) {
      // never answers until the timeout aborts it
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    return Promise.resolve(okResponse);
  };
  const data = await fetchWord('harbor', fast);
  assert.strictEqual(data.word, 'harbor');
  assert.strictEqual(calls, 2);
});

test('fetchWord reports a connection problem when every attempt times out', async () => {
  let calls = 0;
  global.fetch = (url, options) => {
    calls++;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  };
  await assert.rejects(() => fetchWord('harbor', fast), /could not be reached/i);
  assert.strictEqual(calls, 2);
});

test('fetchWord passes an abort signal to fetch', async () => {
  let received = null;
  global.fetch = async (url, options) => { received = options && options.signal; return okResponse; };
  await fetchWord('harbor', fast);
  assert.ok(received && typeof received.aborted === 'boolean');
});