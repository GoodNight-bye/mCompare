import { describe, expect, it } from 'vitest'
import type { FolderNode, FolderStatus } from '../../shared/types'
import { filterFolderTree, filtersWithinScan } from './treeFilter'

function side(): { size: number; mtimeMs: number } {
  return { size: 1, mtimeMs: 0 }
}

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
    left: hasLeft ? side() : undefined,
    right: hasRight ? side() : undefined
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
    left: hasLeft ? side() : undefined,
    right: hasRight ? side() : undefined,
    children
  }
}

const sample = (): FolderNode => ({
  name: '',
  relPath: '',
  type: 'dir',
  status: 'different',
  left: side(),
  right: side(),
  children: [
    dir('src', 'src', 'different', [
      file('a.ts', 'src/a.ts', 'same'),
      file('b.ts', 'src/b.ts', 'different'),
      dir('api', 'src/api', 'different', [
        file('c.ts', 'src/api/c.ts', 'leftOnly', true, false)
      ])
    ]),
    dir('docs', 'docs', 'same', [file('readme.md', 'docs/readme.md', 'same')]),
    dir('node_modules', 'node_modules', 'same', [
      file('dep.js', 'node_modules/dep.js', 'same')
    ]),
    dir('leftonly', 'leftonly', 'leftOnly', [
      file('x.ts', 'leftonly/x.ts', 'leftOnly', true, false)
    ], true, false),
    dir('rightonly', 'rightonly', 'rightOnly', [
      file('y.ts', 'rightonly/y.ts', 'rightOnly', false, true)
    ], false, true),
    file('image.png', 'image.png', 'different'),
    file('bad', 'bad', 'typeMismatch')
  ]
})

function names(root: FolderNode): string[] {
  const out: string[] = []
  const walk = (node: FolderNode): void => {
    for (const child of node.children || []) {
      out.push(child.relPath)
      walk(child)
    }
  }
  walk(root)
  return out
}

describe('filterFolderTree', () => {
  it('returns the full tree and accurate counts without filters', () => {
    const result = filterFolderTree(sample(), { include: [], exclude: [] })
    expect(names(result.root)).toContain('node_modules/dep.js')
    expect(result.counts).toEqual({
      same: 3,
      different: 3,
      leftOnly: 2,
      rightOnly: 1
    })
  })

  it('filters by basename include masks and keeps ancestors', () => {
    const result = filterFolderTree(sample(), { include: ['*.ts'], exclude: [] })
    expect(names(result.root)).toEqual([
      'src',
      'src/a.ts',
      'src/b.ts',
      'src/api',
      'src/api/c.ts',
      'leftonly',
      'leftonly/x.ts',
      'rightonly',
      'rightonly/y.ts'
    ])
    expect(result.counts).toEqual({
      same: 1,
      different: 1,
      leftOnly: 2,
      rightOnly: 1
    })
  })

  it('includes a whole subtree when a directory itself matches', () => {
    const result = filterFolderTree(sample(), { include: ['src'], exclude: [] })
    expect(names(result.root)).toEqual([
      'src',
      'src/a.ts',
      'src/b.ts',
      'src/api',
      'src/api/c.ts'
    ])
    expect(result.counts).toEqual({
      same: 1,
      different: 1,
      leftOnly: 1,
      rightOnly: 0
    })
  })

  it('excludes directories and prunes their subtrees', () => {
    const result = filterFolderTree(sample(), {
      include: [],
      exclude: ['node_modules', '**/api/**']
    })
    expect(names(result.root)).not.toContain('node_modules')
    expect(names(result.root)).not.toContain('src/api')
    expect(names(result.root)).not.toContain('src/api/c.ts')
    expect(result.counts).toEqual({
      same: 2,
      different: 3,
      leftOnly: 1,
      rightOnly: 1
    })
  })

  it('lets exclude masks win over include masks', () => {
    const result = filterFolderTree(sample(), {
      include: ['*.ts'],
      exclude: ['src/**']
    })
    expect(names(result.root)).not.toContain('src/a.ts')
    expect(names(result.root)).toContain('leftonly/x.ts')
    expect(result.counts.same).toBe(0)
  })

  it('recomputes directory status after children are filtered', () => {
    const root = dir('root', 'root', 'different', [
      dir('d', 'd', 'different', [
        file('keep.txt', 'd/keep.txt', 'same'),
        file('drop.log', 'd/drop.log', 'different')
      ])
    ])
    const result = filterFolderTree(
      { ...root, children: root.children },
      { include: ['*.txt'], exclude: [] }
    )
    expect(result.root.children?.[0].status).toBe('same')
    expect(result.counts).toEqual({ same: 1, different: 0, leftOnly: 0, rightOnly: 0 })
  })

  it('does not mutate the input tree', () => {
    const root = sample()
    filterFolderTree(root, { include: ['*.ts'], exclude: ['node_modules'] })
    expect(names(root)).toContain('node_modules/dep.js')
    expect(root.children?.length).toBe(7)
  })
})

describe('filtersWithinScan', () => {
  it('detects broadening and narrowing of exclude masks', () => {
    expect(
      filtersWithinScan(
        { include: [], exclude: ['node_modules'] },
        { include: [], exclude: ['node_modules'] }
      )
    ).toBe(true)
    expect(
      filtersWithinScan(
        { include: [], exclude: ['node_modules'] },
        { include: [], exclude: ['node_modules', 'dist'] }
      )
    ).toBe(true)
    expect(
      filtersWithinScan(
        { include: [], exclude: ['node_modules'] },
        { include: [], exclude: [] }
      )
    ).toBe(false)
  })

  it('detects broadening and narrowing of include masks', () => {
    expect(
      filtersWithinScan({ include: [], exclude: [] }, { include: ['*.ts'], exclude: [] })
    ).toBe(true)
    expect(
      filtersWithinScan({ include: ['*.ts'], exclude: [] }, { include: [], exclude: [] })
    ).toBe(false)
    expect(
      filtersWithinScan(
        { include: ['*.ts', '*.js'], exclude: [] },
        { include: ['*.ts'], exclude: [] }
      )
    ).toBe(true)
    expect(
      filtersWithinScan(
        { include: ['*.ts'], exclude: [] },
        { include: ['*.ts', '*.js'], exclude: [] }
      )
    ).toBe(false)
  })

  it('normalizes masks before comparing', () => {
    expect(
      filtersWithinScan(
        { include: ['./src/'], exclude: [] },
        { include: ['src'], exclude: [] }
      )
    ).toBe(true)
  })

  it('is conservative for nested include narrowing', () => {
    expect(
      filtersWithinScan(
        { include: ['src/**'], exclude: [] },
        { include: ['src/api/*.ts'], exclude: [] }
      )
    ).toBe(false)
  })
})

describe('exact skip paths', () => {
  const tree = (): FolderNode => ({
    name: '',
    relPath: '',
    type: 'dir',
    status: 'different',
    left: side(),
    right: side(),
    children: [
      dir('src', 'src', 'same', [file('a.ts', 'src/a.ts', 'same')]),
      dir('pkg', 'pkg', 'same', [
        dir('src', 'pkg/src', 'same', [file('b.ts', 'pkg/src/b.ts', 'same')])
      ]),
      file('foobar.txt', 'foobar.txt', 'same')
    ]
  })

  it('skips only the selected subtree, never a same-named nested directory', () => {
    const result = filterFolderTree(tree(), { include: [], exclude: [] }, ['src'])
    expect(names(result.root)).toEqual(['pkg', 'pkg/src', 'pkg/src/b.ts', 'foobar.txt'])
    expect(result.counts.same).toBe(2)
  })

  it('normalizes backslash skip paths', () => {
    const result = filterFolderTree(tree(), { include: [], exclude: [] }, ['pkg\\src'])
    expect(names(result.root)).toEqual(['src', 'src/a.ts', 'pkg', 'foobar.txt'])
  })

  it('computes the rescan hint from removed skips', () => {
    expect(filtersWithinScan({ include: [], exclude: [] }, { include: [], exclude: [] }, [], [])).toBe(true)
    expect(
      filtersWithinScan({ include: [], exclude: [] }, { include: [], exclude: [] }, [], ['src'])
    ).toBe(true)
    expect(
      filtersWithinScan({ include: [], exclude: [] }, { include: [], exclude: [] }, ['src'], ['src'])
    ).toBe(true)
    expect(
      filtersWithinScan({ include: [], exclude: [] }, { include: [], exclude: [] }, ['src'], [])
    ).toBe(false)
  })
})

describe('type mismatch counts', () => {
  it('counts a directory node with typeMismatch as a difference', () => {
    const root: FolderNode = {
      name: '',
      relPath: '',
      type: 'dir',
      status: 'different',
      left: side(),
      right: side(),
      children: [
        {
          name: 'collision',
          relPath: 'collision',
          type: 'dir',
          status: 'typeMismatch',
          left: side(),
          right: side()
        }
      ]
    }
    const result = filterFolderTree(root, { include: [], exclude: [] })
    expect(result.counts.different).toBe(1)
  })
})
