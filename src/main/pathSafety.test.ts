import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { resolveLocalWithin, sanitizeWorkspaceRelPath } from './pathSafety'

describe('sanitizeWorkspaceRelPath', () => {
  it('normalizes separators and leading/trailing slashes', () => {
    expect(sanitizeWorkspaceRelPath('src\\api/a.ts')).toBe('src/api/a.ts')
    expect(sanitizeWorkspaceRelPath('src/a.ts/')).toBe('src/a.ts')
    expect(sanitizeWorkspaceRelPath('src/./a.ts')).toBe('src/a.ts')
  })

  it('rejects traversal, absolute paths, drives, NUL and control characters', () => {
    for (const value of [
      '',
      '/etc/passwd',
      '..',
      '../secret',
      'a/../../secret',
      'C:/Windows/win.ini',
      'a:b',
      'a\u0000b',
      'a\u0001b',
      './'
    ]) {
      expect(() => sanitizeWorkspaceRelPath(value)).toThrow()
    }
    expect(() => sanitizeWorkspaceRelPath(42 as unknown as string)).toThrow()
  })
})

describe('resolveLocalWithin', () => {
  const root = path.resolve('C:/workspace/root')

  it('resolves paths inside the root', () => {
    expect(resolveLocalWithin(root, 'src/a.ts')).toBe(path.join(root, 'src', 'a.ts'))
    expect(resolveLocalWithin(root, 'src\\a.ts')).toBe(path.join(root, 'src', 'a.ts'))
  })

  it('rejects attempts to escape the root', () => {
    expect(() => resolveLocalWithin(root, '..\\outside.txt')).toThrow()
    expect(() => resolveLocalWithin(root, 'a/../../outside.txt')).toThrow()
    expect(() => resolveLocalWithin(root, '/outside.txt')).toThrow()
  })
})
