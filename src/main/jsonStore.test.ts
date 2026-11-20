import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readJsonFile, writeJsonFileAtomic } from './jsonStore'

let dir = ''

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcompare-json-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('jsonStore', () => {
  it('writes and reads JSON atomically', () => {
    const file = path.join(dir, 'nested', 'store.json')
    writeJsonFileAtomic(file, { value: 42, list: ['a'] })
    expect(readJsonFile(file)).toEqual({ value: 42, list: ['a'] })
    const tempFiles = fs
      .readdirSync(path.dirname(file))
      .filter((name) => name.endsWith('.tmp'))
    expect(tempFiles).toEqual([])
  })

  it('returns null for a missing file', () => {
    expect(readJsonFile(path.join(dir, 'missing.json'))).toBeNull()
  })

  it('moves corrupt JSON aside and returns null', () => {
    const file = path.join(dir, 'corrupt.json')
    fs.writeFileSync(file, '{not json', 'utf8')
    expect(readJsonFile(file)).toBeNull()
    expect(fs.existsSync(file)).toBe(false)
    const backups = fs.readdirSync(dir).filter((name) => name.includes('.corrupt-'))
    expect(backups.length).toBe(1)
    expect(fs.readFileSync(path.join(dir, backups[0]), 'utf8')).toBe('{not json')
  })
})
