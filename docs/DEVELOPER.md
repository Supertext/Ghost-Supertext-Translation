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
  server.ts          HTTP: /supertext/webhook, /supertext/health, /ghost/supertext/ (status page), proxy to Ghost
  translate.ts       one source × one language: find existing translation, overwrite rules, translate, save
  collect.ts         which fields, Lexical blocks and card properties are translated
  lexical.ts         Lexical inline nodes <-> inline HTML with data-n markers
  segments.ts        segment model, HTML document for Supertext, parsing the answer
  languages.ts       target languages, tag names, mapping added tags to requests
  jobs.ts            recent requests for the status page (memory, optional JSON file)
  status-page.ts     status page HTML
  ghost/admin.ts     Admin API client (JWT from the integration key)
  ghost/webhook.ts   signature check and payload parsing
  supertext/client.ts Supertext AI file API v1 (shared with the other CMS plugins)
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

AI file translation API v1, same as the WordPress, TYPO3, Strapi and Payload plugins (`src/supertext/client.ts` is shared):

1. `POST translate/ai/file` multipart: `file` (`text/html`, exactly that content type), `target_lang` (`de-CH`), `source_lang` (primary subtag, `en`), `politeness` (`less`/`more`, omitted for default) → `{ file_id }`
2. `GET translate/ai/file/{id}/status` every 2 s until `done` (`error`, `limit_exceeded`, `deleted` fail), 3 min timeout
3. `GET translate/ai/file/{id}/translation` → translated HTML
4. `DELETE translate/ai/file/{id}` (best effort; files expire after 24 h)

Header `Authorization: Supertext-Auth-Key <key>` (a pasted prefix is stripped). HTTP 429 is retried 4 times (`Retry-After`, else 1/2/4/8 s with jitter).

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
- `test/translate.test.ts`: the translator and the webhook server against `fakeGhost.ts` (mirrors Ghost's tag slugs, `~` filter and update-collision check) and `fakeSupertext.ts`: create, update in place, kept when edited/published, forced overwrite, one translation per language, skip translations, errors.
- `test/client.test.ts`: Supertext client (shared).

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

Other demo settings (baked into the image): `security__staffDeviceVerification=false` (Ghost would e-mail a code on every new login), `SUPERTEXT_POLITENESS=more` (formal *Sie*/*vous*), `TARGET_LANGUAGES=de-CH,fr-CH`.

Variables (see `demo/.env.example`):

| Variable | Purpose |
| --- | --- |
| `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD` | Administrator (Owner) account |
| `DEMO_EDITOR_EMAIL`, `DEMO_EDITOR_PASSWORD` | Editor account for tests and screenshots |
| `SUPERTEXT_API_KEY` | Supertext key; without it translations fail with a clear message |
| `DEMO_SITE_TITLE`, `DEMO_ADMIN_NAME`, `DEMO_EDITOR_NAME` | Optional names |
| `TARGET_LANGUAGES`, `SOURCE_LANGUAGE`, `SUPERTEXT_POLITENESS` | Override the baked-in languages |
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

The script signs in as the editor, adds `#translate-de-ch`, captures the tag picker, posts list, status page, German draft, edits the draft and requests again (the *Not overwritten* warning), then signs in as admin for the integration (keys are masked), internal tags and status page settings. On the status page it shows the live API endpoint instead of the stand-in's address. Change the sample post → update `sample-de.json` (keys are the segments' inline HTML).

## Releasing

Releases are published by `.github/workflows/release.yml` when the version is officially bumped; nobody tags or creates releases by hand.

1. Move the *Unreleased* entries in `CHANGELOG.md` under a new `## [X.Y.Z] - YYYY-MM-DD` section, and keep an empty *Unreleased* above it.
2. Set the same version in:
   - `package.json`: the connector's version
3. Push to `main`. The workflow checks that the version files match `CHANGELOG.md`, then tags `vX.Y.Z` and creates the GitHub release with the CHANGELOG section as notes (0.x versions as pre-releases). A push that adds no new version does nothing, and a version that is already released is skipped. After fixing a failed run, start it again with *Run workflow* on the *Release* workflow.
## Known limitations / roadmap

- No status page in setup B (standalone); results only in the log.
- Request tags stay on the source; re-requesting means removing and re-adding the tag.
- Ghost's site language is global: themes don't get a per-post `lang` or `hreflang` links. A theme helper or code-injection snippet for hreflang is a possible next step.
- Slugs of translations come from the translated title on creation and are not changed later.
- Markdown and HTML cards are not translated; neither are tags.
- Posts in Ghost's legacy (Mobiledoc) format must be opened and saved once first.
- The demo uses SQLite; production setups should use MySQL with the official image and the connector side by side.
