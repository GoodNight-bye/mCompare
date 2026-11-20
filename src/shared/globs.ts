export interface CompiledGlob {
  pattern: string
  regex: RegExp
  pathMode: boolean
}

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g

function escapeSegment(segment: string): string {
  return segment.replace(REGEX_SPECIAL, '\\$&')
}

/**
 * Glob semantics:
 * - `*`  matches any run of non-slash characters
 * - `?`  matches one non-slash character
 * - `**` as a path segment matches zero or more path segments
 *   (pattern `a` + `**` + `b` matches `a/b` and `a/x/b`, but not `a/xb`)
 * - patterns without `/` are matched against the basename at any depth
 */
export function globToRegExp(pattern: string): { regex: RegExp; pathMode: boolean } {
  const normalized = pattern.replace(/\\/g, '/')
  const pathMode = normalized.includes('/')
  const segments = normalized.split('/')
  let source = '^'

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    const isLast = index === segments.length - 1

    if (segment === '**') {
      if (isLast) {
        if (index === 0) {
          source += '.*'
        } else {
          source += '.*'
        }
      } else {
        source += '(?:[^/]+/)*'
      }
      continue
    }

    let piece = ''
    for (const char of segment) {
      if (char === '*') piece += '[^/]*'
      else if (char === '?') piece += '[^/]'
      else piece += escapeSegment(char)
    }
    source += piece

    if (!isLast) source += '/'
  }

  source += '$'
  return { regex: new RegExp(source, 'i'), pathMode }
}

export function normalizeGlobPatterns(values?: string[]): string[] {
  const out: string[] = []
  for (const value of values || []) {
    for (const part of value.split(/[\n,;]+/)) {
      let pattern = part.trim().replace(/\\/g, '/')
      while (pattern.startsWith('./')) pattern = pattern.slice(2)
      pattern = pattern.replace(/\/+$/, '')
      if (pattern) out.push(pattern)
    }
  }
  return [...new Set(out)]
}

export function compileGlobRules(patterns: string[]): CompiledGlob[] {
  return patterns.map((pattern) => {
    const { regex, pathMode } = globToRegExp(pattern)
    return { pattern, regex, pathMode }
  })
}

export function matchesGlob(
  rule: CompiledGlob,
  relPath: string,
  name: string
): boolean {
  return rule.regex.test(rule.pathMode ? relPath : name)
}

export function matchesAnyGlob(
  rules: CompiledGlob[],
  relPath: string,
  name: string
): boolean {
  return rules.some((rule) => matchesGlob(rule, relPath, name))
}

/**
 * Exclude masks ending in `/**` should also hide the directory itself,
 * in addition to everything below it.
 */
export function expandExcludePatterns(patterns: string[]): string[] {
  const expanded = [...patterns]
  for (const pattern of patterns) {
    if (pattern.endsWith('/**')) {
      const base = pattern.slice(0, -3)
      if (base) expanded.push(base)
    }
  }
  return [...new Set(expanded)]
}
