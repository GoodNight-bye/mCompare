import type { FolderFilters } from '../shared/types'
import {
  compileGlobRules,
  expandExcludePatterns,
  matchesAnyGlob,
  normalizeGlobPatterns,
  type CompiledGlob
} from '../shared/globs'

export interface CompiledFilters {
  include: CompiledGlob[]
  exclude: CompiledGlob[]
  hasInclude: boolean
  hasExclude: boolean
  isEmpty: boolean
  matchesInclude(relPath: string, name: string): boolean
  matchesExclude(relPath: string, name: string): boolean
}

export function compileFilters(filters?: FolderFilters): CompiledFilters {
  const includePatterns = normalizeGlobPatterns(filters?.include)
  const excludePatterns = expandExcludePatterns(
    normalizeGlobPatterns(filters?.exclude)
  )
  const include = compileGlobRules(includePatterns)
  const exclude = compileGlobRules(excludePatterns)
  return {
    include,
    exclude,
    hasInclude: includePatterns.length > 0,
    hasExclude: excludePatterns.length > 0,
    isEmpty: includePatterns.length === 0 && excludePatterns.length === 0,
    matchesInclude(relPath, name) {
      return matchesAnyGlob(include, relPath, name)
    },
    matchesExclude(relPath, name) {
      return matchesAnyGlob(exclude, relPath, name)
    }
  }
}
