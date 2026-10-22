// Wordly - dictionary single page app.
// Data comes from the Free Dictionary API: https://freedictionaryapi.com/

const API_URL = 'https://freedictionaryapi.com/api/v1/entries/en/';
const SAVED_KEY = 'wordly-saved';
const THEME_KEY = 'wordly-theme';
const MAX_SYNONYMS = 12;
const REQUEST_TIMEOUT_MS = 8000; // how long one request may take before it is cancelled
const RETRY_DELAY_MS = 700;      // short pause before the automatic retry

// Holds references to page elements. Filled in by init().
const els = {};

/* ------------------------------------------------------------------
   Input and data helpers (no DOM, so they can be tested in Node)
------------------------------------------------------------------ */

// Trims the text and lowercases it so "  Harbor " and "harbor" are the same search.
function cleanQuery(raw) {
  return String(raw || '').trim().toLowerCase();
}

// Returns true if the cleaned query looks like a word: letters, with optional
// hyphens, apostrophes or single spaces between letter groups. Max 50 characters.
function isValidQuery(query) {
  if (!query || query.length > 50) return false;
  return /^[a-z]+(?:[ '-][a-z]+)*$/.test(query);
}

// Gets the written pronunciation (e.g. /hɑːbə/) from an API entry.
function getPhonetic(entry) {
  const pronunciation = (entry.pronunciations || []).find((p) => p.text);
  return pronunciation ? pronunciation.text : '';
}

// Finds available pronunciation audio. Protocol-relative URLs get https: added.
function getAudioUrl(entry) {
  const withAudio = (entry.pronunciations || []).find((p) => p.audio || p.audioUrl);
  if (!withAudio) return '';
  const audio = withAudio.audio || withAudio.audioUrl;
  return audio.startsWith('//') ? 'https:' + audio : audio;
}

function collectSenseSynonyms(sense, found) {
  (sense.synonyms || []).forEach((synonym) => found.add(synonym));
  (sense.subsenses || []).forEach((subsense) => collectSenseSynonyms(subsense, found));
}

// Gathers synonyms from every sense and subsense in an entry,
// removes duplicates, and caps the list at MAX_SYNONYMS.
function collectSynonyms(entry) {
  const found = new Set();
  (entry.synonyms || []).forEach((synonym) => found.add(synonym));
  (entry.senses || []).forEach((sense) => collectSenseSynonyms(sense, found));
  return Array.from(found).slice(0, MAX_SYNONYMS);
}

function parseSenses(senses) {
  return senses.flatMap((sense) => [
    {
      definition: sense.definition,
      example: sense.example || (sense.examples || [])[0] || '',
    },
    ...parseSenses(sense.subsenses || []),
  ]).filter((definition) => definition.definition);
}

// Turns the API's entries/senses response into one simple object for display.
function parseEntry(apiData) {
  const entries = apiData.entries || [];
  const firstEntry = entries[0] || {};

  return {
    word: apiData.word || firstEntry.word,
    phonetic: entries.map(getPhonetic).find(Boolean) || '',
    audio: entries.map(getAudioUrl).find(Boolean) || '',
    meanings: entries.map((entry) => ({
      partOfSpeech: entry.partOfSpeech || 'unknown',
      definitions: parseSenses(entry.senses || []),
    })),
    synonyms: entries.flatMap((entry) => collectSynonyms(entry)).filter(
      (synonym, index, all) => all.indexOf(synonym) === index,
    ).slice(0, MAX_SYNONYMS),
    sources: apiData.source && apiData.source.url ? [apiData.source.url] : [],
  };
}

// Picks the message shown to the user for a failed request.
// A 404 means the word is not in the dictionary; anything else is a general failure.
function getErrorMessage(status) {
  if (status === 404) {
    return 'Word not found. Check the spelling or try a different word.';
  }
  return 'The dictionary could not be reached. Check your connection and try again.';
}

// Waits for the given number of milliseconds. Used between the two attempts.
function pause(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Decides whether a failed attempt is worth repeating. Status 0 means no answer
// at all (offline or timed out). Server errors (5xx) and 429 are usually brief.
// A 404 is never retried because the word really is not there.
function shouldRetry(status) {
  return status === 0 || status === 429 || status >= 500;
}

// Makes one request and cancels it if it takes longer than timeoutMs.
// A cancelled request throws, which the caller treats like a connection failure.
async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Requests a word from the API. Each attempt has a timeout, and one automatic
// retry is made after a timeout, a connection failure or a temporary server error.
// Resolves with the parsed JSON, or throws an Error whose message is safe to show.
// options (optional): timeoutMs and retryDelayMs, mainly so tests can run fast.
async function fetchWord(word, options = {}) {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
  const url = API_URL + encodeURIComponent(word);
  const maxAttempts = 2; // the first try plus one retry
  let lastStatus = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await pause(retryDelayMs);
    try {
      const response = await fetchWithTimeout(url, timeoutMs);
      if (response.ok) return await response.json();
      lastStatus = response.status;
      if (!shouldRetry(lastStatus)) break;
    } catch (err) {
      // timeout, offline, DNS or CORS-blocked error page: no usable answer
      lastStatus = 0;
    }
  }
  throw new Error(getErrorMessage(lastStatus));
}

/* ------------------------------------------------------------------
   Saved words (stored in the browser with localStorage)
------------------------------------------------------------------ */

// Reads the saved word list from localStorage. Returns [] if nothing is
// stored or the stored value is damaged.
function loadSaved() {
  try {
    const list = JSON.parse(localStorage.getItem(SAVED_KEY));
    return Array.isArray(list) ? list : [];
  } catch (err) {
    return [];
  }
}

// Writes the saved word list back to localStorage.
function storeSaved(list) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(list));
}

// Checks whether a word is already in the saved list.
function isSaved(word) {
  return loadSaved().includes(word.toLowerCase());
}

// Adds the word if it is not saved yet, removes it if it is.
// Returns true when the word ends up saved.
function toggleSaved(word) {
  const key = word.toLowerCase();
  const list = loadSaved();
  const index = list.indexOf(key);
  if (index === -1) {
    list.push(key);
  } else {
    list.splice(index, 1);
  }
  storeSaved(list);
  return index === -1;
}

/* ------------------------------------------------------------------
   Display functions
------------------------------------------------------------------ */

// Empties the results area so new content can be added.
function clearResults() {
  els.results.textContent = '';
}

// Shows a loading message and marks the results area as busy for screen readers.
function showLoading(word) {
  clearResults();
  els.results.setAttribute('aria-busy', 'true');
  const p = document.createElement('p');
  p.className = 'message-loading';
  p.setAttribute('role', 'status');
  const spinner = document.createElement('span');
  spinner.className = 'loading-spinner';
  spinner.setAttribute('aria-hidden', 'true');
  p.appendChild(spinner);
  p.appendChild(document.createTextNode('Looking up "' + word + '"...'));
  els.results.appendChild(p);
}

// Shows an error box in the results area.
function showError(message) {
  clearResults();
  els.results.setAttribute('aria-busy', 'false');
  const box = document.createElement('div');
  box.className = 'message-error';
  box.setAttribute('role', 'alert');
  const label = document.createElement('strong');
  label.textContent = 'Error: ';
  box.appendChild(label);
  box.appendChild(document.createTextNode(message));
  els.results.appendChild(box);
}

// Builds a small paragraph used when a piece of data is missing,
// for example "No synonyms found."
function createFallback(text) {
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = text;
  return p;
}

// Builds the block for one part of speech with its numbered definitions
// and the example sentences when the API supplies them.
function createMeaning(meaning) {
  const section = document.createElement('section');
  section.className = 'meaning';

  const heading = document.createElement('h3');
  heading.className = 'part-of-speech';
  heading.textContent = meaning.partOfSpeech;
  section.appendChild(heading);

  const list = document.createElement('ol');
  list.className = 'definitions';
  meaning.definitions.forEach((d) => {
    const li = document.createElement('li');
    li.textContent = d.definition;
    if (d.example) {
      const ex = document.createElement('p');
      ex.className = 'example';
      ex.textContent = 'Example: ' + d.example;
      li.appendChild(ex);
    }
    list.appendChild(li);
  });
  section.appendChild(list);
  return section;
}

// Builds the synonym section. Each synonym is a button that searches for it.
// Shows a fallback message if the word has no synonyms.
function createSynonyms(synonyms) {
  const section = document.createElement('section');
  section.className = 'synonyms';

  const heading = document.createElement('h3');
  heading.className = 'section-title';
  heading.textContent = 'Synonyms';
  section.appendChild(heading);

  if (synonyms.length === 0) {
    section.appendChild(createFallback('No synonyms found for this word.'));
    return section;
  }

  const list = document.createElement('ul');
  list.className = 'chip-list';
  synonyms.forEach((syn) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip chip-synonym';
    btn.textContent = syn;
    btn.setAttribute('aria-label', 'Search for ' + syn);
    btn.addEventListener('click', () => searchWord(syn));
    li.appendChild(btn);
    list.appendChild(li);
  });
  section.appendChild(list);
  return section;
}

// Builds the source links section at the bottom of a result.
function createSources(sources) {
  const section = document.createElement('section');
  section.className = 'sources';
  if (sources.length === 0) {
    section.appendChild(createFallback('No source information available.'));
    return section;
  }
  const label = document.createElement('span');
  label.textContent = 'Source: ';
  section.appendChild(label);
  sources.forEach((url, i) => {
    if (i > 0) section.appendChild(document.createTextNode(', '));
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = url;
    section.appendChild(a);
  });
  return section;
}

// Plays a pronunciation file. If the browser blocks or fails to load the audio,
// an error message is shown instead of failing silently.
function playAudio(url) {
  const audio = new Audio(url);
  audio.play().catch(() => {
    showAudioError();
  });
}

// Puts a short message next to the pronunciation when audio cannot be played.
function showAudioError() {
  const slot = document.getElementById('audio-status');
  if (slot) slot.textContent = 'Audio could not be played.';
}

// Updates a Save button and the result card to match whether the word is saved.
// The "is-saved" class is what turns the card red.
function updateSaveState(button, card, saved) {
  button.setAttribute('aria-pressed', String(saved));
  button.textContent = saved ? 'Saved' : 'Save';
  card.classList.toggle('is-saved', saved);
}

// Builds the whole result card for a parsed word and puts it on the page.
function renderResult(data) {
  clearResults();
  els.results.setAttribute('aria-busy', 'false');

  const card = document.createElement('article');
  card.className = 'result-card';

  // Top row: word, pronunciation text, and the action buttons
  const top = document.createElement('div');
  top.className = 'result-top';

  const titleBox = document.createElement('div');
  const h2 = document.createElement('h2');
  h2.className = 'word';
  h2.textContent = data.word;
  titleBox.appendChild(h2);

  const phon = document.createElement('p');
  phon.className = 'phonetic';
  phon.textContent = data.phonetic || 'No pronunciation text available';
  titleBox.appendChild(phon);
  top.appendChild(titleBox);

  const actions = document.createElement('div');
  actions.className = 'result-actions';

  if (data.audio) {
    const listen = document.createElement('button');
    listen.type = 'button';
    listen.className = 'btn btn-outline';
    listen.textContent = 'Listen';
    listen.setAttribute('aria-label', 'Play pronunciation of ' + data.word);
    listen.addEventListener('click', () => playAudio(data.audio));
    actions.appendChild(listen);
  }

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn btn-save';
  save.setAttribute('aria-label', 'Save ' + data.word + ' to your saved words');
  updateSaveState(save, card, isSaved(data.word));
  save.addEventListener('click', () => {
    const nowSaved = toggleSaved(data.word);
    updateSaveState(save, card, nowSaved);
    renderSavedList();
  });
  actions.appendChild(save);
  top.appendChild(actions);
  card.appendChild(top);

  // Message area for audio problems, or for words with no audio at all
  const status = document.createElement('p');
  status.id = 'audio-status';
  status.className = 'hint';
  if (!data.audio) status.textContent = 'No audio available for this word.';
  card.appendChild(status);

  // Definitions
  if (data.meanings.length === 0) {
    card.appendChild(createFallback('No definitions were returned for this word.'));
  } else {
    data.meanings.forEach((m) => card.appendChild(createMeaning(m)));
  }

  card.appendChild(createSynonyms(data.synonyms));
  card.appendChild(createSources(data.sources));
  els.results.appendChild(card);
}

// Redraws the "Saved words" list. Each saved word is a button that searches it.
function renderSavedList() {
  const list = loadSaved();
  els.savedList.textContent = '';
  els.savedEmpty.hidden = list.length > 0;

  list.forEach((word) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = word;
    btn.setAttribute('aria-label', 'Search for saved word ' + word);
    btn.addEventListener('click', () => searchWord(word));
    li.appendChild(btn);
    els.savedList.appendChild(li);
  });
}

/* ------------------------------------------------------------------
   Themes
------------------------------------------------------------------ */

// Sets the theme ("light" or "dark") on the page and updates the toggle button.
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const dark = theme === 'dark';
  els.themeToggle.setAttribute('aria-pressed', String(dark));
  els.themeToggle.textContent = dark ? 'Light mode' : 'Dark mode';
}

// Switches between light and dark and remembers the choice.
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (err) {
    // storage may be blocked; the theme still changes for this visit
  }
}

/* ------------------------------------------------------------------
   Events
------------------------------------------------------------------ */

// Runs a full search: validates the text, shows loading, fetches, then shows
// the result or an error. Also used by synonym and saved-word buttons.
async function searchWord(rawWord) {
  const word = cleanQuery(rawWord);

  if (!word) {
    showError('Please type a word before searching.');
    return;
  }
  if (!isValidQuery(word)) {
    showError('"' + word + '" is not a valid word. Use letters, hyphens and apostrophes only.');
    return;
  }

  els.input.value = word;
  els.button.disabled = true;
  showLoading(word);

  try {
    const data = await fetchWord(word);
    renderResult(parseEntry(data));
  } catch (err) {
    showError(err.message);
  } finally {
    els.button.disabled = false;
  }
}

// Handles the search form being submitted. Stops the page from reloading.
function handleSubmit(event) {
  event.preventDefault();
  searchWord(els.input.value);
}

// Finds the page elements, restores the saved theme, draws the saved list
// and attaches the event listeners. Runs once when the page loads.
function init() {
  els.form = document.getElementById('search-form');
  els.input = document.getElementById('search-input');
  els.button = document.getElementById('search-btn');
  els.results = document.getElementById('results');
  els.savedList = document.getElementById('saved-list');
  els.savedEmpty = document.getElementById('saved-empty');
  els.themeToggle = document.getElementById('theme-toggle');

  let theme = 'light';
  try {
    theme = localStorage.getItem(THEME_KEY) || 'light';
  } catch (err) {
    // ignore and use light
  }
  applyTheme(theme);
  renderSavedList();

  els.form.addEventListener('submit', handleSubmit);
  els.themeToggle.addEventListener('click', toggleTheme);
}

// Start the app in the browser. In Node (during tests) there is no document,
// so the functions are exported instead.
if (typeof document !== 'undefined') {
  init();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    cleanQuery,
    isValidQuery,
    getPhonetic,
    getAudioUrl,
    collectSynonyms,
    parseEntry,
    getErrorMessage,
    shouldRetry,
    fetchWord,
  };
}