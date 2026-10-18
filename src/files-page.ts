import type { ImportJob } from './files.js'
import { format, languageLabel, type Localizable, type MessageKey, type Params, t, type UiLocale } from './i18n/index.js'
import type { Language } from './languages.js'
import { escapeHtml as e } from './segments.js'
import { pageCss, pageHeader } from './status-page.js'
import { staticUrl } from './static.js'

export type FilesPageData = {
  locale: UiLocale
  version: string
  siteTitle: string
  siteUrl: string
  /** Ghost Owner, Administrator or Editor: may export and import. */
  canUse: boolean
  csrf: string
  exportAction: string
  importAction: string
  statusUrl: string
  /** Posts and pages to choose from (not translations): value `posts:<id>` / `pages:<id>`. */
  items: Array<{ value: string; title: string; kind: 'post' | 'page'; status: string }>
  languages: Language[]
  /** What the last request left: an error, or the import summary. */
  error?: Localizable | null
  jobs?: ImportJob[] | null
  /** The form values to keep after an error. */
  selected?: { item?: string; format?: string; targets?: string[] }
}

const editorUrl = (site: string, job: ImportJob, id: string) => `${site}/ghost/#/editor/${job.resource === 'pages' ? 'page' : 'post'}/${encodeURIComponent(id)}`

/** The staff page next to the status page: Export for translation, Import translation, the import summary. */
export function renderFilesPage(d: FilesPageData): string {
  const L = (key: MessageKey, params?: Params) => t(d.locale, key, params, e)
  const sel = d.selected ?? {}
  const format_ = sel.format === 'html' ? 'html' : 'xliff'
  const targets = new Set(sel.targets ?? d.languages.map((l) => l.code))
  const options = d.items
    .map((i) => `<option value="${e(i.value)}"${i.value === sel.item ? ' selected' : ''}>${L(i.kind === 'page' ? 'files.page' : 'files.post')}: ${e(i.title || i.value)} (${e(i.status)})</option>`)
    .join('')
  const summary = (j: ImportJob) => {
    const lines: string[] = []
    if (j.error) lines.push(`<p class="bad">${format(d.locale, [j.error], e)}</p>`)
    else {
      const items = [`<li>${L('files.summaryOk', { count: j.imported })}</li>`]
      if (j.skippedChanged) items.push(`<li>${L('files.summaryChanged', { count: j.skippedChanged })}</li>`)
      if (j.counts.untranslated) items.push(`<li>${L('files.summaryUntranslated', { count: j.counts.untranslated })}</li>`)
      if (j.counts.invalid_markup) items.push(`<li>${L('files.summaryInvalid', { count: j.counts.invalid_markup })}</li>`)
      if (j.counts.missing) items.push(`<li>${L('files.summaryMissing', { count: j.counts.missing })}</li>`)
      lines.push(`<ul class="counts">${items.join('')}</ul>`)
      if (j.result) {
        const open = j.result.translationId && j.result.status !== 'failed' ? ` <a class="open" href="${e(editorUrl(d.siteUrl, j, j.result.translationId))}">${L('page.openTranslation')}</a>` : ''
        lines.push(`<p><span class="badge ${j.result.status}">${L(`status.${j.result.status}`)}</span> ${format(d.locale, j.result.localized, e)}${open}</p>`)
      }
    }
    const title = j.title ?? j.reference
    const language = j.language ? ` → ${e(languageLabel(j.language, d.locale))}` : ''
    return `<div class="job"><h3>${e(title)}${language}</h3>${lines.join('')}</div>`
  }
  const disabled = d.canUse ? '' : ' disabled'
  return `<!DOCTYPE html>
<html lang="${d.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${L('files.title')} · ${e(d.siteTitle)}</title>
<link rel="icon" href="${staticUrl('favicon.svg', d.version)}" type="image/svg+xml">
<style>
${pageCss(d.version)}
fieldset{border:0;margin:0 0 14px;padding:0}
legend,label.field{display:block;font-weight:600;margin-bottom:6px}
.choice{display:block;margin:4px 0}
.choice input{margin-right:8px}
input[type=file]{font:inherit;margin-bottom:14px}
.job{border-top:1px solid var(--line);padding-top:12px;margin-top:12px}
.job h3{margin:0 0 6px;font-size:16px}
ul.counts{margin:4px 0;padding-left:20px}
</style>
</head>
<body>
${pageHeader(d.locale, d.version, d.siteTitle, d.siteUrl)}
<main>
${d.canUse ? '' : `<section><p class="bad">${L('files.editorsOnly')}</p></section>`}
${d.error ? `<section id="error"><p class="bad" role="alert">${format(d.locale, [d.error], e)}</p></section>` : ''}
${
  d.jobs
    ? `<section id="result"><h2>${L('files.resultTitle')}</h2>${d.jobs.map(summary).join('\n')}</section>`
    : ''
}
<section id="export">
  <h2>${L('files.export')}</h2>
  <p>${L('files.exportIntro')}</p>
  <form method="post" action="${e(d.exportAction)}">
  <input type="hidden" name="csrf" value="${e(d.csrf)}">
  <label class="field" for="item">${L('files.item')}</label>
  ${d.items.length ? `<p><select id="item" name="item"${disabled}>${options}</select></p>` : `<p class="muted">${L('files.noItems')}</p>`}
  <fieldset><legend>${L('files.format')}</legend>
    <label class="choice"><input type="radio" name="format" value="xliff"${format_ === 'xliff' ? ' checked' : ''}${disabled}>${L('files.formatXliff')}</label>
    <label class="choice"><input type="radio" name="format" value="html"${format_ === 'html' ? ' checked' : ''}${disabled}>${L('files.formatHtml')}</label>
  </fieldset>
  <fieldset><legend>${L('files.targets')}</legend>
${d.languages.map((l) => `    <label class="choice"><input type="checkbox" name="target" value="${e(l.code)}"${targets.has(l.code) ? ' checked' : ''}${disabled}>${e(languageLabel(l.code, d.locale))} <code class="tag">${e(l.code)}</code></label>`).join('\n')}
  </fieldset>
  <p><button type="submit"${disabled || (d.items.length ? '' : ' disabled')}>${L('files.download')}</button></p>
  </form>
</section>
<section id="import">
  <h2>${L('files.import')}</h2>
  <p>${L('files.importIntro')}</p>
  <form method="post" action="${e(d.importAction)}" enctype="multipart/form-data">
  <input type="hidden" name="csrf" value="${e(d.csrf)}">
  <label class="field" for="file">${L('files.file')}</label>
  <input id="file" type="file" name="file" accept=".xlf,.xliff,.xml,.html,.htm"${disabled}>
  <label class="choice"><input type="checkbox" name="includeChanged" value="1"${disabled}>${L('files.includeChanged')}</label>
  <label class="choice"><input type="checkbox" name="overwrite" value="1"${disabled}>${L('files.overwrite')}</label>
  <p><button type="submit"${disabled}>${L('files.import')}</button></p>
  </form>
</section>
<p><a href="${e(d.statusUrl)}">${L('page.title')}</a></p>
</main>
</body>
</html>`
}
