#!/usr/bin/env node
/**
 * Demo bootstrap, run on every start after Ghost is up (see demo/entrypoint.sh).
 * Idempotent: creates what is missing, never changes existing accounts.
 *
 *  1. Admin account from DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD (replaces Ghost's
 *     first-run "create your account" screen). Fallback names: GHOST_ADMIN_EMAIL / _PASSWORD.
 *  2. Editor account from DEMO_EDITOR_EMAIL / DEMO_EDITOR_PASSWORD (Ghost role "Editor").
 *     Ghost only creates staff through e-mailed invites, so the invite mail goes to a
 *     throw-away SMTP listener on 127.0.0.1:2525 here and is accepted through Ghost's API.
 *  3. The "Supertext Translation" custom integration with its webhooks; writes the Admin
 *     API key and webhook secret to GHOST_SETTINGS_FILE for the connector.
 *  4. Language setup: routes.yaml with a collection per target language, navigation links.
 *  5. A published sample post in the source language.
 *
 * Passwords are never logged; only variable names are.
 */
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import net from 'node:net'

const env = (name, fallback = '') => (process.env[name] ?? '').trim() || fallback
const SITE = env('url').replace(/\/+$/, '')
const GHOST = env('GHOST_UPSTREAM', 'http://127.0.0.1:2368')
const SETTINGS_FILE = env('GHOST_SETTINGS_FILE', '/var/lib/ghost/content/data/supertext.json')
const TARGETS = env('TARGET_LANGUAGES', 'de-CH,fr-CH').split(/[\s,;]+/).filter(Boolean)
const INTEGRATION = 'Supertext Translation'
const SAMPLE_SLUG = 'translate-your-ghost-posts-with-supertext'
const ROUTES_MARKER = '# Managed by the Supertext demo'

const log = (msg) => console.log(`[demo] ${msg}`)
const warn = (msg) => console.warn(`[demo] WARNING: ${msg}`)
const site = new URL(SITE)

let cookie = ''
async function api(method, path, body, { form, raw } = {}) {
  const headers = {
    'Accept-Version': 'v6.0',
    Origin: SITE,
    'X-Forwarded-Host': site.host,
    'X-Forwarded-Proto': site.protocol.replace(':', ''),
  }
  if (cookie) headers.Cookie = cookie
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${GHOST}/ghost/api/admin/${path}`, {
    body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    headers,
    method,
    redirect: 'manual',
  })
  const setCookie = res.headers.getSetCookie?.() ?? []
  if (setCookie.length) cookie = setCookie.map((c) => c.split(';')[0]).join('; ')
  const text = await res.text()
  if (raw) return { ok: res.ok, status: res.status, text }
  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { text }
  }
  if (!res.ok) {
    const e = data.errors?.[0] ?? {}
    const err = new Error(`${method} ${path}: HTTP ${res.status} ${e.message ?? ''} ${e.context ?? ''}`.trim())
    err.status = res.status
    err.type = e.type
    err.ghostMessage = [e.message, e.context].filter(Boolean).join(' ')
    throw err
  }
  return data
}

async function waitForGhost() {
  for (let i = 0; i < 180; i++) {
    try {
      const res = await fetch(`${GHOST}/ghost/api/admin/authentication/setup/`, {
        headers: { 'X-Forwarded-Host': site.host, 'X-Forwarded-Proto': site.protocol.replace(':', '') },
      })
      if (res.ok) return (await res.json()).setup[0].status
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error('Ghost did not start within 6 minutes')
}

/** Minimal SMTP listener that accepts every mail and hands the bodies to `onMail`. */
function mailSink(onMail) {
  const server = net.createServer((socket) => {
    let data = false
    let buf = ''
    let mail = ''
    const say = (line) => socket.write(`${line}\r\n`)
    say('220 supertext-demo ESMTP')
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8')
      for (;;) {
        if (data) {
          const end = buf.indexOf('\r\n.\r\n')
          if (end < 0) return
          mail += buf.slice(0, end)
          buf = buf.slice(end + 5)
          data = false
          onMail(mail)
          mail = ''
          say('250 OK')
          continue
        }
        const nl = buf.indexOf('\r\n')
        if (nl < 0) return
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 2)
        const cmd = line.slice(0, 4).toUpperCase()
        if (cmd === 'EHLO' || cmd === 'HELO') say('250 supertext-demo')
        else if (cmd === 'DATA') {
          data = true
          say('354 End data with <CR><LF>.<CR><LF>')
        } else if (cmd === 'QUIT') {
          say('221 Bye')
          socket.end()
        } else say('250 OK')
      }
    })
    socket.on('error', () => {})
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(2525, '127.0.0.1', () => resolve(server))
  })
}

/** Finds the invite link in a raw e-mail (quoted-printable or base64 parts). */
function inviteToken(mail) {
  const qp = mail.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  const candidates = [qp]
  for (const m of mail.matchAll(/\r?\n\r?\n([A-Za-z0-9+/=\r\n]{200,})/g)) {
    candidates.push(Buffer.from(m[1].replace(/\s+/g, ''), 'base64').toString('utf8'))
  }
  for (const text of candidates) {
    const m = text.match(/\/ghost\/(?:#\/)?signup\/([^/"'\s<>]+)\/?/)
    if (m) return decodeURIComponent(m[1])
  }
  return null
}

async function ensureAdmin(setupDone) {
  const email = env('DEMO_ADMIN_EMAIL') || env('GHOST_ADMIN_EMAIL')
  const password = env('DEMO_ADMIN_PASSWORD') || env('GHOST_ADMIN_PASSWORD')
  if (!email || !password) {
    warn('DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD are not set: no accounts, integration or sample content are set up.')
    if (!setupDone) warn(`Ghost shows its "create your account" screen at ${SITE}/ghost/ until they are set.`)
    return false
  }
  if (!setupDone) {
    try {
      await api('POST', 'authentication/setup/', {
        setup: [{ blogTitle: env('DEMO_SITE_TITLE', 'Supertext Translation Demo'), email, name: env('DEMO_ADMIN_NAME', 'Supertext Admin'), password }],
      })
      log('Created the administrator account from DEMO_ADMIN_EMAIL (Ghost role: Owner)')
    } catch (err) {
      if (err.type === 'ValidationError') {
        warn(`Skipped the administrator account: DEMO_ADMIN_PASSWORD does not meet Ghost's password rules (${err.ghostMessage}).`)
        return false
      }
      throw err
    }
  }
  try {
    await api('POST', 'session/', { password, username: email })
    return true
  } catch (err) {
    warn(
      `Could not sign in as DEMO_ADMIN_EMAIL (${err.ghostMessage || err.message}). The account exists but its password differs ` +
        'from DEMO_ADMIN_PASSWORD (passwords are never reset from variables), or another owner set Ghost up. ' +
        'Skipping the editor account and integration setup.',
    )
    return false
  }
}

async function ensureEditor() {
  const email = env('DEMO_EDITOR_EMAIL')
  const password = env('DEMO_EDITOR_PASSWORD')
  if (!email || !password) return log('DEMO_EDITOR_EMAIL / DEMO_EDITOR_PASSWORD not set: no editor account')
  const users = await api('GET', `users/?filter=${encodeURIComponent(`email:'${email}'`)}&limit=1`)
  if (users.users?.length) return log('Editor account from DEMO_EDITOR_EMAIL exists')

  const roles = await api('GET', 'roles/?permissions=assign')
  const role = roles.roles.find((r) => r.name === 'Editor')
  const invites = await api('GET', 'invites/?limit=all')
  for (const inv of invites.invites ?? []) {
    if (inv.email.toLowerCase() === email.toLowerCase()) await api('DELETE', `invites/${inv.id}/`, undefined, { raw: true })
  }
  mails.length = 0
  const inviteId = (await api('POST', 'invites/', { invites: [{ email, role_id: role.id }] })).invites[0].id
  let token = null
  for (let i = 0; i < 50 && !token; i++) {
    token = mails.map(inviteToken).find(Boolean) ?? null
    if (!token) await new Promise((r) => setTimeout(r, 100))
  }
  if (!token) throw new Error('The invite e-mail did not arrive at the local mail listener')
  try {
    await api('POST', 'authentication/invitation/', {
      invitation: [{ email, name: env('DEMO_EDITOR_NAME', 'Demo Editor'), password, token }],
    })
    log('Created the editor account from DEMO_EDITOR_EMAIL (Ghost role: Editor)')
  } catch (err) {
    await api('DELETE', `invites/${inviteId}/`, undefined, { raw: true }).catch(() => {})
    if (err.type === 'ValidationError') {
      return warn(`Skipped the editor account: DEMO_EDITOR_PASSWORD does not meet Ghost's password rules (${err.ghostMessage}).`)
    }
    throw err
  }
}

const EVENTS = ['post.added', 'post.edited', 'page.added', 'page.edited']

async function ensureIntegration() {
  const target = (event) => `${SITE}/supertext/webhook?event=${event}`
  const list = await api('GET', 'integrations/?include=api_keys,webhooks&limit=all')
  let integration = list.integrations.find((i) => i.name === INTEGRATION)
  let secret = integration?.webhooks?.find((w) => w.secret)?.secret || randomBytes(24).toString('hex')
  if (!integration) {
    integration = (
      await api('POST', 'integrations/?include=api_keys,webhooks', {
        integrations: [
          {
            description: 'Translates posts and pages with Supertext when a #translate tag is added.',
            name: INTEGRATION,
            webhooks: EVENTS.map((event) => ({ event, name: `Supertext: ${event}`, secret, target_url: target(event) })),
          },
        ],
      })
    ).integrations[0]
    log(`Created the "${INTEGRATION}" integration with ${EVENTS.length} webhooks`)
  } else {
    for (const event of EVENTS) {
      const hooks = integration.webhooks.filter((w) => w.event === event)
      const good = hooks.find((w) => w.target_url === target(event) && w.secret === secret)
      for (const w of hooks) if (w !== good) await api('DELETE', `webhooks/${w.id}/`, undefined, { raw: true })
      if (!good) {
        await api('POST', 'webhooks/', {
          webhooks: [{ event, integration_id: integration.id, name: `Supertext: ${event}`, secret, target_url: target(event) }],
        })
        log(`Pointed the ${event} webhook at ${target(event)}`)
      }
    }
  }
  const key = integration.api_keys.find((k) => k.type === 'admin')
  // Ghost 6 returns the full key ("id:secret") in `secret`.
  const adminKey = key.secret.includes(':') ? key.secret : `${key.id}:${key.secret}`
  writeFileSync(SETTINGS_FILE, JSON.stringify({ adminKey, webhookSecret: secret }), { mode: 0o600 })
}

const nativeName = (code) => {
  try {
    const n = new Intl.DisplayNames([code], { languageDisplay: 'standard', type: 'language' }).of(code) ?? code
    return n.charAt(0).toUpperCase() + n.slice(1)
  } catch {
    return code
  }
}

async function ensureLanguages() {
  const slugs = TARGETS.map((c) => c.toLowerCase().replace(/_/g, '-'))
  const routes = [
    ROUTES_MARKER,
    `# Target languages: ${TARGETS.join(', ')}. Each translation carries the tag #lang-<code>.`,
    'routes:',
    '',
    'collections:',
    ...slugs.flatMap((s) => [`  /${s}/:`, `    permalink: /${s}/{slug}/`, '    template: index', `    filter: tag:hash-lang-${s}`]),
    '  /:',
    '    permalink: /{slug}/',
    '    template: index',
    ...(slugs.length ? [`    filter: ${slugs.map((s) => `tag:-hash-lang-${s}`).join('+')}`] : []),
    '',
    'taxonomies:',
    '  tag: /tag/{slug}/',
    '  author: /author/{slug}/',
    '',
  ].join('\n')
  const current = await api('GET', 'settings/routes/yaml/', undefined, { raw: true })
  const isDefault = !/filter:/.test(current.text) && /permalink: \/\{slug\}\//.test(current.text)
  if (current.text.trim() === routes.trim()) log('routes.yaml already has the language collections')
  else if (isDefault || current.text.startsWith(ROUTES_MARKER)) {
    const form = new FormData()
    form.append('routes', new Blob([routes], { type: 'application/x-yaml' }), 'routes.yaml')
    await api('POST', 'settings/routes/yaml/', undefined, { form })
    log(`Uploaded routes.yaml with collections for ${slugs.map((s) => `/${s}/`).join(', ')}`)
  } else warn('routes.yaml was customised in Ghost Admin; left it unchanged')

  const settings = (await api('GET', 'settings/')).settings
  const nav = JSON.parse(settings.find((s) => s.key === 'navigation')?.value || '[]')
  const missing = slugs
    .map((s, i) => ({ label: nativeName(TARGETS[i]), url: `/${s}/` }))
    .filter((item) => !nav.some((n) => n.url === item.url || n.url === `${SITE}${item.url}`))
  if (missing.length) {
    await api('PUT', 'settings/', { settings: [{ key: 'navigation', value: JSON.stringify([...nav, ...missing]) }] })
    log(`Added navigation links: ${missing.map((m) => m.label).join(', ')}`)
  }
}

async function ensureSamplePost() {
  const found = await api('GET', `posts/?filter=${encodeURIComponent(`slug:${SAMPLE_SLUG}`)}&limit=1`)
  if (found.posts?.length) return log('Sample post exists')
  const html = readFileSync(new URL('sample-post.html', import.meta.url), 'utf8')
  await api('POST', 'posts/?source=html', {
    posts: [
      {
        custom_excerpt: 'Add one tag, save, and get a translated draft that keeps your formatting.',
        html,
        slug: SAMPLE_SLUG,
        status: 'published',
        tags: [{ name: 'Getting started' }],
        title: 'Translate your Ghost posts with Supertext',
      },
    ],
  })
  log('Created and published the sample post')
}

/** Mails Ghost sent while the bootstrap ran (welcome mail, the editor's invite). */
const mails = []

async function main() {
  if (!SITE) throw new Error('url is not set')
  const setupDone = await waitForGhost()
  // Catch Ghost's mails (welcome mail, invite) while setting up; afterwards nothing listens.
  let sink
  try {
    sink = await mailSink((mail) => mails.push(mail))
  } catch (err) {
    warn(`Could not open the local mail listener on 127.0.0.1:2525 (${err.message})`)
  }
  try {
    await setUp(setupDone)
  } finally {
    sink?.close()
  }
}

async function setUp(setupDone) {
  if (!(await ensureAdmin(setupDone))) return
  for (const [name, step] of [
    ['editor account', ensureEditor],
    ['integration', ensureIntegration],
    ['languages', ensureLanguages],
    ['sample post', ensureSamplePost],
  ]) {
    try {
      await step()
    } catch (err) {
      warn(`${name}: ${err.message}`)
    }
  }
  log('Bootstrap done')
}

main().catch((err) => {
  warn(`Bootstrap failed: ${err.message}`)
  process.exitCode = 1
})
