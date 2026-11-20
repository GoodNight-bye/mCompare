import { describe, expect, it } from 'vitest'
import type { FolderNode, FolderStatus } from '../../shared/types'
import {
  STATUS_LABEL,
  allDirPaths,
  collectSyncFiles,
  countTypeMismatch,
  diffDirPaths,
  flatten,
  isContentDiff,
  sideMeta
} from './folderTree'

function file(
  name: string,
  relPath: string,
  status: FolderStatus,
  hasLeft = true,
  hasRight = true
): FolderNode {
  return {
    name,
    relPath,
    type: 'file',
    status,
    left: hasLeft ? { size: 10, mtimeMs: 1000 } : undefined,
    right: hasRight ? { size: 10, mtimeMs: 2000 } : undefined
  }
}

function dir(
  name: string,
  relPath: string,
  status: FolderStatus,
  children: FolderNode[],
  hasLeft = true,
  hasRight = true
): FolderNode {
  return {
    name,
    relPath,
    type: 'dir',
    status,
    left: hasLeft ? { size: 0, mtimeMs: 1000 } : undefined,
    right: hasRight ? { size: 0, mtimeMs: 2000 } : undefined,
    children
  }
}

const tree = (): FolderNode =>
  dir('', '', 'different', [
    dir('src', 'src', 'different', [
      file('same.ts', 'src/same.ts', 'same'),
      file('changed.ts', 'src/changed.ts', 'different'),
      dir('api', 'src/api', 'leftOnly', [
        file('left.ts', 'src/api/left.ts', 'leftOnly', true, false)
      ], true, false)
    ]),
    dir('docs', 'docs', 'same', [file('readme.md', 'docs/readme.md', 'same')]),
    file('left-only.txt', 'left-only.txt', 'leftOnly', true, false),
    file('right-only.txt', 'right-only.txt', 'rightOnly', false, true),
    {
      name: 'collision',
      relPath: 'collision',
      type: 'dir',
      status: 'typeMismatch',
      left: { size: 1, mtimeMs: 1 },
      right: { size: 0, mtimeMs: 2 }
    }
  ])

describe('folderTree helpers', () => {
  it('classifies content differences', () => {
    expect(isContentDiff(file('x', 'x', 'same'))).toBe(false)
    expect(isContentDiff(file('x', 'x', 'different'))).toBe(true)
    expect(isContentDiff(dir('d', 'd', 'same', [file('x', 'd/x', 'leftOnly')]))).toBe(true)
  })

  it('flattens all or only content differences', () => {
    const root = tree()
    expect(flatten(root, new Set(), false).map((row) => row.node.relPath)).toEqual([
      'src',
      'docs',
      'left-only.txt',
      'right-only.txt',
      'collision'
    ])
    expect(flatten(root, new Set(), true).map((row) => row.node.relPath)).toEqual([
      'src',
      'left-only.txt',
      'right-only.txt',
      'collision'
    ])
    const expanded = flatten(root, new Set(['src']), false).map((row) => row.node.relPath)
    expect(expanded).toContain('src/same.ts')
    expect(expanded.indexOf('src/same.ts')).toBeLessThan(expanded.indexOf('docs'))
  })

  it('collects difference and all directory paths', () => {
    const root = tree()
    expect([...diffDirPaths(root)].sort()).toEqual(['collision', 'src', 'src/api'])
    expect([...allDirPaths(root)].sort()).toEqual(['collision', 'docs', 'src', 'src/api'])
  })

  it('collects sync candidates in each direction', () => {
    const root = tree()
    expect(collectSyncFiles(root, 'right').map((node) => node.relPath)).toEqual([
      'src/changed.ts',
      'src/api/left.ts',
      'left-only.txt'
    ])
    expect(collectSyncFiles(root, 'left').map((node) => node.relPath)).toEqual([
      'src/changed.ts',
      'right-only.txt'
    ])
  })

  it('counts type mismatches that sync cannot resolve', () => {
    expect(countTypeMismatch(tree())).toBe(1)
    expect(countTypeMismatch(dir('', '', 'same', [file('x', 'x', 'same')]))).toBe(0)
  })

  it('has labels and metadata formatting', () => {
    expect(STATUS_LABEL.typeMismatch).toBe('类型不同')
    expect(sideMeta(undefined, false)).toBe('—')
    expect(sideMeta({ size: 2048, mtimeMs: 0 }, false)).toContain('2.0 KB')
    expect(sideMeta({ size: 0, mtimeMs: 0 }, true)).toBe('')
  })
})
