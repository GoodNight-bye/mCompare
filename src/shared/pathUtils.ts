export function normalizeRelativePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

export function normalizeSkipPaths(values?: string[]): string[] {
  const out: string[] = []
  for (const value of values || []) {
    const normalized = normalizeRelativePath(value)
    if (normalized) out.push(normalized)
  }
  return [...new Set(out)]
}

export function isPathWithin(relPath: string, prefix: string): boolean {
  return relPath === prefix || relPath.startsWith(prefix + '/')
}

export function isSkippedByAny(relPath: string, prefixes: Iterable<string>): boolean {
  for (const prefix of prefixes) {
    if (isPathWithin(relPath, prefix)) return true
  }
  return false
}
