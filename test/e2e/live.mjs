#!/usr/bin/env node
/**
 * End-to-end test against the REAL Supertext API: a fresh demo (nothing translated yet)
 * whose connector has a real SUPERTEXT_API_KEY. The editor adds the request tags of every
 * demo language to the sample post in Ghost Admin (post settings → Tags), exactly as the
 * user guide describes. Then the status page and Ghost's Admin API (as the signed-in editor)
 * are checked: every language has one draft translation, its title, excerpt and body are
 * filled and really in the target language (de-CH without "ß"), formatting, links, code and
 * cards survived, no protocol leftovers, the source post was not touched, and requesting
 * again updates the same drafts in place instead of duplicating them.
 * See "End-to-end tests" in docs/DEVELOPER.md.
 *
 *   BASE_URL=http://www.example.com:8081 RESOLVE_TO=127.0.0.1 \
 *   EDITOR_EMAIL=… EDITOR_PASSWORD=… node test/e2e/live.mjs
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const B = (process.env.BASE_URL ?? 'http://www.example.com:8081').replace(/\/+$/, '')
const RESOLVE_TO = process.env.RESOLVE_TO || '127.0.0.1'
const need = (name) => process.env[name] || (() => { throw new Error(`Set ${name}`) })()
const SAMPLE_SLUG = 'translate-your-ghost-posts-with-supertext'
const TIMEOUT = 15 * 60_000
const artifacts = fileURLToPath(new URL('./artifacts/', import.meta.url))
mkdirSync(artifacts, { recursive: true })

const failures = []
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  return ok
}
const note = (text) => console.log(`note ${text}`)

// Common words, to tell the target languages apart. Lower case, whole words.
const STOPWORDS = {
  en: ['the', 'and', 'is', 'are', 'with', 'for', 'you', 'your', 'our', 'of', 'to', 'we', 'who', 'what'],
  de: ['der', 'die', 'das', 'und', 'ist', 'sind', 'mit', 'für', 'sie', 'ihre', 'ihr', 'unser', 'unsere', 'wir', 'eine', 'ein', 'den', 'zu', 'von', 'was'],
  fr: ['le', 'les', 'et', 'est', 'sont', 'avec', 'pour', 'vous', 'votre', 'vos', 'notre', 'nos', 'nous', 'des', 'une', 'un', 'du', 'de', 'qui', 'que'],
  it: ['il', 'lo', 'gli', 'e', 'è', 'sono', 'con', 'per', 'lei', 'sua', 'suo', 'nostro', 'nostra', 'noi', 'una', 'un', 'del', 'della', 'di', 'che', 'chi'],
}
const words = (text) => text.toLowerCase().match(/[\p{L}]+/gu) ?? []
const score = (text, lang) => words(text).filter((w) => STOPWORDS[lang].includes(w)).length
const count = (haystack, needle) => String(haystack ?? '').split(needle).length - 1
const LEFTOVERS = ['data-st-id', 'data-st-ph', 'st-ph-', 'data-n=']
const KEPT = [['links', '<a '], ['bold', '<strong'], ['italics', '<em'], ['code', '<code'], ['list items', '<li'], ['headings', '<h2'], ['callout cards', 'kg-callout-card'], ['button cards', 'kg-btn']]

const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${new URL(B).hostname} ${RESOLVE_TO}`] })
const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1400, height: 900 } })
page.setDefaultTimeout(60_000)

/** Admin API call from inside the page, with the editor's session. */
async function adminApi(path) {
  const res = await page.evaluate(async (url) => {
    const r = await fetch(url, { headers: { 'Accept-Version': 'v6.0' } })
    return { status: r.status, body: await r.text() }
  }, `${B}/ghost/api/admin/${path}`)
  if (res.status !== 200) throw new Error(`Admin API ${path}: HTTP ${res.status} ${res.body.slice(0, 300)}`)
  return JSON.parse(res.body)
}
const postsWhere = async (filter) =>
  (await adminApi(`posts/?filter=${encodeURIComponent(filter)}&formats=html,lexical&include=tags&limit=all`)).posts ?? []

/** Text blocks of a post's HTML (innermost paragraphs, headings, list items, card texts). */
const blocks = (html) =>
  page.evaluate((h) => {
    const sel = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,.kg-callout-text,.kg-btn,.kg-toggle-heading-text,.kg-toggle-content'
    const doc = new DOMParser().parseFromString(h, 'text/html')
    return [...doc.body.querySelectorAll(sel)]
      .filter((el) => !el.querySelector(sel))
      .map((el) => el.textContent.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  }, html)
const codes = (html) => [...String(html).matchAll(/<code[^>]*>(.*?)<\/code>/gs)].map((m) => m[1]).sort()
const hrefs = (html) => [...String(html).matchAll(/href="([^"]*)"/g)].map((m) => m[1]).sort()

/** The status page: target languages (label, Supertext code, request tag) and recent jobs. */
async function statusPage() {
  await page.goto(`${B}/ghost/supertext/`)
  await page.waitForSelector('#jobs')
  return page.evaluate(() => ({
    bad: [...document.querySelectorAll('#languages .bad, #settings .bad')].map((el) => el.closest('dd, tr')?.textContent.replace(/\s+/g, ' ').trim()),
    jobs: [...document.querySelectorAll('#jobs tbody tr')].map((tr) => ({
      label: tr.children[2]?.textContent.replace(/\s+/g, ' ').trim(),
      message: tr.children[4]?.textContent.replace(/\s+/g, ' ').trim(),
      status: [...(tr.querySelector('.badge')?.classList ?? [])].find((c) => c !== 'badge'),
    })),
    languages: [...document.querySelectorAll('#languages tbody tr')]
      .map((tr) => ({
        code: tr.children[0]?.querySelector('.muted')?.textContent.trim(),
        label: tr.children[0]?.childNodes[0]?.textContent.trim(),
        tags: [...tr.querySelectorAll('code.tag')].map((c) => c.textContent.trim()),
      }))
      .filter((l) => l.tags.length),
  }))
}

/** Adds (or removes) a request tag in the post settings; Ghost saves tag changes right away. */
async function setTag(tag, add) {
  if (!(await page.locator('#tag-input').isVisible())) await page.click('[data-test-psm-trigger]')
  if (add) {
    await page.click('#tag-input input')
    await page.keyboard.type(tag)
    await page.locator('.ember-power-select-option').filter({ hasText: new RegExp(`^\\s*${tag.replace(/[-#]/g, '\\$&')}\\s*$`) }).first().click()
  } else {
    await page.locator('#tag-input li', { hasText: tag }).locator('.ember-power-select-multiple-remove-btn').click()
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(2500)
}

/** Waits until the status page shows `n` new finished jobs (newest first). */
async function waitForJobs(before, n, label) {
  const end = Date.now() + TIMEOUT
  const started = Date.now()
  for (;;) {
    const s = await statusPage()
    const fresh = s.jobs.slice(0, s.jobs.length - before)
    if (fresh.length >= n && fresh.every((j) => j.status !== 'running')) {
      console.log(`${label}: ${Math.round((Date.now() - started) / 1000)} s`)
      await page.screenshot({ fullPage: true, path: `${artifacts}${label}-status.png` })
      return fresh
    }
    if (Date.now() > end) {
      await page.screenshot({ fullPage: true, path: `${artifacts}${label}-status.png` })
      throw new Error(`${label}: ${fresh.length}/${n} jobs finished after ${TIMEOUT / 60000} min`)
    }
    await page.waitForTimeout(5000)
  }
}

async function openSource(id) {
  await page.goto(`${B}/ghost/#/editor/post/${id}`)
  await page.waitForSelector('[data-test-psm-trigger]')
}

async function noGhostErrors(label) {
  const errors = await page.getByText(/Saving failed|Someone else is editing|Validation failed/i).allTextContents()
  check(`${label}: no error in Ghost Admin`, errors.length === 0, errors.join(' | '))
}

// --- Log in as the editor ----------------------------------------------------------------
await page.goto(`${B}/ghost/`)
await page.waitForSelector('input[type=email]', { timeout: 120_000 })
await page.fill('input[type=email]', need('EDITOR_EMAIL'))
await page.fill('input[type=password]', need('EDITOR_PASSWORD'))
await page.keyboard.press('Enter')
try {
  await page.waitForURL(/#\/(site|dashboard|posts|analytics)/, { timeout: 60_000 })
  check('editor can log in (DEMO_EDITOR_*)', true)
} catch {
  check('editor can log in (DEMO_EDITOR_*)', false, page.url())
  await page.screenshot({ path: `${artifacts}login.png` })
  throw new Error(failures.join('\n'))
}

// --- Setup -------------------------------------------------------------------------------
const initial = await statusPage()
const targets = initial.languages
console.log(`Target languages: ${targets.map((t) => `${t.label} (${t.code})`).join(', ')}`)
check('demo has target languages', targets.length > 0)
check('status page shows no problems (languages, key, Ghost, webhooks)', initial.bad.length === 0, initial.bad.join(' | '))
for (const t of targets) check(`${t.code}: request tags shown`, t.tags.length === 3 && t.tags[0].startsWith('#translate-'), t.tags.join(' '))
const [source] = await postsWhere(`slug:${SAMPLE_SLUG}`)
if (!check('sample post exists', Boolean(source))) throw new Error(failures.join('\n'))
check('fresh demo (nothing translated yet)', (await postsWhere(`tag:[${targets.map((t) => t.tags[2].replace('#', 'hash-')).join(',')}]`)).length === 0)
const sourceBlocks = await blocks(source.html)
console.log(`Sample post: ${sourceBlocks.length} text blocks, status ${source.status}`)

// --- First request -----------------------------------------------------------------------
await openSource(source.id)
for (const t of targets) await setTag(t.tags[0], true)
await noGhostErrors('first-run')
const firstJobs = await waitForJobs(initial.jobs.length, targets.length, 'first-run')

const first = {}
for (const t of targets) {
  const tag = `${t.label} (${t.code})`
  const lang = t.code.split('-')[0].toLowerCase()
  const job = firstJobs.find((j) => j.label === t.label)
  check(`${tag}: status page reports "Created"`, job?.status === 'created', job ? `${job.status}: ${job.message}` : 'no job')

  const found = await postsWhere(`tag:${t.tags[2].replace('#', 'hash-')}`)
  check(`${tag}: one translation`, found.length === 1, `${found.length}`)
  const post = found[0]
  if (!post) continue
  first[t.code] = post
  check(`${tag}: translation is a draft (not published)`, post.status === 'draft', post.status)
  check(`${tag}: marker points to the source`, String(post.codeinjection_head ?? '').toLowerCase().includes(`supertext:source=${source.id};lang=${t.code};`.toLowerCase()))

  // Field by field: filled, changed. A single word can stay the same in the target language,
  // so unchanged fields only count against the ratio below.
  let fields = 0
  let changed = 0
  let text = ''
  for (const f of ['title', 'custom_excerpt']) {
    if (!String(source[f] ?? '').trim()) continue
    fields++
    if (!check(`${tag}: ${f} filled`, String(post[f] ?? '').trim() !== '')) continue
    if (post[f] !== source[f]) changed++
    else note(`${tag}: ${f} unchanged`)
    text += ` ${post[f]}`
  }
  const target = await blocks(post.html)
  check(`${tag}: every text block translated`, target.length === sourceBlocks.length, `${target.length}/${sourceBlocks.length}`)
  sourceBlocks.forEach((s, i) => {
    fields++
    const v = target[i] ?? ''
    if (!v) return check(`${tag}: block ${i + 1} filled`, false, s.slice(0, 60))
    if (v !== s) changed++
    else note(`${tag}: block ${i + 1} unchanged: ${s.slice(0, 60)}`)
    text += ` ${v}`
  })
  check(`${tag}: texts were changed by the translation`, fields > 0 && changed / fields >= 0.8, `${changed}/${fields} fields`)

  const all = `${post.title}\n${post.custom_excerpt}\n${post.html}\n${post.lexical}`
  const left = LEFTOVERS.filter((l) => all.includes(l))
  check(`${tag}: no protocol leftovers`, left.length === 0, left.join(', '))
  for (const [what, needle] of KEPT) {
    if (count(source.html, needle)) check(`${tag}: keeps its ${what}`, count(post.html, needle) === count(source.html, needle), `${count(post.html, needle)}/${count(source.html, needle)}`)
  }
  check(`${tag}: link targets kept`, hrefs(post.html).join(' ') === hrefs(source.html).join(' '), hrefs(post.html).join(' '))
  check(`${tag}: code kept as is`, codes(post.html).join(' ') === codes(source.html).join(' '), codes(post.html).join(' '))

  if (STOPWORDS[lang]) {
    const scores = Object.fromEntries(Object.keys(STOPWORDS).map((l) => [l, score(text, l)]))
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0]
    check(`${tag}: text is in the target language`, best === lang, JSON.stringify(scores))
  }
  if (/^de-ch$/i.test(t.code)) check(`${tag}: Swiss German spelling (no "ß")`, !text.includes('ß'))
}

// --- Requesting again updates the drafts in place ----------------------------------------
const afterFirst = await statusPage()
await openSource(source.id)
for (const t of targets) await setTag(t.tags[0], false)
for (const t of targets) await setTag(t.tags[0], true)
await noGhostErrors('second-run')
const secondJobs = await waitForJobs(afterFirst.jobs.length, targets.length, 'second-run')
for (const t of targets) {
  const tag = `${t.label} (${t.code})`
  const job = secondJobs.find((j) => j.label === t.label)
  check(`${tag}: requesting again reports "Updated"`, job?.status === 'updated', job ? `${job.status}: ${job.message}` : 'no job')
  const found = await postsWhere(`tag:${t.tags[2].replace('#', 'hash-')}`)
  check(`${tag}: requesting again updates the draft in place (no duplicates)`, found.length === 1 && found[0].id === first[t.code]?.id, found.map((p) => p.id).join(', '))
  if (found[0]) check(`${tag}: still a draft`, found[0].status === 'draft', found[0].status)
}

// --- The source post was never written by the connector ----------------------------------
const [sourceAfter] = await postsWhere(`id:${source.id}`)
check('source post content unchanged', sourceAfter?.lexical === source.lexical && sourceAfter?.title === source.title)
check('source post still published', sourceAfter?.status === source.status, sourceAfter?.status)
const end = await statusPage()
check('status page shows no failed requests', !end.jobs.some((j) => j.status === 'failed'), end.jobs.filter((j) => j.status === 'failed').map((j) => j.message).join(' | '))

await browser.close()

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}
console.log('\nAll end-to-end checks passed.')
