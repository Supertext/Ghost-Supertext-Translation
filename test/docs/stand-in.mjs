#!/usr/bin/env node
/**
 * Local stand-in for the Supertext AI file translation API, for docs screenshots and
 * end-to-end checks of the demo. Answers like the real API and returns real German for
 * the demo's sample post (sample-de.json, keyed by the inline HTML of each segment).
 * Other text comes back as "[<target>] text". Listens on :8765 (any API key).
 * It also answers the Commando Center's `POST /report` with 202 (point SUPERTEXT_REPORT_URL at
 * http://<host>:8765/report), so screenshot runs never report to the live center.
 */
import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'

const german = JSON.parse(readFileSync(new URL('sample-de.json', import.meta.url), 'utf8'))
const files = new Map()

http
  .createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname.replace(/^\/v1/, '')
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type })
      res.end(type === 'application/json' ? JSON.stringify(body) : body)
    }
    if (path === '/features') return send(200, {})
    if (req.method === 'POST' && (path === '/report' || path === '/api/v1/report')) {
      for await (const chunk of req) void chunk
      return send(202, { ok: true })
    }
    if (req.method === 'POST') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const form = await new Request('http://x', { body: Buffer.concat(chunks), headers: req.headers, method: 'POST' }).formData()
      const id = randomBytes(6).toString('hex')
      const target = String(form.get('target_lang'))
      const source = form.get('source_lang')
      // Like the real API: only the codes of `GET features` (a few listed here); `de`, `es-ES`, `zh-CN` or a regional source are rejected.
      const targets = ['de-CH', 'de-DE', 'de-AT', 'fr-CH', 'fr-FR', 'it-CH', 'it-IT', 'en-US', 'en-GB', 'es', 'nl', 'pt-BR', 'pt-PT']
      if (!targets.includes(target) || (typeof source === 'string' && source.includes('-'))) return send(404, { error_code: 'INVALID_LANGUAGE_PAIR' })
      files.set(id, { html: await form.get('file').text(), target })
      return send(200, { file_id: id })
    }
    const match = path.match(/file\/([a-f0-9]+)(\/status|\/translation)?$/)
    if (!match || !files.has(match[1])) return send(404, {})
    if (req.method === 'DELETE') return send(200, {})
    if (match[2] === '/status') return send(200, { status: 'done' })
    const { html, target } = files.get(match[1])
    const out = html.replace(/(<div data-st-id="\d+">)([\s\S]*?)(<\/div>\n)/g, (all, open, inner, close) => {
      if (target.startsWith('de') && german[inner] !== undefined) return open + german[inner] + close
      return `${open}[${target}] ${inner}${close}`
    })
    send(200, out, 'text/html')
  })
  .listen(Number(process.env.PORT || 8765), () => console.log(`Stand-in API on http://127.0.0.1:${process.env.PORT || 8765}/v1/`))
