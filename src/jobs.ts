import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { Resource } from './ghost/admin.js'
import type { Localizable } from './i18n/index.js'
import type { ResultStatus } from './translate.js'

export type Job = {
  id: number
  at: string
  resource: Resource
  postId: string
  postTitle: string
  language: string
  languageLabel: string
  force: boolean
  status: ResultStatus | 'running'
  /** English (logs; older job files only have this). */
  message: string
  /** The message as catalog keys, shown in the reader's language on the status page. */
  localized?: Localizable[]
  translationId?: string
  translationTitle?: string
}

const INTERRUPTED: Localizable = { key: 'job.interrupted' }

/** The last translation requests, newest first, for the status page. Optionally kept in a JSON file. */
export class JobLog {
  private jobs: Job[] = []
  private next = 1

  constructor(
    private readonly file: string | null,
    private readonly max = 100,
  ) {
    if (!file) return
    try {
      this.jobs = (JSON.parse(readFileSync(file, 'utf8')) as Job[]).slice(0, max)
      this.next = Math.max(0, ...this.jobs.map((j) => j.id)) + 1
      for (const j of this.jobs) {
        if (j.status === 'running') Object.assign(j, { localized: [INTERRUPTED], message: 'Interrupted by a restart. Remove the tag, save, and add it again.', status: 'failed' })
      }
    } catch {
      // first start or unreadable: start empty
    }
  }

  list(): Job[] {
    return this.jobs
  }

  isRunning(postId: string, language: string): boolean {
    return this.jobs.some((j) => j.status === 'running' && j.postId === postId && j.language === language)
  }

  start(job: Omit<Job, 'id' | 'at' | 'status' | 'message' | 'localized'>): Job {
    const full: Job = {
      ...job,
      at: new Date().toISOString(),
      id: this.next++,
      localized: [{ key: 'job.translating' }],
      message: 'Translating…',
      status: 'running',
    }
    this.jobs = [full, ...this.jobs].slice(0, this.max)
    this.save()
    return full
  }

  finish(job: Job, result: Pick<Job, 'status' | 'message' | 'localized' | 'translationId' | 'translationTitle'>): void {
    Object.assign(job, result)
    this.save()
  }

  private save(): void {
    if (!this.file) return
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify(this.jobs))
    } catch {
      // the status page still works from memory
    }
  }
}
