import { describe, expect, it } from 'vitest'
import {
  compileGlobRules,
  expandExcludePatterns,
  globToRegExp,
  matchesAnyGlob,
  normalizeGlobPatterns
} from './globs'

describe('normalizeGlobPatterns', () => {
  it('splits, trims, dedupes and normalizes separators', () => {
    expect(
      normalizeGlobPatterns([' ./src/ , *.ts;build\\**\n*.ts ', ''])
    ).toEqual(['src', '*.ts', 'build/**'])
  })

  it('handles undefined and whitespace-only values', () => {
    expect(normalizeGlobPatterns(undefined)).toEqual([])
    expect(normalizeGlobPatterns(['  ', ',,,;;;\n'])).toEqual([])
  })
})

describe('globToRegExp', () => {
  const match = (pattern: string, relPath: string, name: string): boolean =>
    matchesAnyGlob(compileGlobRules([pattern]), relPath, name)

  it('treats patterns without slash as basename matchers', () => {
    expect(match('*.ts', 'src/deep/a.ts', 'a.ts')).toBe(true)
    expect(match('*.ts', 'src/a.js', 'a.js')).toBe(false)
    expect(match('a?c.txt', 'x/abc.txt', 'abc.txt')).toBe(true)
    expect(match('a?c.txt', 'x/ac.txt', 'ac.txt')).toBe(false)
  })

  it('treats backslash patterns as path patterns after normalization', () => {
    const compiled = globToRegExp('src\\*.ts')
    expect(compiled.pathMode).toBe(true)
    expect(match('src\\*.ts', 'src/a.ts', 'a.ts')).toBe(true)
    expect(match('src\\*.ts', 'deep/src/a.ts', 'a.ts')).toBe(false)
  })

  it('handles * and ** segment boundaries correctly', () => {
    expect(match('src/*.ts', 'src/a.ts', 'a.ts')).toBe(true)
    expect(match('src/*.ts', 'src/deep/a.ts', 'a.ts')).toBe(false)

    expect(match('a/**/b', 'a/b', 'b')).toBe(true)
    expect(match('a/**/b', 'a/x/b', 'b')).toBe(true)
    expect(match('a/**/b', 'a/x/y/b', 'b')).toBe(true)
    expect(match('a/**/b', 'a/xb', 'xb')).toBe(false)
    expect(match('a/**/b', 'ab', 'ab')).toBe(false)

    expect(match('**/*.ts', 'a.ts', 'a.ts')).toBe(true)
    expect(match('**/*.ts', 'src/deep/a.ts', 'a.ts')).toBe(true)
  })

  it('matches directories below a trailing ** but not the directory itself', () => {
    expect(match('src/**', 'src/a.ts', 'a.ts')).toBe(true)
    expect(match('src/**', 'src/deep/a.ts', 'a.ts')).toBe(true)
    expect(match('src/**', 'src', 'src')).toBe(false)
  })

  it('is case-insensitive and escapes regex characters', () => {
    expect(match('*.TS', 'A.TS', 'A.TS')).toBe(true)
    expect(match('file[1].ts', 'file[1].ts', 'file[1].ts')).toBe(true)
    expect(match('file[1].ts', 'file1.ts', 'file1.ts')).toBe(false)
    expect(match('a+b(c).txt', 'a+b(c).txt', 'a+b(c).txt')).toBe(true)
  })
})

describe('expandExcludePatterns', () => {
  it('adds the base directory rule for trailing /** masks', () => {
    const expanded = expandExcludePatterns(['**/node_modules/**', 'src/**', '*.log'])
    expect(expanded).toContain('**/node_modules')
    expect(expanded).toContain('src')
    expect(expanded).toContain('*.log')
  })

  it('does not duplicate an existing base mask', () => {
    expect(expandExcludePatterns(['src', 'src/**'])).toEqual(['src', 'src/**'])
  })
})
