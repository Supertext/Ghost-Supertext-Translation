# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- The status page in Supertext's look: deep-green header with the Supertext logo, warm off-white background, mint for finished translations, pill-shaped tags and buttons, the Inter font and the Supertext favicon. Logo, favicon and font are served by the connector itself at `/supertext/static/` (no font from a CDN) and work on phones.
- French and Italian interface (and German where it was missing): the status page, its messages and the tag descriptions are available in English, German, French and Italian. The status page follows the browser's language; `UI_LANGUAGE` sets one language for everyone and for new tag descriptions.
- The status page shows the connector version (linked to its GitHub release), and the startup log names it. Ghost has no plugin list, so this is where administrators see which version runs.
- Automatic API key check: at startup and whenever the key in `SUPERTEXT_API_KEY` is new or changed, and when Supertext rejects the key during a translation. The status page shows the latest result with its time (*the connection works*, *rejected*, *no key*, *Supertext can't be reached*, *error*) in English, German, French and Italian, with the account and API key links where they help.
- *Send version information to Supertext* (on by default, `SUPERTEXT_VERSION_REPORTS=0` turns it off): after an update and when the key check result changes, the connector sends the site URL, the connector, Ghost, Node.js and SDK versions, whether a key is set, the key check result and the ping address to Supertext. No content, no API key and no personal data. Shown on the status page.
- Public ping endpoint `GET /supertext/ping` that only echoes Supertext's challenge, so Supertext can check the installation is reachable (404 with version reports off). Its address is the site's own host in setup A, `CONNECTOR_URL` (new setting) in setup B.
- New setting `STATE_FILE` for this state (what was reported, the latest key check); the demo keeps it in its volume.
- New setting `SUPERTEXT_LANGUAGE_MAP` (`de=de-CH,zh=zh-Hans`): which Supertext language each configured language is sent as.
- **Language mapping on the status page**: one drop-down list per language (the source language first) with Supertext's languages as *Name (code)*, preselected with the saved choice, else the default (`de` → `de-DE`), else *— choose —*. Ghost Owners and Administrators save it (protected by the Ghost staff session and a CSRF token; only Supertext's codes are accepted); it applies without a restart and is kept in `supertext-settings.json` next to `STATE_FILE` (new setting `SUPERTEXT_SETTINGS_FILE`). `SUPERTEXT_LANGUAGE_MAP` stays as an override for automated setups: the languages it names are shown read-only. Existing `SUPERTEXT_LANGUAGE_MAP` values keep working unchanged.

### Changed

- Supertext SDK 0.4.0 (commit `6aaad33`): **defaults where they are obvious.** A language without mapping or exact Supertext code now uses the SDK's default instead of failing: `de`, `en`, `fr`, `it`, `pt` → `de-DE`, `en-US`, `fr-FR`, `it-IT`, `pt-PT`; `zh`, `zh-CN` → `zh-Hans`; `zh-TW` → `zh-Hant`; `sr` → `sr-Latn`; `es-ES` → `es`. Only languages without a default (`de-LI`, `en-IE`, `gsw`, `sr-RS`) still fail with *has no Supertext language yet*; the message now says to choose one on the status page (*Language mapping*), and the status page marks them *No Supertext language*.
- Version reports, the API key check result and the reachability ping now use [Supertext Plugin Health](https://github.com/Supertext/Commando-Center-Supertext-Translation/tree/main/plugin-health) 0.1.0 (bundled in `src/vendor/supertext-plugin-health`); Supertext SDK updated to 0.3.0. No change for sites: settings and stored state stay as they are.
- All Supertext API calls now go through the official Supertext SDK, bundled with the connector (nothing extra to install): SDK 0.2.1 (commit `eeba8fa`, `v1` namespace) with the key check, the version reports and the API's language list.
- **Languages are no longer guessed.** A code in `TARGET_LANGUAGES` or `SOURCE_LANGUAGE` that is a Supertext code (`de-CH`, `fr-CH`, `es`, `zh-Hans`, apart from case and `_`/`-`) is used as it is; every other code needs an entry in `SUPERTEXT_LANGUAGE_MAP`. There are no default regions any more: they were wrong for most languages (Supertext wants `es`, `sl`, `nl` without region, `zh-Hans` instead of `zh-CN`). An unmapped language gets the message *has no Supertext language yet* (four languages) and nothing is sent for it; the startup log and the status page mark it *Not mapped*. A site that listed a bare `de` adds `SUPERTEXT_LANGUAGE_MAP=de=de-DE` (tags don't change).
- Formal/informal for a language Supertext offers no tone for (English, Swiss German, Romansh, Albanian, Serbian): set for that language, its translations fail with the new message *Supertext offers no formal or informal tone for this language* (nothing is sent); set for all languages, that language is translated with the default tone. The status page shows both.
- An unsupported language pair now has its own message ("Supertext does not support this language pair (en → xx-YY)") in all four interface languages. An unknown language (e.g. `xx-YY`) is now reported as an unsupported language pair too, not as "resource not found" (Supertext answers it with HTTP 404).
- The "No Supertext API key" and "Authentication failure" messages now link to Supertext account signup as well as API key generation.

## [0.1.0] - 2026-10-07

### Added

- Connector service for Ghost 6: translation requested with internal tags (`#translate-<lang>`, `#translate-all`, `#retranslate-<lang>`, `#retranslate-all`), delivered by Ghost webhooks, written back as draft posts or pages tagged `#lang-<lang>`.
- Translates post fields (title, excerpt, SEO, social, feature image alt and caption), Lexical paragraphs, headings, lists and quotes with formatting and links kept, and the text of Ghost's cards.
- Overwrite protection: existing translations are updated only while they are unedited drafts; `#retranslate-*` replaces them anyway.
- The connector creates its request tags in Ghost on startup, with descriptions.
- Proxy mode: the connector serves the Ghost site, adds the staff-only status page at `/ghost/supertext/` and receives webhooks at `/supertext/webhook`.
- Supertext AI file translation API v1 client with rate-limit retries (HTTP 429).
- Demo image (Ghost 6 + connector, SQLite) with `DEMO_ADMIN_*` / `DEMO_EDITOR_*` accounts, integration and webhooks, language collections (`routes.yaml`), navigation links and a sample post, all created on startup.
- Installation, user and developer guides with screenshots generated by `npm run docs:screenshots`.
- Links to create a Supertext account and to generate the API key (supertext.com → Integrations → API, Admin role) on the status page, in the startup log, in the missing/invalid key errors, and in the README, installation guide and demo `.env.example`.
