import path from 'node:path'

/**
 * Validate a path relative to a comparison root. Rejects traversal, absolute
 * paths, NUL/control characters and colon characters that would otherwise
 * escape or reinterpret the target path.
 */
export function sanitizeWorkspaceRelPath(value: unknown): string {
  if (typeof value !== 'string') throw new Error('路径必须是字符串')
  const slashed = value.trim().replace(/\\/g, '/')
  if (!slashed) throw new Error('路径不能为空')
  if (slashed.startsWith('/') || /^[A-Za-z]:\//.test(slashed)) {
    throw new Error('路径必须是相对路径')
  }
  if (slashed.includes('\0')) throw new Error('路径包含非法字符')

  const parts = slashed.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.length === 0) throw new Error('路径不能为空')
  for (const part of parts) {
    if (part === '..') throw new Error('路径包含非法片段')
    if (part.includes(':')) throw new Error('路径包含不支持的字符')
    if (/[\u0000-\u001f]/.test(part)) throw new Error('路径包含控制字符')
  }
  return parts.join('/')
}

export function resolveLocalWithin(root: string, relPath: string): string {
  const safe = sanitizeWorkspaceRelPath(relPath)
  const base = path.resolve(root)
  const full = path.resolve(base, ...safe.split('/'))
  const relative = path.relative(base, full)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('目标路径超出比较目录')
  }
  return full
}
