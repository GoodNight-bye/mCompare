import { describe, expect, it } from 'vitest'
import { compileFilters } from './filters'

describe('compileFilters', () => {
  it('reports empty state', () => {
    expect(compileFilters(undefined).isEmpty).toBe(true)
    expect(compileFilters({ include: [], exclude: [] }).isEmpty).toBe(true)
    expect(compileFilters({ include: ['  '], exclude: [] }).isEmpty).toBe(true)
    expect(compileFilters({ include: ['*.ts'], exclude: [] }).hasInclude).toBe(true)
    expect(compileFilters({ include: [], exclude: ['*.log'] }).hasExclude).toBe(true)
  })

  it('matches include masks by basename or path', () => {
    const filters = compileFilters({ include: ['*.ts', 'src/*.md'], exclude: [] })
    expect(filters.matchesInclude('deep/a.ts', 'a.ts')).toBe(true)
    expect(filters.matchesInclude('src/readme.md', 'readme.md')).toBe(true)
    expect(filters.matchesInclude('src/deep/readme.md', 'readme.md')).toBe(false)
    expect(filters.matchesInclude('deep/a.js', 'a.js')).toBe(false)
  })

  it('treats backslash masks as path masks after normalization', () => {
    const filters = compileFilters({ include: [], exclude: ['src\\*.log'] })
    expect(filters.matchesExclude('src/a.log', 'a.log')).toBe(true)
    expect(filters.matchesExclude('deep/src/a.log', 'a.log')).toBe(false)
  })

  it('also excludes the directory itself for trailing /** masks', () => {
    const filters = compileFilters({ include: [], exclude: ['**/node_modules/**'] })
    expect(filters.matchesExclude('node_modules', 'node_modules')).toBe(true)
    expect(filters.matchesExclude('a/node_modules', 'node_modules')).toBe(true)
    expect(filters.matchesExclude('a/node_modules/dep.js', 'dep.js')).toBe(true)
    expect(filters.matchesExclude('a/node_modules_extra/dep.js', 'dep.js')).toBe(false)
  })

  it('handles ** with proper segment boundaries', () => {
    const filters = compileFilters({ include: ['a/**/b', '**/*.ts'], exclude: [] })
    expect(filters.matchesInclude('a/b', 'b')).toBe(true)
    expect(filters.matchesInclude('a/x/b', 'b')).toBe(true)
    expect(filters.matchesInclude('a/xb', 'xb')).toBe(false)
    expect(filters.matchesInclude('src/deep/a.ts', 'a.ts')).toBe(true)
  })

  it('is case-insensitive and treats . and special characters literally', () => {
    const filters = compileFilters({
      include: ['*.TS', 'file[1].txt', 'a+b(c).md'],
      exclude: []
    })
    expect(filters.matchesInclude('A.TS', 'A.TS')).toBe(true)
    expect(filters.matchesInclude('file[1].txt', 'file[1].txt')).toBe(true)
    expect(filters.matchesInclude('file1.txt', 'file1.txt')).toBe(false)
    expect(filters.matchesInclude('a+b(c).md', 'a+b(c).md')).toBe(true)
  })

  it('does not let include masks change exclude behavior', () => {
    const filters = compileFilters({ include: ['*.ts'], exclude: ['test/**'] })
    expect(filters.matchesInclude('test/a.ts', 'a.ts')).toBe(true)
    expect(filters.matchesExclude('test/a.ts', 'a.ts')).toBe(true)
  })
})
