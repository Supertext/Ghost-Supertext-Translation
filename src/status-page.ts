import { format, languageLabel, type MessageKey, type Params, t, type UiLocale } from './i18n/index.js'
import type { Job } from './jobs.js'
import { type Language, RETRANSLATE_ALL_TAG, TRANSLATE_ALL_TAG } from './languages.js'
import { escapeHtml as e } from './segments.js'
import { fieldName, type MappingRow } from './settings.js'
import { API_KEY_URL, SIGNUP_URL } from './supertext/client.js'
import type { KeyCheck } from './vendor/supertext-plugin-health/index.js'
import { fontFaces, staticUrl } from './static.js'
import { releaseUrl } from './version.js'
import { Languages } from './vendor/supertext-sdk/v1/index.js'

export type StatusPageData = {
  siteUrl: string
  siteTitle: string
  ghost: { ok: boolean; detail: string }
  supertext: { endpoint: string; keyConfigured: boolean }
  webhookSecret: boolean
  sourceLanguage: string
  /** The Supertext code the source language is sent as; null when it isn't mapped. */
  sourceTarget?: string | null
  languages: Language[]
  /** Commando Center: the setting, the ping address and the latest API key check. */
  reports?: { enabled: boolean; callbackUrl: string | null; check: KeyCheck | null }
  jobs: Job[]
  /** The language mapping form (one combo box per language); absent outside proxy mode. */
  mapping?: {
    rows: MappingRow[]
    /** Ghost Owner or Administrator: may save. Others see the choices read-only. */
    canEdit: boolean
    csrf: string
    formAction: string
    /** Saved to a file (false: kept in memory until the next restart). */
    persistent: boolean
    /** Just saved: to the file, or only in memory. */
    saved: 'saved' | 'memory' | null
  }
  viewer: string
  /** The translation files page (Export for translation / Import translation); absent outside proxy mode. */
  filesUrl?: string
  /** Connector version (package.json). */
  version: string
  /** Language of the page (UI_LANGUAGE or the browser's Accept-Language). */
  locale: UiLocale
}


const editorUrl = (site: string, job: Job, id: string) =>
  `${site}/ghost/#/editor/${job.resource === 'posts' ? 'post' : 'page'}/${encodeURIComponent(id)}`

const time = (iso: string) => {
  const d = new Date(iso)
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`
}

const versionHtml = (v: string) => {
  const url = releaseUrl(v)
  return url ? `<a href="${e(url)}" target="_blank" rel="noopener">${e(v)}</a>` : e(v)
}

const tag = (name: string) => `<code class="tag">${e(name)}</code>`

/** The latest API key check in the reader's language (texts from the Commando Center's guide), with its time. */
function keyCheckHtml(d: StatusPageData, check: KeyCheck | null | undefined): string {
  const L = (key: MessageKey, params?: Params) => t(d.locale, key, params, e)
  if (!check) return `<span class="muted">${L('page.notCheckedYet')}</span>`
  const ok = check.status === 'ok'
  const text = L(`keycheck.${check.status}` as MessageKey, { status: check.httpStatus ?? '' })
  const links = check.status === 'invalid' || check.status === 'missing' ? `<br><span class="muted">${L('page.keyHelp', { apiKeyUrl: API_KEY_URL, signupUrl: SIGNUP_URL })}</span>` : ''
  return `<span class="${ok ? 'ok' : 'bad'}">${text}</span> <span class="muted">${L('page.checkedAt', { time: time(check.checkedAt) })}</span>${links}`
}

/** One combo box per language: Supertext's targets, "Name (code)" in the reader's language. */
function mappingHtml(d: StatusPageData, m: NonNullable<StatusPageData['mapping']>): string {
  const L = (key: MessageKey, params?: Params) => t(d.locale, key, params, e)
  const options = Languages.targetOptions()
    .map((o) => ({ code: o.code, label: `${languageLabel(o.code, d.locale)} (${o.code})` }))
    .sort((a, b) => a.label.localeCompare(b.label, d.locale))
  const row = (r: MappingRow) => {
    const id = `map-${r.code.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
    const known = options.some((o) => o.code === r.selected)
    const choose = r.selected === '' || !known ? `<option value=""${r.selected === '' ? ' selected' : ''}>${L('page.mappingChoose')}</option>` : ''
    const unknown = r.selected !== '' && !known ? `<option value="${e(r.selected)}" selected>${e(r.selected)}</option>` : ''
    const opts = options.map((o) => `<option value="${e(o.code)}"${o.code === r.selected ? ' selected' : ''}>${e(o.label)}</option>`).join('')
    const disabled = r.overridden || !m.canEdit ? ' disabled' : ''
    const note = r.overridden
      ? `<span class="muted">${L('page.mappingOverridden')}</span>`
      : r.selected === ''
        ? `<span class="bad">${L('page.mappingNone')}</span>`
        : ''
    return `<tr><td><label for="${id}">${e(languageLabel(r.code, d.locale))}</label> ${tag(r.code)}<br><span class="muted">${L(r.role === 'source' ? 'page.mappingSource' : 'page.mappingTarget')}</span></td><td><select id="${id}" name="${e(fieldName(r.code))}"${disabled}>${choose}${unknown}${opts}</select>${note ? `<br>${note}` : ''}</td></tr>`
  }
  const saved = m.saved === 'saved' ? `<p class="ok" role="status">${L('page.mappingSaved')}</p>` : m.saved === 'memory' ? `<p class="bad" role="status">${L('page.mappingMemory')}</p>` : ''
  return `<section id="mapping">
  <h2>${L('page.mappingTitle')}</h2>
  ${saved}
  <p>${L('page.mappingIntro')}</p>
  ${m.persistent ? '' : `<p class="muted">${L('page.mappingNotPersistent')}</p>`}
  <form method="post" action="${e(m.formAction)}">
  <input type="hidden" name="csrf" value="${e(m.csrf)}">
  <div class="table-scroll"><table class="mapping"><thead><tr><th>${L('page.mappingColLanguage')}</th><th>${L('page.mappingColSupertext')}</th></tr></thead><tbody>
${m.rows.map(row).join('\n')}
  </tbody></table></div>
  ${m.canEdit ? `<p><button type="submit">${L('page.mappingSave')}</button></p>` : `<p class="muted">${L('page.mappingAdminOnly')}</p>`}
  </form>
</section>`
}

/** The connector pages' style (Supertext's look); shared by the status page and the translation files page. */
export const pageCss = (version: string) => `${fontFaces(version)}
/* Supertext's look (supertext.com): deep green, mint, warm off-white, Inter. */
:root{--bg:#f7f5f3;--card:#fff;--text:#003230;--muted:#505252;--line:#dfe1df;--mint:#78ffaf;--mint-hover:#86ffb7;--mint-light:#e4fff0;--green:#2bb673;--orange:#a35a00;--orange-light:#fff6e8;--red:#c4314b;--red-light:#fdebee;--blue:#1d4f91;--blue-light:#e8f0fb}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-feature-settings:"cv11";overflow-x:hidden}
header{display:flex;align-items:center;flex-wrap:wrap;gap:12px 24px;background:var(--text);color:#fff;padding:14px 28px;min-height:64px;max-width:1180px;margin:0 auto;border-radius:0 0 15px 15px}
header .brand{display:flex;align-items:center;flex-wrap:wrap;gap:6px 14px;margin:0;font-size:16px;font-weight:600;color:#fff;letter-spacing:0}
header .brand img{height:22px;width:auto;display:block}
header .site{color:rgba(255,255,255,.72);font-weight:400}
header .spacer{flex:1}
header a.back{display:inline-flex;align-items:center;min-height:40px;padding:7px 18px;border:1px solid rgba(255,255,255,.6);border-radius:999px;color:#fff;font-weight:500;text-decoration:none;white-space:nowrap}
header a.back:hover{background:rgba(255,255,255,.12);border-color:#fff}
select{font:inherit;color:var(--text);background:var(--card);border:1px solid #b9c0be;border-radius:10px;padding:7px 10px;min-height:40px;max-width:100%;width:22rem}
select:disabled{background:var(--bg);color:var(--muted)}
select:focus-visible,button:focus-visible{outline:3px solid var(--mint);outline-offset:2px}
button{font:inherit;font-weight:600;color:var(--text);background:var(--mint);border:0;border-radius:999px;padding:9px 22px;min-height:40px;cursor:pointer}
button:hover{background:var(--mint-hover)}
table.mapping td{vertical-align:middle}
a:focus-visible{outline:3px solid var(--mint);outline-offset:2px;border-radius:4px}
header a.back:focus-visible{border-radius:999px}
main{max-width:1060px;margin:0 auto;padding:28px 32px 48px;display:grid;gap:20px}
section{background:var(--card);border:1px solid var(--line);border-radius:15px;padding:24px 28px;min-width:0}
h2{margin:0 0 12px;font-size:18px;font-weight:700;letter-spacing:-.01em}
p{margin:6px 0}
a{color:var(--text);text-decoration:underline;text-decoration-color:#9aa5a3;text-underline-offset:3px}
a:hover{text-decoration-color:currentColor}
a.open{white-space:nowrap;font-weight:600}
.muted{color:var(--muted)}
.tag{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg);color:var(--text);border:1px solid var(--line);border-radius:999px;padding:2px 9px;white-space:nowrap}
.table-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;vertical-align:top;padding:10px 12px 10px 0;border-top:1px solid var(--line)}
th{font-size:12px;color:var(--muted);font-weight:600;border-top:0;white-space:nowrap}
td.when{white-space:nowrap;color:var(--muted);font-size:13px}
.badge{display:inline-block;font-size:12px;font-weight:600;border-radius:999px;padding:2px 10px;white-space:nowrap;background:var(--bg);color:var(--muted)}
.badge.created,.badge.updated{background:var(--mint);color:var(--text)}
.badge.kept{background:var(--orange-light);color:var(--orange)}
.badge.failed{background:var(--red-light);color:var(--red)}
.badge.running{background:var(--blue-light);color:var(--blue)}
dl{display:grid;grid-template-columns:max-content 1fr;gap:10px 22px;margin:0}
dt{color:var(--muted)}dd{margin:0;min-width:0;overflow-wrap:anywhere}
.ok{color:var(--text);font-weight:600}
.ok::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);margin-right:7px;vertical-align:1px}
.bad{color:var(--red);font-weight:600}
@media (max-width:700px){header{padding:12px 16px;border-radius:0 0 12px 12px}main{padding:20px 16px 40px}section{padding:18px 16px}table.jobs thead{display:none}table.jobs tr{display:block;border-top:1px solid var(--line);padding:8px 0}table.jobs td{display:block;border:0;padding:2px 0}dl{grid-template-columns:1fr;gap:2px}dd{margin-bottom:10px}}`

/** The connector pages' header: logo, title, site, back to Ghost Admin. */
export const pageHeader = (locale: UiLocale, version: string, siteTitle: string, siteUrl: string) => `<header>
  <h1 class="brand"><img src="${staticUrl('supertext-logo.svg', version)}" alt="Supertext" width="122" height="22"><span>${t(locale, 'page.title', {}, e)} <span class="site">· ${e(siteTitle)}</span></span></h1>
  <span class="spacer"></span>
  <a class="back" href="${e(siteUrl)}/ghost/">${t(locale, 'page.back', {}, e)}</a>
</header>`

/** The staff-only page at /supertext/: how to translate, recent results, configuration. */
export function renderStatusPage(d: StatusPageData): string {
  const L = (key: MessageKey, params?: Params) => t(d.locale, key, params, e)
  const jobMessage = (j: Job) => (j.localized?.length ? format(d.locale, j.localized, e) : e(j.message))
  const running = d.jobs.some((j) => j.status === 'running')
  const rows = d.jobs
    .map(
      (j) => `<tr>
  <td class="when">${e(time(j.at))}</td>
  <td><a href="${e(editorUrl(d.siteUrl, j, j.postId))}">${e(j.postTitle || j.postId)}</a></td>
  <td>${e(languageLabel(j.language, d.locale))}${j.force ? ` <span class="muted">${L('page.retranslate')}</span>` : ''}</td>
  <td><span class="badge ${j.status}">${L(`status.${j.status}`)}</span></td>
  <td>${jobMessage(j)}${
    j.translationId && j.status !== 'failed'
      ? ` <a class="open" href="${e(editorUrl(d.siteUrl, j, j.translationId))}">${L('page.openTranslation')}</a>`
      : ''
  }</td>
</tr>`,
    )
    .join('\n')

  const target = (l: Language) => {
    const code = l.target === null ? `<span class="bad">${L('page.notMapped')}</span>` : `<span class="muted">${e(l.target)}</span>`
    const tone = l.politenessUnsupported
      ? `<br><span class="${l.politenessUnsupported === 'blocked' ? 'bad' : 'muted'}">${L(l.politenessUnsupported === 'blocked' ? 'page.politenessBlocked' : 'page.politenessIgnored')}</span>`
      : ''
    return `${code}${tone}`
  }
  const langRows = d.languages
    .map(
      (l) => `<tr><td>${e(languageLabel(l.code, d.locale))} ${target(l)}</td><td>${tag(l.translateTag)}</td><td>${tag(
        l.retranslateTag,
      )}</td><td>${tag(l.langTag)}</td></tr>`,
    )
    .join('\n')

  return `<!DOCTYPE html>
<html lang="${d.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${running ? '<meta http-equiv="refresh" content="4">' : ''}
<title>${L('page.title')} · ${e(d.siteTitle)}</title>
<link rel="icon" href="${staticUrl('favicon.svg', d.version)}" type="image/svg+xml">
<style>
${pageCss(d.version)}
</style>
</head>
<body>
<header>
  <h1 class="brand"><img src="${staticUrl('supertext-logo.svg', d.version)}" alt="Supertext" width="122" height="22"><span>${L('page.title')} <span class="site">· ${e(d.siteTitle)}</span></span></h1>
  <span class="spacer"></span>
  <a class="back" href="${e(d.siteUrl)}/ghost/">${L('page.back')}</a>
</header>
<main>
<section id="how">
  <h2>${L('page.howTitle')}</h2>
  <p>${L('page.howIntro')}</p>
  <p>${t(d.locale, 'page.howAll', { retranslateAll: tag(RETRANSLATE_ALL_TAG), translateAll: tag(TRANSLATE_ALL_TAG) })}</p>
</section>
${d.filesUrl ? `<section id="files">
  <h2>${L('files.title')}</h2>
  <p>${L('files.intro')}</p>
  <p><a class="open" href="${e(d.filesUrl)}">${L('files.open')}</a></p>
</section>` : ''}
<section id="jobs">
  <h2>${L('page.jobsTitle')}</h2>
  ${
    d.jobs.length
      ? `<table class="jobs"><thead><tr><th>${L('page.colWhen')}</th><th>${L('page.colSource')}</th><th>${L('page.colLanguage')}</th><th>${L('page.colResult')}</th><th>${L('page.colDetails')}</th></tr></thead><tbody>
${rows}
</tbody></table>`
      : `<p class="muted">${L('page.noJobs')}</p>`
  }
</section>
<section id="languages">
  <h2>${L('page.languagesTitle')}</h2>
  <p>${L('page.sourceLanguage')} <strong>${e(languageLabel(d.sourceLanguage, d.locale))}</strong> ${
    d.sourceTarget === null ? `<span class="bad">${L('page.notMapped')}</span>` : `<span class="muted">${e(d.sourceTarget ?? d.sourceLanguage)}</span>`
  }</p>
  <div class="table-scroll"><table><thead><tr><th>${L('page.colTarget')}</th><th>${L('page.colTranslate')}</th><th>${L('page.colRetranslate')}</th><th>${L('page.colMarks')}</th></tr></thead><tbody>
${langRows}
  </tbody></table></div>
</section>
${d.mapping ? mappingHtml(d, d.mapping) : ''}
<section id="settings">
  <h2>${L('page.connectionTitle')}</h2>
  <dl>
    <dt>${L('page.supertextApi')}</dt><dd>${e(d.supertext.endpoint)}</dd>
    <dt>${L('page.apiKey')}</dt><dd>${d.supertext.keyConfigured ? `<span class="ok">${L('page.configured')}</span>` : `<span class="bad">${L('page.missing')}</span> ${L('page.missingKeyHint')}`}<br><span class="muted">${L('page.keyHelp', { apiKeyUrl: API_KEY_URL, signupUrl: SIGNUP_URL })}</span></dd>
    <dt>${L('page.keyCheck')}</dt><dd>${keyCheckHtml(d, d.reports?.check)}</dd>
    <dt>${L('page.ghost')}</dt><dd>${d.ghost.ok ? `<span class="ok">${L('page.connected')}</span> ${e(d.ghost.detail)}` : `<span class="bad">${L('page.notConnected')}</span> — ${e(d.ghost.detail)}`}</dd>
    <dt>${L('page.webhookSignature')}</dt><dd>${d.webhookSecret ? `<span class="ok">${L('page.checked')}</span>` : `<span class="bad">${L('page.notChecked')}</span> ${L('page.webhookHint')}`}</dd>
    <dt>${L('page.version')}</dt><dd>${versionHtml(d.version)}</dd>
    <dt>${L('page.reports')}</dt><dd>${
      d.reports?.enabled === false ? L('page.reportsOff') : `${L('page.reportsOn')}${d.reports?.callbackUrl ? ` <span class="muted">· ${L('page.pingUrl')}: ${e(d.reports.callbackUrl)}</span>` : ''}`
    }<br><span class="muted">${L('page.reportsHelp')}</span></dd>
    <dt>${L('page.signedInAs')}</dt><dd>${e(d.viewer)}</dd>
  </dl>
</section>
</main>
</body>
</html>`
}
