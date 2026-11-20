import { describe, expect, it } from 'vitest'
import type { ScanProgressEntry } from '../../shared/types'
import {
  buildLiveTree,
  flattenLive,
  liveDirPaths,
  type LiveNode
} from './liveTreeModel'

function entry(
  relPath: string,
  type: 'file' | 'dir',
  size = 1
): ScanProgressEntry {
  return { relPath, type, size, mtimeMs: 0 }
}

function map(...entries: ScanProgressEntry[]): Map<string, ScanProgressEntry> {
  return new Map(entries.map((item) => [item.relPath, item]))
}

function names(node: LiveNode): string[] {
  return node.children.map((child) => child.relPath)
}

describe('buildLiveTree', () => {
  it('creates an empty root for empty maps', () => {
    const root = buildLiveTree(new Map(), new Map(), [])
    expect(root.children).toEqual([])
    expect(liveDirPaths(root)).toEqual(new Set())
  })

  it('merges both sides and creates implicit parent directories', () => {
    const left = map(
      entry('src/a.ts', 'file', 10),
      entry('src/deep/b.ts', 'file', 20),
      entry('readme.md', 'file', 5)
    )
    const right = map(entry('src/a.ts', 'file', 11), entry('src/deep/c.ts', 'file', 30))
    const root = buildLiveTree(left, right, [])

    expect(names(root)).toEqual(['src', 'readme.md'])
    const src = root.children[0]
    expect(src.type).toBe('dir')
    expect(names(src)).toEqual(['src/deep', 'src/a.ts'])
    expect(src.children[1].left?.size).toBe(10)
    expect(src.children[1].right?.size).toBe(11)
    expect(names(src.children[0])).toEqual(['src/deep/b.ts', 'src/deep/c.ts'])
  })

  it('sorts directories first and names numerically', () => {
    const left = map(
      entry('file10.txt', 'file'),
      entry('file2.txt', 'file'),
      entry('dir10/file.txt', 'file'),
      entry('dir2/file.txt', 'file')
    )
    const root = buildLiveTree(left, new Map(), [])
    expect(names(root)).toEqual(['dir2', 'dir10', 'file2.txt', 'file10.txt'])
  })

  it('upgrades a conflicting node to a directory', () => {
    const left = map(entry('same', 'file'), entry('other', 'file'))
    const right = map(entry('same', 'dir'), entry('same/child.txt', 'file'))
    const root = buildLiveTree(left, right, [])
    const same = root.children.find((child) => child.name === 'same')
    expect(same?.type).toBe('dir')
    expect(same?.children.map((child) => child.relPath)).toEqual(['same/child.txt'])
  })

  it('applies exact and subtree skip matching without sibling prefix collisions', () => {
    const left = map(
      entry('src/a.ts', 'file'),
      entry('pkg/src/b.ts', 'file'),
      entry('foobar.txt', 'file'),
      entry('foo/c.txt', 'file')
    )
    const root = buildLiveTree(left, new Map(), ['src', 'foo'])
    expect(names(root)).toEqual(['pkg', 'foobar.txt'])
    expect(names(root.children[0])).toEqual(['pkg/src'])
  })

  it('normalizes skip paths with backslashes', () => {
    const left = map(entry('dir/sub/a.ts', 'file'))
    const root = buildLiveTree(left, new Map(), ['dir\\sub'])
    expect(root.children).toEqual([])
  })

  it('does not mutate the input maps', () => {
    const left = map(entry('src/a.ts', 'file'))
    const right = map(entry('src/b.ts', 'file'))
    buildLiveTree(left, right, [])
    expect(left.size).toBe(1)
    expect(right.size).toBe(1)
  })
})

describe('live tree helpers', () => {
  it('collects directories only and flattens respect expanded state', () => {
    const left = map(
      entry('src/a.ts', 'file'),
      entry('src/deep/b.ts', 'file'),
      entry('docs/readme.md', 'file')
    )
    const root = buildLiveTree(left, new Map(), [])
    expect([...liveDirPaths(root)].sort()).toEqual(['docs', 'src', 'src/deep'])
    expect(flattenLive(root, new Set()).map((row) => row.node.relPath)).toEqual([
      'docs',
      'src'
    ])
    expect(
      flattenLive(root, new Set(['src'])).map((row) => row.node.relPath)
    ).toEqual(['docs', 'src', 'src/deep', 'src/a.ts'])
  })
})
