# Developer guide

## Architecture

Ghost has no admin plugin API, so the integration is an external service built on three Ghost features:

1. **Internal tags** are the editor's "translate" button (`#translate-de-ch`). Ghost saves tag changes in post settings immediately.
2. **Webhooks** (`post.added`, `post.edited`, `page.added`, `page.edited`) tell the connector about saves. Ghost includes `previous.tags` only when the tags changed, so the connector reacts to tags that were *added* by that save.
3. The **Admin API** (custom integration key, JWT) reads the source with `formats=lexical` and creates/updates the translation.

The connector **never writes the source post**. Ghost rejects a save whose `updated_at` is older than the stored one ("Saving failed! Someone else is editing this post", `@tryghost/bookshelf-collision`), so touching the post an editor has open would break their next autosave. That is why request tags stay on the source and why results are reported on a status page instead of on the post. (Admin notifications would have been nicer, but API keys may not create them.)

```
src/
  index.ts           entry point: config, HTTP server, creates the request tags once Ghost is reachable
  config.ts          environment variables (+ optional settings file written by the demo)
  server.ts          HTTP: /supertext/webhook, /supertext/health, /supertext/ping (public), /ghost/supertext/ (status page), proxy to Ghost
  reporting.ts       Commando Center: version reports, API key check, ping (Plugin Health's InstallationReporter), state in STATE_FILE
  translate.ts       one source × one language: find existing translation, overwrite rules, translate, save
  collect.ts         which fields, Lexical blocks and card properties are translated
  lexical.ts         Lexical inline nodes <-> inline HTML with data-n markers
  segments.ts        segment model, HTML document for Supertext, parsing the answer
  languages.ts       target languages, Supertext codes (SUPERTEXT_LANGUAGE_MAP, no guessing), tag names, added tags → requests
  jobs.ts            recent requests for the status page (memory, optional JSON file)
  status-page.ts     status page HTML
  i18n/              UI strings: en.ts (source), de.ts, fr.ts, it.ts; t(), format(), pickLocale()
  version.ts         connector version, read once from package.json (status page, startup log)
  ghost/admin.ts     Admin API client (JWT from the integration key)
  ghost/webhook.ts   signature check and payload parsing
  supertext/client.ts wrapper around the Supertext SDK: localized errors, environments, API key links
  vendor/supertext-sdk/ copy of the Supertext SDK (TypeScript sources, API in v1/; never edit, see *Supertext SDK*)
  vendor/supertext-plugin-health/ copy of Supertext Plugin Health (TypeScript sources; never edit, see *Supertext Plugin Health*)
demo/                 Railway demo image (Ghost 6 + connector) and its bootstrap
test/                 Vitest suites, fakes of Ghost and Supertext; test/docs = screenshots
```

### Flow of one request

1. Editor adds `#translate-de-ch`; Ghost saves and POSTs `post.edited` to `/supertext/webhook?event=post.edited`, signed with the webhook secret.
2. `parseWebhook` diffs `current.tags` against `previous.tags`; `requestsFromTags` maps added tags to languages (`#retranslate-*` = force). The webhook is answered with 202 right away; work continues in the background. A second request for the same post and language while one runs is ignored.
3. `Translator.translate` loads the source. It skips translations (posts with a `#lang-*` tag or a marker) and fails clearly for posts without Lexical.
4. It looks for the existing translation with the Admin API filter `codeinjection_head:~'supertext:source=<id>;lang=<code>;'`.
5. Overwrite rules: no translation → create. Translation is a draft whose content hash matches the marker → update in place. Otherwise (edited, or not a draft) → **kept**, unless forced.
6. `collect` builds segments, `buildHtml` the document, the Supertext client translates it, `applyTranslations` writes back. Segments that came back empty keep the source text and are reported.
7. The translation is saved with public tags of the source + `#lang-<code>`, the source's authors, feature image, visibility (and tiers), featured flag, template, canonical URL and code injection, and the marker `<!-- supertext:source=<id>;lang=<code>;hash=<16 hex> -->` at the top of its code injection (head). New translations are drafts; Ghost builds the slug from the translated title.
8. If Ghost normalised the Lexical JSON, the marker is rewritten with the hash of what Ghost stored (one extra write).

The hash covers title, excerpt and body (`contentHash`, canonical JSON). Editing anything else of a translation (e.g. its feature image) doesn't count as an edit.

### Field rules

| What | How |
| --- | --- |
| `title`, `custom_excerpt`, `feature_image_alt`, `meta_title`, `meta_description`, `og_title`, `og_description`, `twitter_title`, `twitter_description`, `email_subject` | plain text segment |
| `feature_image_caption` | HTML segment |
| Lexical `paragraph`, `heading`/`extended-heading`, `quote`/`extended-quote`, `aside`, `listitem` | one segment each with inline formatting (see below); list items with a nested list are walked instead |
| Cards (`CARD_FIELDS` in `collect.ts`) | `image` caption/alt/title, `gallery` caption + image captions/alts, `callout` text, `toggle` heading/content, `button`, `header`, `signup`, `call-to-action`, `product`, `embed`/`bookmark`/`video` captions, `audio` title, `file` title/caption |
| Not translated | `html`, `markdown`, `codeblock`, `email`, `email-cta`, `paywall`, `transistor`, bookmark metadata, embed content, tags, slugs |

### HTML format

One `<div data-st-id="N">` per segment (div, because card HTML such as toggle content contains `<p>`):

```html
<div data-st-id="4">Hello <b data-n="0">bold world</b> and <a data-n="1" href="https://supertext.com">a link</a>.<br data-n="2">Line two.</div>
```

Text formats become `b`, `i`, `u`, `s`, `code`, `sub`, `sup`, `mark`; links `a href`. Nothing is marked `translate="no"`: the live API then leaves stray «» quotes next to the element, while plain `<code>` already comes back untranslated (checked October 2026). `data-n` points to the original Lexical node, which is cloned when rebuilding, so formatting follows the words when the translator reorders them. Tags the translator invents or duplicates are dropped (their text kept). This follows the project rule: never one `data-st-id` per formatted run.

## Supertext API protocol

AI file translation API v1, same as all Supertext plugins. Every call goes through the Supertext SDK (see below); this is what it does:

1. `POST translate/ai/file` multipart: `file` (`text/html`, exactly that content type), `target_lang` (a Supertext target code: `de-CH`, `es`), `source_lang` (bare language, `en`; see *Language codes*), `politeness` (`less`/`more`, omitted for default) → `{ file_id }`
2. `GET translate/ai/file/{id}/status` every 2 s until `done` (`error`, `limit_exceeded`, `deleted` fail), 3 min timeout
3. `GET translate/ai/file/{id}/translation` → translated HTML
4. `DELETE translate/ai/file/{id}` (best effort; files expire after 24 h)

Header `Authorization: Supertext-Auth-Key <key>` (a pasted prefix is stripped). HTTP 429 is retried 4 times (`Retry-After`, else 1/2/4/8 s with jitter). The API key check (the SDK's `checkApiKey()`, run by Plugin Health's reporter, see *Commando Center*) calls `GET features`, which costs nothing.

### Supertext SDK

The client (protocol, retries, the language list, the error codes) and the API key check (`checkApiKey()`, `apiKeyFingerprint`, `SDK_VERSION`) come from the official Supertext SDK ([Supertext/Supertext-API-SDK-and-Guide](https://github.com/Supertext/Supertext-API-SDK-and-Guide), TypeScript, 0.3.0); version reports and the ping are in *Supertext Plugin Health* (below). Its sources are copied into `src/vendor/supertext-sdk/` and compiled with the connector, so sites install nothing extra; `COMMIT` and `VERSION` there name the SDK revision. Everything that talks to the API is in the `v1/` folder (`import … from './vendor/supertext-sdk/v1/index.js'`); the top-level `index.ts` only re-exports it as `v1` with `SDK_VERSION`. The vendor script copies the whole tree.

- Never edit `src/vendor/`. Fix the SDK in its repo, then update the copy with `scripts/vendor-sdk.sh [ref]` (default: `main`; `SDK_DIR=/path/to/clone` uses a local clone) and run the tests.
- `src/supertext/client.ts` wraps the SDK client: it keeps the connector's options (`baseUrl`, `pollIntervalMs`, `timeoutMs`, `fetch`, `sleep`) and turns every SDK error (`SupertextError.code`, e.g. `invalid_language_pair`) into the connector's `SupertextError`, whose message is the key `error.<code>` in `src/i18n/` with parameters (API key links, HTTP status, language pair) plus the API's own detail.
- Every SDK error code needs an `error.<code>` string in all four languages; `npm run typecheck` fails otherwise.
- Even once the SDK is published on npm, the connector keeps bundling its copy.

### Supertext Plugin Health

[Supertext Plugin Health](https://github.com/Supertext/Commando-Center-Supertext-Translation/tree/main/plugin-health) (`plugin-health/typescript` in the Commando Center repository, 0.1.0) sends the version reports and the API key check result to the Supertext Commando Center and answers its reachability ping (`InstallationReporter`, `reportsEnabled()`, `reporterState()`, `pingResponse()`; see *Commando Center*). It has no dependencies and doesn't need the SDK: `src/reporting.ts` passes in the SDK's `SDK_VERSION` and a key checker built from the SDK's `checkApiKey()` and `apiKeyFingerprint`. Like the SDK, its sources are copied into `src/vendor/supertext-plugin-health/` (`import … from './vendor/supertext-plugin-health/index.js'`) and compiled with the connector; `COMMIT` and `VERSION` there name the revision.

- Never edit `src/vendor/supertext-plugin-health/`. Fix it in Commando-Center-Supertext-Translation/plugin-health, then update the copy with `scripts/vendor-plugin-health.sh <tag>` (e.g. `plugin-health-v0.1.0`; default `main`; `PLUGIN_HEALTH_DIR=/path/to/clone` uses a local clone) and run the tests.

### Language codes

Supertext accepts exactly the codes its `GET features` lists (the SDK's `Languages`, from the live API): bare sources (`en`, `de`); targets in one exact form each, regional for German, English, French, Italian and Portuguese (`de-CH`, `en-US`, `pt-BR`), with a script for Chinese and Serbian (`zh-Hans`, `sr-Latn`), `gsw-u-sd-chzh`/`chbe` for Swiss German, bare for the others (`es`, `nl`, `sl`). Anything else is HTTP 404 `INVALID_LANGUAGE_PAIR`; formal/informal for a target without it (`en-US`, `rm`, …) is HTTP 400 `FEATURE_ERROR` (`unsupported_feature`).

`src/languages.ts` turns the configured codes into Supertext codes with the SDK's `Languages`, **without guessing** (one mapping, `SUPERTEXT_LANGUAGE_MAP`, for targets and the source):

- `targetCode(code, map)`: the mapping wins (sent as it is); else a code that equals a Supertext code apart from case and `_`/`-` (`de-CH`, `fr_ch` → `fr-CH`, `es`); else `SupertextError('unsupported_language')`. There are no default regions: `de` must be mapped. `parseTargetLanguages` stores the result in `Language.target` (`null` = not mapped); the configured code (`Language.code`) still names the tags and the translation marker, so existing sites keep their tags.
- `sourceCode(code, map)`: the mapping in its source form (`en=en-US` → `en`), else the Supertext source for the code (`en-GB` → `en`), else `unsupported_language`.
- `Translator.codes()` resolves both before anything is sent; an unmapped language fails that job with `error.unsupported_language` (`{language}` and `{code}`), and Supertext is never called.
- Formal/informal: `Language.politenessUnsupported` is `blocked` when `SUPERTEXT_POLITENESS` sets a tone for that language and `Languages.supportsPoliteness(target)` is false (the job fails with `error.unsupported_feature`, nothing is sent), `ignored` when the tone comes from the all-languages value (sent with the default tone). Both are shown on the status page; `blocked` is also logged at startup.
- The startup log and the status page show the code each language is sent as and mark unmapped languages.

The stand-ins (`test/fakeSupertext.ts`, `test/docs/stand-in.mjs`) accept only listed codes and reject regional sources like the real API; `fakeSupertext.ts` also answers `FEATURE_ERROR` for a tone the target lacks.

### Commando Center: version reports, key check, ping

Protocol: [Commando-Center-Supertext-Translation](https://github.com/Supertext/Commando-Center-Supertext-Translation) → `docs/DEVELOPER.md` → *Report protocol*; Supertext Plugin Health's `InstallationReporter` and `pingResponse()` implement it, with the SDK's `checkApiKey()` and `apiKeyFingerprint` as the key checker (the SDK client gets `SUPERTEXT_API_URL` and the connector's User-Agent); `src/reporting.ts` only supplies what the connector knows:

- **Setting:** `SUPERTEXT_VERSION_REPORTS` (default on; Plugin Health's `reportsEnabled()`), read in `src/config.ts` like every other setting. Off: no reports, ping 404. `SUPERTEXT_REPORT_URL` sends reports elsewhere (tests, the screenshot stand-in).
- **Report fields:** `site_url` = `GHOST_URL`; plugin `Ghost-Supertext-Translation` (the GitHub repository name) with the version from `package.json` (`src/version.ts`); system `Ghost` with the version from the Admin API's `GET site/` (asked at most every 10 minutes; while Ghost can't be reached the last known version is used, so that isn't an "upgrade"); runtime Node.js (Plugin Health's default); `sdk_version` = the bundled SDK's `SDK_VERSION`; `callback.url` = `callbackUrl()`: `CONNECTOR_URL` + `/supertext/ping` (setup B), else the origin of `GHOST_URL` + `/supertext/ping` in setup A (the connector answers `/supertext/…` at the root of the host it serves), else none.
- **When:** settings live in the environment, so there is no `settings_saved` and no *Test connection* button. `onRequest` runs once at startup when Ghost is reachable (after the tags are in place: a restart is how settings change), in the background on every status page view, and after every translation job (reports `installed`, `upgraded` or `api_key_check`; checks the key only when its fingerprint changed). A job that failed with `authentication_failure` runs `authenticationFailed` instead (status `invalid`, reported once). Webhooks that request nothing (every autosave) don't run it. Calls are serialized per process; background runs are tracked in `idle()`. Nothing here ever throws into a request or a translation.
- **State:** the reporter's JSON state in `STATE_FILE` (written atomically via a temp file), kept in memory without it or when the file can't be written (`StateStore`). Plugin Health's state has the same format the SDK 0.1–0.2 reporter wrote, so the switch kept the history (no new `installed` report). The fingerprint stays local; the key is never stored or logged.
- **Ping:** `GET /supertext/ping` is handled before the proxy, needs no login and answers exactly what `pingResponse()` returns (status, headers including `Cache-Control: no-store`, body); other methods get 405.
- **Status page:** *API key check* (the center's message table in `keycheck.<status>`, with its time, and the account/API key links for `invalid`/`missing`), *Send version information to Supertext* (on/off, ping address, help text).

## Ghost facts this relies on (checked on Ghost 6.67)

- Webhook signature: `X-Ghost-Signature: sha256=<HMAC-SHA256(secret, rawBody + t)>, t=<ms>`.
- Webhooks to private IPs fail with `URL_PRIVATE_INVALID` unless the host equals the site URL's host; `localhost` fails with `URL invalid` (no TLD). In `NODE_ENV=development` both checks are off.
- Ghost 6 returns the integration's full Admin API key (`id:secret`) in `api_keys[].secret`.
- Integration keys can't create Admin notifications (`NoPermissionError`).
- Staff can only be created by invite, and an invite is only accepted (`status: sent`) if its mail went out.
- The session cookie has path `/ghost`.
- Admin API supports `field:~'substring'` filters, used for the marker.

## Local setup

```bash
npm ci
npm test            # Vitest
npm run typecheck
npm run build       # dist/
GHOST_URL=… GHOST_ADMIN_API_KEY=… npm start
```

## Tests

- `test/collect.test.ts`: segments and round trips on the Lexical of a real Ghost 6 post (`test/fixtures/probe-lexical.json`), formatting kept when words are reordered, lost segments.
- `test/webhook.test.ts`: signatures, payload parsing, tag → request mapping, Admin API JWT.
- `test/translate.test.ts`: the translator and the webhook server against `fakeGhost.ts` (mirrors Ghost's tag slugs, `~` filter and update-collision check) and `fakeSupertext.ts`: create, update in place, kept when edited/published, forced overwrite, one translation per language, skip translations, errors, unmapped languages and unsupported tones (nothing sent), the public ping route (200/400/405, 404 with reports off), and the reports after a translation (`installed`; a rejected key as `invalid`) to a fake center.
- `test/client.test.ts`: the SDK wrapper: protocol, status and HTTP error mapping, API key prefix, rate limiting, language-pair errors. `fakeSupertext.ts` reads the SDK's multipart body back as `FormData`.
- `test/languages.test.ts`: exact codes, no default regions (`de`, `zh-CN`, `es-ES` are unsupported), the mapping (targets and source), `SUPERTEXT_LANGUAGE_MAP` parsing, blocked/ignored tones.
- `test/reporting.test.ts`: ping address per setup, ping answers, state in `STATE_FILE` (also broken or unwritable), one `installed` report with the key check, Ghost version and ping address and never the key, `upgraded` only for a real version change, a 401 reported once, a missing key checked without a request, nothing sent with reports off, no exception when the center or Ghost fail, the status page's key check, setting, unmapped languages and tone warnings. Supertext is `fakeSupertext.ts`, the center a fake `fetch`; nothing reaches the live API or the center.
- `test/i18n.test.ts`: every catalog has the English keys with the same placeholders, tags and links; French non-breaking spaces; language choice; localized status page, errors and tag descriptions.

The real Ghost round trip is covered by the demo container (below) and the screenshot script, which drive the actual UI.

## CI / deploy

GitHub Actions (`.github/workflows/ci.yml`): typecheck, tests and build on Node 20 and 22. Railway builds `demo/Dockerfile` from `main` on every push.

## Demo

`demo/` builds one image: the official `ghost:6` image plus the connector. `demo/entrypoint.sh` starts Ghost on `127.0.0.1:2368` (SQLite in the volume at `/var/lib/ghost/content`), the connector on `$PORT` in front of it (setup A), and then `demo/bootstrap.mjs`. The public URL comes from `url`, `GHOST_URL` or `RAILWAY_PUBLIC_DOMAIN`.

The bootstrap runs on **every start** and only creates what is missing:

1. **Admin** from `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD` (fallback `GHOST_ADMIN_EMAIL` / `GHOST_ADMIN_PASSWORD`) through Ghost's setup API, so Ghost's first-run "create your account" screen never appears once these are set. Ghost role: **Owner**.
2. **Editor** from `DEMO_EDITOR_EMAIL` / `DEMO_EDITOR_PASSWORD`, Ghost role **Editor** (can edit all posts and pages and use all tags, so every language). Ghost only adds staff by e-mailed invite, so the bootstrap opens a throw-away SMTP listener on `127.0.0.1:2525` while it runs, invites the editor, reads the invite link from the captured mail and accepts it through Ghost's API. Outside the bootstrap nothing listens, so the demo sends no e-mail.
3. **Integration** "Supertext Translation" with the four webhooks pointing at the site's own URL, and a random webhook secret; key and secret go to `content/data/supertext.json` for the connector. If the domain changes, the webhooks are re-pointed on the next start.
4. **Languages:** `routes.yaml` with a collection per `TARGET_LANGUAGES` entry (only if routes are still Ghost's default or the demo's own), and navigation links in each language's own name. The connector creates the tags.
5. **Sample post** "Translate your Ghost posts with Supertext" (`demo/sample-post.html`), published.

Rules: existing accounts are never changed (no password resets, no duplicates). A password that fails Ghost's rules skips that account with a warning naming the variable; the site still starts. If the admin password was changed in Ghost, the bootstrap can't sign in and skips steps 2–5 with a warning. Passwords are never logged.

The entrypoint sets `STATE_FILE=content/data/supertext-state.json` (Commando Center state, in the volume). Its target languages `de-CH,fr-CH` and source `en` are exact Supertext codes, so the demo needs no `SUPERTEXT_LANGUAGE_MAP`.

Other demo settings (baked into the image): `security__staffDeviceVerification=false` (Ghost would e-mail a code on every new login), `SUPERTEXT_POLITENESS=more` (formal *Sie*/*vous*), `TARGET_LANGUAGES=de-CH,fr-CH`.

Variables (see `demo/.env.example`):

| Variable | Purpose |
| --- | --- |
| `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD` | Administrator (Owner) account |
| `DEMO_EDITOR_EMAIL`, `DEMO_EDITOR_PASSWORD` | Editor account for tests and screenshots |
| `SUPERTEXT_API_KEY` | Supertext key; without it translations fail with a clear message |
| `DEMO_SITE_TITLE`, `DEMO_ADMIN_NAME`, `DEMO_EDITOR_NAME` | Optional names |
| `TARGET_LANGUAGES`, `SOURCE_LANGUAGE`, `SUPERTEXT_POLITENESS`, `SUPERTEXT_LANGUAGE_MAP` | Override the baked-in languages |
| `SUPERTEXT_VERSION_REPORTS` | `0` turns the version reports off (default on) |
| `url` | Public URL if not on Railway |

Secrets live only in Railway variables, never in the repository.

### Railway deployment

Service `ghost` in the `supertext-cms-demos` project (Amsterdam region), source this repository, Dockerfile path `demo/Dockerfile`, volume at `/var/lib/ghost/content`, health check `/supertext/health` (503 until Ghost answers). Builds on push to `main`.

### Running the demo locally

```bash
docker build -f demo/Dockerfile -t ghost-supertext-demo .
docker run -p 80:80 -e PORT=80 -e url=http://www.example.com --add-host www.example.com:127.0.0.1 \
  -e DEMO_ADMIN_EMAIL=… -e DEMO_ADMIN_PASSWORD=… -e DEMO_EDITOR_EMAIL=… -e DEMO_EDITOR_PASSWORD=… \
  -e SUPERTEXT_API_KEY=standin -e SUPERTEXT_API_URL=http://host.docker.internal:8765/v1/ --add-host host.docker.internal:host-gateway \
  -e SUPERTEXT_REPORT_URL=http://host.docker.internal:8765/report \
  ghost-supertext-demo
```

Ghost needs a host name with a domain for its own webhooks, hence `www.example.com` mapped to the container itself; point your browser there too (hosts file, or Chromium's `--host-resolver-rules`).

## Docs screenshots

`npm run docs:screenshots` regenerates `docs/images/` from a **fresh** demo container (as above) whose connector uses the stand-in API:

```bash
cd test/docs && npm ci && cd ../..
node test/docs/stand-in.mjs &          # fake Supertext on :8765, real German for the sample post (sample-de.json)
# start a fresh demo container as above, wait for "[demo] Bootstrap done"
npm run docs:screenshots               # BASE_URL, RESOLVE_TO, DEMO_* variables optional
```

The script signs in as the editor, adds `#translate-de-ch`, captures the tag picker, posts list, status page, German draft, edits the draft and requests again (the *Not overwritten* warning), then signs in as admin for the integration (keys are masked), internal tags and status page settings. On the status page it shows the live API endpoint instead of the stand-in's address. The stand-in also answers `POST /report` (202); start the container with `SUPERTEXT_REPORT_URL` pointing at it (as above), so screenshot runs never report to the live center. Change the sample post → update `sample-de.json` (keys are the segments' inline HTML).

## Dependency updates

Dependabot (`.github/dependabot.yml`) opens weekly pull requests: minor and patch updates grouped into one, GitHub Actions in another, each major update on its own. Merge one when CI is green and it doesn't change what the plugin supports.

Some major versions are ignored on purpose: TypeScript (7.x is the native compiler, which the type-checking and build tools here don't support yet) and `@types/node` (the types must match the oldest Node version the plugin supports, not the newest). Lift an ignore rule when the plugin moves to the new version.

## Code quality and security checks

- **Checks** workflow (`.github/workflows/checks.yml`): [actionlint](https://github.com/rhysd/actionlint) and [zizmor](https://docs.zizmor.sh/) lint the workflows on every push and pull request. Dependency review fails a pull request that adds a package with a known vulnerability (moderate or worse). Third-party actions are pinned to commit SHAs; Dependabot keeps the pins up to date. To run the workflow lint locally: `pip install actionlint-py zizmor`, then `actionlint` and `zizmor .github/workflows` in the repo root.
- **Links** workflow (`.github/workflows/links.yml`): [lychee](https://lychee.cli.rs/) checks the links in all Markdown files weekly and whenever docs change on `main`. Broken links open (or update) the issue "Broken links in the docs". Links that can't work from CI (local URLs, placeholders, pages behind a login) are excluded in `.lycheeignore`.
- JavaScript and TypeScript are analysed by CodeQL (see below), so this repo runs no separate static analyser.
- GitHub settings (set by Remy's setup script, not stored in the repo): **secret scanning with push protection** (a push containing a known token format is rejected; findings under *Security → Secret scanning*) and **CodeQL default setup** (findings under *Security → Code scanning* and as comments on pull requests; PHP isn't covered by CodeQL, which is why the PHP plugins run PHPStan).

Before starting work in this repo, look at its open findings: code scanning alerts, secret scanning alerts, Dependabot PRs and the "Broken links in the docs" issue.

## Releasing

Releases are published by `.github/workflows/release.yml` when the version is officially bumped; nobody tags or creates releases by hand.

1. Move the *Unreleased* entries in `CHANGELOG.md` under a new `## [X.Y.Z] - YYYY-MM-DD` section, and keep an empty *Unreleased* above it.
2. Set the same version in:
   - `package.json`: the connector's version (read at runtime by `src/version.ts`; the status page and startup log show it, so there is no second copy to update)
3. Push to `main`. The workflow checks that the version files match `CHANGELOG.md`, then tags `vX.Y.Z` and creates the GitHub release with the CHANGELOG section as notes (0.x versions as pre-releases). A push that adds no new version does nothing, and a version that is already released is skipped. After fixing a failed run, start it again with *Run workflow* on the *Release* workflow.
## UI languages

The status page, the job messages, Supertext and Ghost error messages and the tag descriptions come from `src/i18n/`: `en.ts` is the source, `de.ts`, `fr.ts` and `it.ts` are typed as `Messages`, so a missing or extra key fails `npm run typecheck`. New or changed strings need all four languages in the same commit (formal address; "Supertext", tag names, placeholders and URLs unchanged). `{name}` is a placeholder; `{language}` takes a language code and is shown as the language's name in the reader's language (`Intl.DisplayNames`). A parameter can itself be a message (`error.detail` wraps the error and the API's untranslated detail).

Results don't store translated text: `TranslateResult.localized` / `Job.localized` hold keys and parameters (JSON-safe, kept in `JOBS_FILE`), and the status page formats them in the reader's language. `message` stays English for the log and for job files from older versions. `SupertextError` and `GhostError` carry `localized` the same way. `pickLocale(UI_LANGUAGE, Accept-Language)` chooses the page language.

## Known limitations / roadmap

- No status page in setup B (standalone); results only in the log.
- No *Test connection* button: the key is checked at startup, when it changes and after a rejected translation.
- Without `STATE_FILE` the reporter's state is in memory, so every restart reports `installed` again and re-checks the key.
- Request tags stay on the source; re-requesting means removing and re-adding the tag.
- Ghost's site language is global: themes don't get a per-post `lang` or `hreflang` links. A theme helper or code-injection snippet for hreflang is a possible next step.
- Slugs of translations come from the translated title on creation and are not changed later.
- Markdown and HTML cards are not translated; neither are tags.
- Posts in Ghost's legacy (Mobiledoc) format must be opened and saved once first.
- The demo uses SQLite; production setups should use MySQL with the official image and the connector side by side.
