# Wordly

Wordly is a lightweight, responsive dictionary single-page app built with HTML, CSS, and JavaScript. It looks up English words using the [Free Dictionary API](https://freedictionaryapi.com/), then displays available definitions, parts of speech, pronunciation, synonyms, and source information without reloading the page.

## Features

- Search by submitting the form or pressing **Enter**.
- View definitions grouped by part of speech, with examples when available.
- View phonetic spelling and play pronunciation audio when the API provides it.
- Browse available synonyms and search for them directly.
- View source links for dictionary entries.
- Save words in the browser and quickly search them again.
- Switch between light and dark themes; preferences are stored in the browser.
- Get loading feedback and clear messages for missing words or request failures.
- Use the responsive layout on desktop and mobile screens.

## Requirements

- A modern web browser with JavaScript enabled.
- An internet connection to access the dictionary API.
-Node.js 18 or newer, or another local static-file server.

No package installation or build step is required.

## Set up and run

Clone the repository and enter its directory:

```sh
git clone https://github.com/Rumoj/wordly.git
cd wordly
```


Open [http://localhost:8000](http://localhost:8000) in your browser. Stop the server with **Ctrl+C** when you are finished.

You can also serve the repository root with any static-file web server. Opening `index.html` directly may work in some browsers, but serving it over HTTP is recommended.

## Using Wordly

1. Enter an English word in the search box and press **Enter** or select **Search**.
2. Wait for the lookup to finish. The result shows the available pronunciation and definitions.
3. Select **Listen** to play audio when audio is available for the entry.
4. Select a synonym to look it up.
5. Select **Save** to add the current word to your saved list. Select a saved word to search for it again.
6. Use the theme button in the header to switch between light and dark themes.

If a word is not found, check its spelling and try again. If the API cannot be reached, check your internet connection and retry. Some entries do not include audio, synonyms, examples, or source information; Wordly indicates when that information is unavailable.

## Run tests

The tests use Node.js's built-in test runner and require no additional dependencies:

```sh
node --test src/index.test.js
```

## API

Wordly requests entries from:

```text
https://freedictionaryapi.com/api/v1/entries/en/{word}
```

The app reads the API's `entries`, `senses`, `pronunciations`, and `source` fields. API availability and the information returned for each word are controlled by the external service.

## Project files

```text
index.html         App page and accessible search form
style.css          Responsive layout, themes, and component styles
src/index.js       API requests, response parsing, and app interactions
src/index.test.js  Unit tests for search helpers, parsing, and requests
```
