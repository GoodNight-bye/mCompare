import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { copyLocalFile } from './local'

let root = ''

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcompare-local-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('copyLocalFile', () => {
  it('creates parent directories and overwrites the destination', async () => {
    const src = path.join(root, 'src.txt')
    const dst = path.join(root, 'nested', 'dst.txt')
    fs.writeFileSync(src, 'new content', 'utf8')
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.writeFileSync(dst, 'old content', 'utf8')

    await copyLocalFile(src, dst)

    expect(fs.readFileSync(dst, 'utf8')).toBe('new content')
    const leftovers = fs
      .readdirSync(path.dirname(dst))
      .filter((name) => name.includes('.mcompare.tmp'))
    expect(leftovers).toEqual([])
  })

  it('does not leave a temp file when the source is missing', async () => {
    const dst = path.join(root, 'out', 'dst.txt')
    await expect(
      copyLocalFile(path.join(root, 'missing.txt'), dst)
    ).rejects.toThrow()

    const entries = fs.existsSync(path.dirname(dst))
      ? fs.readdirSync(path.dirname(dst))
      : []
    expect(entries).toEqual([])
  })
})
