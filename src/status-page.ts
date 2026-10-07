import type { Job } from './jobs.js'
import { type Language, RETRANSLATE_ALL_TAG, TRANSLATE_ALL_TAG } from './languages.js'
import { escapeHtml as e } from './segments.js'
import { API_KEY_URL, SIGNUP_URL } from './supertext/client.js'
import { releaseUrl } from './version.js'

export type StatusPageData = {
  siteUrl: string
  siteTitle: string
  ghost: { ok: boolean; detail: string }
  supertext: { endpoint: string; keyConfigured: boolean }
  webhookSecret: boolean
  sourceLanguage: string
  sourceLabel: string
  languages: Language[]
  jobs: Job[]
  viewer: string
  /** Connector version (package.json). */
  version: string
}

const STATUS_LABEL: Record<Job['status'], string> = {
  created: 'Created',
  failed: 'Failed',
  kept: 'Not overwritten',
  running: 'Translating…',
  skipped: 'Skipped',
  updated: 'Updated',
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

/** The staff-only page at /supertext/: how to translate, recent results, configuration. */
export function renderStatusPage(d: StatusPageData): string {
  const running = d.jobs.some((j) => j.status === 'running')
  const rows = d.jobs
    .map(
      (j) => `<tr>
  <td class="when">${e(time(j.at))}</td>
  <td><a href="${e(editorUrl(d.siteUrl, j, j.postId))}">${e(j.postTitle || j.postId)}</a></td>
  <td>${e(j.languageLabel)}${j.force ? ' <span class="muted">(retranslate)</span>' : ''}</td>
  <td><span class="badge ${j.status}">${STATUS_LABEL[j.status]}</span></td>
  <td>${e(j.message)}${
    j.translationId && j.status !== 'failed'
      ? ` <a class="open" href="${e(editorUrl(d.siteUrl, j, j.translationId))}">Open translation</a>`
      : ''
  }</td>
</tr>`,
    )
    .join('\n')

  const langRows = d.languages
    .map(
      (l) => `<tr><td>${e(l.label)} <span class="muted">${e(l.code)}</span></td><td>${tag(l.translateTag)}</td><td>${tag(
        l.retranslateTag,
      )}</td><td>${tag(l.langTag)}</td></tr>`,
    )
    .join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${running ? '<meta http-equiv="refresh" content="4">' : ''}
<title>Supertext Translation · ${e(d.siteTitle)}</title>
<style>
:root{--bg:#f4f5f6;--card:#fff;--text:#15171a;--muted:#7c8b9a;--line:#e6e9eb;--green:#30cf43;--accent:#14b886}
@media (prefers-color-scheme:dark){:root{--bg:#151719;--card:#1c1f22;--text:#e8eaed;--muted:#8e9cac;--line:#2c3136}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,sans-serif}
header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 24px;border-bottom:1px solid var(--line);background:var(--card)}
header h1{margin:0;font-size:19px;font-weight:700}
header .site{color:var(--muted);font-weight:500}
header a{color:var(--text);font-weight:600;text-decoration:none;border:1px solid var(--line);border-radius:6px;padding:6px 12px;white-space:nowrap}
main{max-width:1080px;margin:0 auto;padding:24px 16px 48px;display:grid;gap:20px}
section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:20px 22px}
h2{margin:0 0 12px;font-size:16px}
p{margin:6px 0}
.muted{color:var(--muted)}
.tag{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:1px 6px;white-space:nowrap}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;vertical-align:top;padding:9px 10px 9px 0;border-top:1px solid var(--line)}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600;border-top:0}
td.when{white-space:nowrap;color:var(--muted);font-size:13px}
a{color:var(--accent)}
a.open{white-space:nowrap}
.badge{display:inline-block;font-size:12px;font-weight:600;border-radius:999px;padding:2px 9px;white-space:nowrap;background:var(--bg)}
.badge.created,.badge.updated{background:#dff7e3;color:#1c7d2b}
.badge.kept{background:#fff3d6;color:#8a5a00}
.badge.failed{background:#fde4e4;color:#b42318}
.badge.running{background:#e2efff;color:#1d5fbf}
@media (prefers-color-scheme:dark){.badge.created,.badge.updated{background:#173d20;color:#7be08c}.badge.kept{background:#3d2f10;color:#f4c45c}.badge.failed{background:#451c1c;color:#ff9b93}.badge.running{background:#16304f;color:#8ab8ff}}
dl{display:grid;grid-template-columns:max-content 1fr;gap:6px 18px;margin:0}
dt{color:var(--muted)}dd{margin:0}
.ok{color:#1c7d2b;font-weight:600}.bad{color:#b42318;font-weight:600}
@media (max-width:700px){table.jobs thead{display:none}table.jobs tr{display:block;border-top:1px solid var(--line);padding:8px 0}table.jobs td{display:block;border:0;padding:2px 0}}
</style>
</head>
<body>
<header>
  <h1>Supertext Translation <span class="site">· ${e(d.siteTitle)}</span></h1>
  <a href="${e(d.siteUrl)}/ghost/">Back to Ghost Admin</a>
</header>
<main>
<section id="how">
  <h2>How to translate</h2>
  <p>Open a post or page in Ghost Admin, add one of these tags in the post settings, and save. A few seconds later a translated <strong>draft</strong> appears in your posts list, ready to review and publish.</p>
  <p>${tag(TRANSLATE_ALL_TAG)} translates into every language below. ${tag(RETRANSLATE_ALL_TAG)} does the same and also replaces translations that were edited or published.</p>
</section>
<section id="jobs">
  <h2>Recent translations</h2>
  ${
    d.jobs.length
      ? `<table class="jobs"><thead><tr><th>When</th><th>Source</th><th>Language</th><th>Result</th><th>Details</th></tr></thead><tbody>
${rows}
</tbody></table>`
      : '<p class="muted">No translations yet. Add a tag to a post to start.</p>'
  }
</section>
<section id="languages">
  <h2>Languages</h2>
  <p>Source language: <strong>${e(d.sourceLabel)}</strong> <span class="muted">${e(d.sourceLanguage)}</span></p>
  <table><thead><tr><th>Target language</th><th>Translate</th><th>Retranslate</th><th>Marks translations</th></tr></thead><tbody>
${langRows}
  </tbody></table>
</section>
<section id="settings">
  <h2>Connection</h2>
  <dl>
    <dt>Supertext API</dt><dd>${e(d.supertext.endpoint)}</dd>
    <dt>API key</dt><dd>${d.supertext.keyConfigured ? '<span class="ok">Configured</span>' : '<span class="bad">Missing</span> — set SUPERTEXT_API_KEY'}<br><span class="muted">No Supertext account yet? <a href="${SIGNUP_URL}" target="_blank" rel="noopener">Create one at supertext.com</a>. Generate your API key at <a href="${API_KEY_URL}" target="_blank" rel="noopener">supertext.com → Integrations → API</a> (requires the Admin role).</span></dd>
    <dt>Ghost</dt><dd>${d.ghost.ok ? `<span class="ok">Connected</span> ${e(d.ghost.detail)}` : `<span class="bad">Not connected</span> — ${e(d.ghost.detail)}`}</dd>
    <dt>Webhook signature</dt><dd>${d.webhookSecret ? '<span class="ok">Checked</span>' : '<span class="bad">Not checked</span> — set a webhook secret'}</dd>
    <dt>Connector version</dt><dd>${versionHtml(d.version)}</dd>
    <dt>Signed in as</dt><dd>${e(d.viewer)}</dd>
  </dl>
</section>
</main>
</body>
</html>`
}
