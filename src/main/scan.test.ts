import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FolderNode, Location } from '../shared/types'
import type { SshManager } from './ssh'
import { copyNode, scanFolders } from './scan'

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.from(''),
    decryptString: () => ''
  },
  dialog: { showMessageBoxSync: () => 1 }
}))

let root = ''
let leftDir = ''
let rightDir = ''
const ssh = {} as SshManager

const local = (p: string): Location => ({ kind: 'local', path: p })

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, 'utf8')
}

function find(tree: FolderNode, relPath: string): FolderNode | undefined {
  let found: FolderNode | undefined
  const walk = (node: FolderNode): void => {
    if (node.relPath === relPath) found = node
    node.children?.forEach(walk)
  }
  walk(tree)
  return found
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcompare-scan-'))
  leftDir = path.join(root, 'left')
  rightDir = path.join(root, 'right')
  fs.mkdirSync(leftDir, { recursive: true })
  fs.mkdirSync(rightDir, { recursive: true })
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('scanFolders (local)', () => {
  it('aligns files and directories and counts statuses', async () => {
    write(path.join(leftDir, 'same.txt'), 'same')
    write(path.join(rightDir, 'same.txt'), 'same')
    write(path.join(leftDir, 'changed.txt'), 'left-content')
    write(path.join(rightDir, 'changed.txt'), 'right')
    write(path.join(leftDir, 'left-only.txt'), 'left')
    write(path.join(rightDir, 'right-only.txt'), 'right')
    write(path.join(leftDir, 'sub', 'same.txt'), 'same')
    write(path.join(rightDir, 'sub', 'same.txt'), 'same')

    const result = await scanFolders(local(leftDir), local(rightDir), 'quick', ssh)
    expect(result.counts).toEqual({
      same: 2,
      different: 1,
      leftOnly: 1,
      rightOnly: 1
    })
    expect(find(result.root, 'changed.txt')?.status).toBe('different')
    expect(find(result.root, 'left-only.txt')?.status).toBe('leftOnly')
    expect(find(result.root, 'right-only.txt')?.status).toBe('rightOnly')
    expect(find(result.root, 'sub')?.status).toBe('same')
  })

  it('quick mode compares size only; content mode detects same-size differences', async () => {
    write(path.join(leftDir, 'a.txt'), 'AAAA')
    write(path.join(rightDir, 'a.txt'), 'BBBB')

    const quick = await scanFolders(local(leftDir), local(rightDir), 'quick', ssh)
    expect(find(quick.root, 'a.txt')?.status).toBe('same')

    const content = await scanFolders(local(leftDir), local(rightDir), 'content', ssh)
    expect(find(content.root, 'a.txt')?.status).toBe('different')
    expect(content.counts.different).toBe(1)
  })

  it('applies exclude masks during the scan', async () => {
    write(path.join(leftDir, 'keep.txt'), 'keep')
    write(path.join(rightDir, 'keep.txt'), 'keep')
    write(path.join(leftDir, 'drop.log'), 'log')
    write(path.join(rightDir, 'drop.log'), 'log')
    write(path.join(leftDir, 'sub', 'inner.txt'), 'inner')
    write(path.join(rightDir, 'sub', 'inner.txt'), 'inner')

    const result = await scanFolders(local(leftDir), local(rightDir), 'quick', ssh, {
      include: [],
      exclude: ['*.log', 'sub']
    })
    expect(find(result.root, 'drop.log')).toBeUndefined()
    expect(find(result.root, 'sub')).toBeUndefined()
    expect(result.counts.same).toBe(1)
  })

  it('treats a file/directory collision as one typeMismatch node', async () => {
    write(path.join(leftDir, 'collision'), 'file')
    write(path.join(rightDir, 'collision', 'child.txt'), 'child')

    const result = await scanFolders(local(leftDir), local(rightDir), 'quick', ssh)
    const collision = find(result.root, 'collision')
    expect(collision).toMatchObject({ type: 'dir', status: 'typeMismatch' })
    expect(collision?.children).toBeUndefined()
    expect(result.counts.different).toBe(1)
    expect(result.counts.rightOnly).toBe(0)
  })

  it('supports dynamic skip and cancellation callbacks', async () => {
    write(path.join(leftDir, 'alpha', 'a.txt'), 'a')
    write(path.join(rightDir, 'alpha', 'a.txt'), 'a')
    write(path.join(leftDir, 'beta', 'b.txt'), 'b')
    write(path.join(rightDir, 'beta', 'b.txt'), 'b')

    const entries: string[] = []
    const result = await scanFolders(local(leftDir), local(rightDir), 'quick', ssh, undefined, {
      isSkipped: (rel) => rel === 'alpha' || rel.startsWith('alpha/'),
      onEntry: (_side, entry) => entries.push(entry.relPath)
    })
    expect(find(result.root, 'alpha')).toBeUndefined()
    expect(entries.some((rel) => rel.startsWith('alpha'))).toBe(false)
    expect(find(result.root, 'beta')).toBeDefined()

    await expect(
      scanFolders(local(leftDir), local(rightDir), 'quick', ssh, undefined, {
        shouldCancel: () => true
      })
    ).rejects.toThrow('SCAN_CANCELLED')
  })

  it('drops files skipped while content hashing', async () => {
    write(path.join(leftDir, 'a.txt'), 'AAAA')
    write(path.join(rightDir, 'a.txt'), 'AAAA')
    write(path.join(leftDir, 'b.txt'), 'BBBB')
    write(path.join(rightDir, 'b.txt'), 'BBBB')

    let comparing = false
    const result = await scanFolders(local(leftDir), local(rightDir), 'content', ssh, undefined, {
      isSkipped: (rel) => comparing && rel === 'a.txt',
      onCompare: () => {
        comparing = true
      }
    })
    expect(find(result.root, 'a.txt')).toBeUndefined()
    expect(find(result.root, 'b.txt')?.status).toBe('same')
  })

  it('reports paths omitted by the depth limit instead of hiding them', async () => {
    write(path.join(leftDir, 'x.txt'), 'x')
    write(path.join(rightDir, 'x.txt'), 'x')
    let dir = leftDir
    for (let i = 0; i < 55; i++) dir = path.join(dir, `d${i}`)
    fs.mkdirSync(dir, { recursive: true })

    const result = await scanFolders(local(leftDir), local(rightDir), 'quick', ssh)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toMatchObject({ side: 'left' })
    expect(result.warnings[0].message).toContain('层级')
  })

  it('accepts escaped include masks consistently with the renderer', async () => {
    write(path.join(leftDir, 'src', 'a.ts'), 'a')
    write(path.join(rightDir, 'src', 'a.ts'), 'a')
    write(path.join(leftDir, 'src', 'a.js'), 'b')
    write(path.join(rightDir, 'src', 'a.js'), 'b')

    const result = await scanFolders(local(leftDir), local(rightDir), 'quick', ssh, {
      include: ['src/**/*.ts'],
      exclude: []
    })
    expect(find(result.root, 'src/a.ts')).toBeDefined()
    expect(find(result.root, 'src/a.js')).toBeUndefined()
    expect(result.counts.same).toBe(1)
  })
})

describe('copyNode (local to local)', () => {
  it('copies files and directories', async () => {
    write(path.join(leftDir, 'file.txt'), 'hello')
    write(path.join(leftDir, 'dir', 'nested.txt'), 'nested')

    await copyNode(local(leftDir), 'file.txt', local(rightDir), ssh)
    expect(fs.readFileSync(path.join(rightDir, 'file.txt'), 'utf8')).toBe('hello')

    await copyNode(local(leftDir), 'dir', local(rightDir), ssh)
    expect(fs.readFileSync(path.join(rightDir, 'dir', 'nested.txt'), 'utf8')).toBe(
      'nested'
    )
  })

  it('rejects traversal outside the roots', async () => {
    write(path.join(leftDir, 'file.txt'), 'hello')
    await expect(
      copyNode(local(leftDir), '../escape.txt', local(rightDir), ssh)
    ).rejects.toThrow()
    await expect(
      copyNode(local(leftDir), '/etc/passwd', local(rightDir), ssh)
    ).rejects.toThrow()
    await expect(
      copyNode(local(leftDir), 'C:/Windows/win.ini', local(rightDir), ssh)
    ).rejects.toThrow()
  })
})
