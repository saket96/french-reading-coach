# DualCoach Privacy Policy

Last updated: 2026-10-21

DualCoach is the dual-subtitle Chrome extension companion to **Coach de lecture française**. It shows two subtitle tracks on YouTube, Netflix, and other sites that expose HTML5 video captions, and lets you look up words. This policy explains what data it handles.

## Summary

- No account, no sign-in.
- No analytics, no tracking, no ads.
- No remote code: everything the extension runs ships inside the extension package.
- Your settings and saved vocabulary are stored locally in Chrome (`chrome.storage`). Settings may sync between your own Chrome browsers if you use Chrome Sync; the developer never receives them.

## What leaves your browser, and when

- **Dictionary lookups.** When you click a word, that word (and, when Wiktionary says it is a form of another word, that base word) is sent to Wiktionary, a Wikimedia project (`en.wiktionary.org`), to fetch its definition. Wikimedia's own privacy policy applies to those requests: https://foundation.wikimedia.org/wiki/Policy:Privacy_policy
- **AI explanations (optional, off by default).** If you add your own API key for OpenRouter, Google Gemini, or Anthropic, the expression you selected and the subtitle sentence it appeared in are sent directly from your browser to the provider you chose, using your key. Nothing goes through a server run by the developer. The provider's privacy terms apply. Your API key is stored only in this browser (`chrome.storage.local`) and is sent only to that provider.
- **Translation.** Chrome's built-in translator runs on your device. Chrome may download a language model the first time you translate between two languages.

## Subtitles

Subtitle text is read from the YouTube or Netflix page only to display it. It is never uploaded or stored, except the lines you choose to save to your vocabulary list, which stay in your browser.

## Stored on your device

- Settings (languages, display options, AI provider and model).
- Your AI API key, if you add one.
- Your vocabulary list: the word, its base form, language, meaning, the subtitle sentence and its translation, the video title, link and time, and when you saved it.
- A cache of recent dictionary and AI results, so repeated lookups don't send new requests.

You can delete your vocabulary and clear the cache from the extension's settings page. Removing the extension deletes all of its local data.

## Permissions

- `storage`, `unlimitedStorage`: keep settings, vocabulary and the lookup cache on your device.
- `tts`: read words aloud with Chrome's text-to-speech.
- Access to web pages (`http`/`https`): show dual subtitles on YouTube, Netflix, and other sites that expose HTML5 video caption tracks.
- Access to `en.wiktionary.org`: fetch definitions.
- Optional access to `api.opensubtitles.com`: requested only when you save or test an OpenSubtitles API key; used to search/download subtitle files you choose.
- Optional access to `openrouter.ai`, `generativelanguage.googleapis.com`, or `api.anthropic.com`: requested only when you save or test an API key for that provider.

## Contact

Questions: [saketsuman.com/contact](https://saketsuman.com/contact/)
