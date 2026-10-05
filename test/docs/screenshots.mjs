#!/usr/bin/env node
/**
 * Regenerates docs/images from a fresh local demo container whose connector talks to
 * stand-in.mjs. See docs/DEVELOPER.md → Docs screenshots.
 *
 *   BASE_URL            default http://www.example.com (the demo's `url`)
 *   RESOLVE_TO          default 127.0.0.1: where the browser sends BASE_URL's host
 *   DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD, DEMO_EDITOR_EMAIL / DEMO_EDITOR_PASSWORD
 *
 * The status page shows the Supertext endpoint the connector uses; in the screenshots it
 * is shown as the live endpoint instead of the stand-in's local address.
 */
import { chromium } from 'playwright'

const B = (process.env.BASE_URL || 'http://www.example.com').replace(/\/+$/, '')
const RESOLVE_TO = process.env.RESOLVE_TO || '127.0.0.1'
const ADMIN = [process.env.DEMO_ADMIN_EMAIL || 'admin@demo.example.com', process.env.DEMO_ADMIN_PASSWORD || 'Demo-Admin-2026!x']
const EDITOR = [process.env.DEMO_EDITOR_EMAIL || 'editor@demo.example.com', process.env.DEMO_EDITOR_PASSWORD || 'Demo-Editor-2026!x']
const LIVE_API = 'https://api.supertext.com/v1/'
const OUT = new URL('../../docs/images', import.meta.url).pathname
const SOURCE_TITLE = 'Translate your Ghost posts with Supertext'
const GERMAN_TITLE = 'Übersetzen Sie Ihre Ghost-Beiträge mit Supertext'

const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP ${new URL(B).hostname} ${RESOLVE_TO}`] })

async function session([email, password]) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  const page = await context.newPage()
  await page.goto(`${B}/ghost/`)
  await page.waitForSelector('input[type=email]', { timeout: 120000 })
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', password)
  await page.keyboard.press('Enter')
  await page.waitForURL(/#\/(site|dashboard|posts|analytics)/, { timeout: 60000 })
  return page
}

const quiet = (page) =>
  page.addStyleTag({ content: '*{animation-duration:0s!important;transition-duration:0s!important;caret-color:transparent!important}' })
const pad = (r, p = 12) => ({ height: r.height + 2 * p, width: r.width + 2 * p, x: Math.max(0, r.x - p), y: Math.max(0, r.y - p) })
const shot = (page, name, clip) => page.screenshot({ clip, fullPage: Boolean(clip), path: `${OUT}/${name}.png` })
const box = async (locator) => (await locator.boundingBox()) ?? (await locator.evaluate((el) => el.getBoundingClientRect().toJSON()))

/** Admin API call from inside the page, so it uses the browser's session and host mapping. */
const adminApi = (page, path) =>
  page.evaluate(async (url) => (await fetch(url, { headers: { 'Accept-Version': 'v6.0' } })).json(), `${B}/ghost/api/admin/${path}`)

/** Polls the Admin API (as the signed-in user) until `filter` matches a post. */
async function waitForPost(page, filter, timeout = 60000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const posts = (await adminApi(page, `posts/?filter=${encodeURIComponent(filter)}&include=tags`)).posts ?? []
    if (posts.length) return posts[0]
    await page.waitForTimeout(1000)
  }
  throw new Error(`No post matched ${filter}`)
}

async function statusPage(page) {
  await page.goto(`${B}/ghost/supertext/`)
  await page.waitForSelector('#jobs')
  await page.evaluate((live) => {
    for (const dd of document.querySelectorAll('#settings dd')) {
      if (dd.previousElementSibling?.textContent === 'Supertext API') dd.textContent = live
    }
  }, LIVE_API)
}

async function openPost(page, title) {
  await page.goto(`${B}/ghost/#/posts`)
  await page.getByText(title, { exact: true }).first().click()
  await page.waitForSelector('[data-test-psm-trigger]')
  await quiet(page)
}

async function setRequestTag(page, tag, add) {
  if (!(await page.locator('#tag-input').isVisible())) await page.click('[data-test-psm-trigger]')
  if (add) {
    await page.click('#tag-input input')
    await page.keyboard.type(tag)
    await page.locator('.ember-power-select-option', { hasText: tag }).first().click()
  } else {
    await page.locator('#tag-input li', { hasText: tag }).locator('.ember-power-select-multiple-remove-btn').click()
  }
  await page.keyboard.press('Escape')
  // Ghost saves tag changes in the post settings right away.
  await page.waitForTimeout(2500)
}

// --- User guide (editor account) ---------------------------------------------------------
const editor = await session(EDITOR)
await openPost(editor, SOURCE_TITLE)
await editor.click('[data-test-psm-trigger]')
await editor.click('#tag-input input')
await editor.keyboard.type('#translate')
await editor.waitForSelector('.ember-power-select-option')
await editor.waitForTimeout(500)
const tagField = editor.locator('#tag-input').locator('xpath=ancestor::div[contains(@class,"form-group")]')
const dropdown = editor.locator('.ember-power-select-dropdown')
{
  const a = await box(tagField)
  const b = await box(dropdown)
  await shot(editor, 'tag-picker', pad({ height: b.y + b.height - a.y, width: Math.max(a.width, b.width), x: a.x, y: a.y }))
}
await editor.locator('.ember-power-select-option', { hasText: '#translate-de-ch' }).first().click()
await editor.keyboard.press('Escape')
await editor.waitForTimeout(400)
await shot(editor, 'tag-added', pad(await box(tagField)))

const german = await waitForPost(editor, 'tag:hash-lang-de-ch')
await editor.goto(`${B}/ghost/#/posts`)
await editor.getByText(GERMAN_TITLE).first().waitFor()
await quiet(editor)
await editor.waitForTimeout(800)
await shot(editor, 'posts-list', { height: 300, width: 1060, x: 330, y: 0 })

await statusPage(editor)
await shot(editor, 'status-created', pad(await box(editor.locator('#jobs')), 0))

await editor.goto(`${B}/ghost/#/editor/post/${german.id}`)
await editor.getByText('So funktioniert es').first().waitFor()
await quiet(editor)
await editor.waitForTimeout(1000)
await shot(editor, 'translated-de', { height: 700, width: 820, x: 290, y: 120 })

// An editor polishes the German draft, then someone requests the translation again.
await editor.getByText('So funktioniert es').first().click()
await editor.keyboard.press('End')
await editor.keyboard.type(' in drei Schritten')
await editor.waitForTimeout(4000) // drafts autosave
await openPost(editor, SOURCE_TITLE)
await setRequestTag(editor, '#translate-de-ch', false)
await setRequestTag(editor, '#translate-de-ch', true)
await editor.waitForTimeout(4000)
await statusPage(editor)
await shot(editor, 'status-kept', pad(await box(editor.locator('#jobs')), 0))

// --- Installation guide (admin account) -------------------------------------------------
const admin = await session(ADMIN)
const integration = (await adminApi(admin, 'integrations/?include=webhooks')).integrations.find((i) => i.name === 'Supertext Translation')
await admin.goto(`${B}/ghost/#/settings/integrations/${integration.id}`)
const modal = admin.locator('[role=dialog], .modal-content, section[data-testid=custom-integration-modal]').first()
await admin.getByText('Admin API key').first().waitFor()
await quiet(admin)
// Never show keys in the docs.
await admin.evaluate(() => {
  for (const el of document.querySelectorAll('input, [class*=key], code')) {
    const v = 'value' in el ? el.value : el.textContent
    if (/^[0-9a-f]{24}(:[0-9a-f]+)?$|^[0-9a-f]{26}$/.test((v ?? '').trim())) {
      if ('value' in el) el.value = '•'.repeat(26)
      else el.textContent = '•'.repeat(26)
    }
  }
  for (const el of document.querySelectorAll('*')) {
    if (el.children.length === 0 && /^[0-9a-f]{24}:[0-9a-f]{20,}|^[0-9a-f]{26}$/.test(el.textContent.trim())) el.textContent = '•'.repeat(26)
  }
})
await admin.waitForTimeout(800)
await shot(admin, 'integration', pad(await box(modal), 0))

await admin.goto(`${B}/ghost/#/tags?type=internal`)
await admin.getByText('#translate-de-ch').first().waitFor()
await quiet(admin)
await admin.waitForTimeout(500)
await shot(admin, 'tags', { height: 720, width: 1060, x: 330, y: 0 })

await statusPage(admin)
const languages = await box(admin.locator('#languages'))
const settings = await box(admin.locator('#settings'))
await shot(admin, 'status-settings', { height: settings.y + settings.height - languages.y, width: languages.width, x: languages.x, y: languages.y })

await browser.close()
console.log(`Screenshots written to ${OUT}`)
