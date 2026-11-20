import { app } from 'electron'
import path from 'node:path'
import { readJsonFile, writeJsonFileAtomic } from './jsonStore'
import crypto from 'node:crypto'
import type { Location, RecentEntry, RecentInput } from '../shared/types'

const MAX_ENTRIES = 40

function locationKey(location: Location): string {
  return location.kind === 'local'
    ? `local:${location.path.toLowerCase()}`
    : `remote:${location.connectionId}:${location.path}`
}

export class RecentStore {
  private entries: RecentEntry[] = []
  private readonly storePath: string

  constructor() {
    this.storePath = path.join(app.getPath('userData'), 'recent.json')
    this.load()
  }

  private load(): void {
    const parsed = readJsonFile<{ entries?: RecentEntry[] }>(this.storePath)
    if (Array.isArray(parsed?.entries)) {
      this.entries = parsed.entries.filter(
        (entry) =>
          entry &&
          entry.kind &&
          entry.left &&
          entry.right &&
          typeof entry.addedAt === 'number'
      )
    }
  }

  private persist(): void {
    writeJsonFileAtomic(this.storePath, { entries: this.entries })
  }

  list(): RecentEntry[] {
    return this.entries.map((entry) => ({ ...entry }))
  }

  add(input: RecentInput): RecentEntry[] {
    const key = `${input.kind}|${locationKey(input.left)}|${locationKey(input.right)}`
    const existing = this.entries.find(
      (entry) =>
        `${entry.kind}|${locationKey(entry.left)}|${locationKey(entry.right)}` === key
    )
    if (existing) {
      this.entries = this.entries.filter((entry) => entry.id !== existing.id)
      existing.addedAt = Date.now()
      this.entries.unshift(existing)
    } else {
      this.entries.unshift({
        id: crypto.randomUUID(),
        kind: input.kind,
        left: input.left,
        right: input.right,
        addedAt: Date.now()
      })
    }
    this.entries = this.entries.slice(0, MAX_ENTRIES)
    this.persist()
    return this.list()
  }

  clear(): void {
    this.entries = []
    this.persist()
  }
}
