import type { FolderCounts, FolderFilters, FolderNode } from '../../shared/types'
import {
  compileGlobRules,
  expandExcludePatterns,
  matchesAnyGlob,
  normalizeGlobPatterns
} from '../../shared/globs'
import { isSkippedByAny, normalizeSkipPaths } from '../../shared/pathUtils'

export function expandMasks(values: string[]): string[] {
  return normalizeGlobPatterns(values)
}

function normalizeExclude(values: string[]): string[] {
  return expandExcludePatterns(normalizeGlobPatterns(values))
}

/**
 * True when `current` is at least as restrictive as `scanned` for every path,
 * meaning the already-scanned tree still contains all data needed by `current`.
 */
export function filtersWithinScan(
  scanned: FolderFilters,
  current: FolderFilters,
  scannedSkips: string[] = [],
  currentSkips: string[] = []
): boolean {
  const scannedExclude = normalizeExclude(scanned.exclude)
  const currentExclude = normalizeExclude(current.exclude)
  const excludesCovered = scannedExclude.every((pattern) =>
    currentExclude.includes(pattern)
  )
  if (!excludesCovered) return false

  const scannedInclude = normalizeGlobPatterns(scanned.include)
  const currentInclude = normalizeGlobPatterns(current.include)
  const includeCovered =
    scannedInclude.length === 0 ||
    (currentInclude.length > 0 &&
      currentInclude.every((pattern) => scannedInclude.includes(pattern)))
  if (!includeCovered) return false

  const scannedSkipSet = normalizeSkipPaths(scannedSkips)
  const currentSkipSet = normalizeSkipPaths(currentSkips)
  return scannedSkipSet.every((path) => currentSkipSet.includes(path))
}

export function filterFolderTree(
  root: FolderNode,
  filters: FolderFilters,
  skipPaths: string[] = []
): { root: FolderNode; counts: FolderCounts } {
  const includePatterns = normalizeGlobPatterns(filters.include)
  const excludePatterns = expandExcludePatterns(normalizeGlobPatterns(filters.exclude))
  const include = compileGlobRules(includePatterns)
  const exclude = compileGlobRules(excludePatterns)
  const active = include.length > 0 || exclude.length > 0
  const skipSet = new Set(normalizeSkipPaths(skipPaths))
  const counts: FolderCounts = { same: 0, different: 0, leftOnly: 0, rightOnly: 0 }

  const filterNode = (node: FolderNode, includedByPrefix: boolean): FolderNode | null => {
    const name = node.name
    if (isSkippedByAny(node.relPath, skipSet)) return null
    if (matchesAnyGlob(exclude, node.relPath, name)) return null

    if (node.type === 'file') {
      const included =
        includedByPrefix ||
        include.length === 0 ||
        matchesAnyGlob(include, node.relPath, name)
      if (!included) return null
      if (node.status === 'typeMismatch') counts.different++
      else if (
        node.status === 'same' ||
        node.status === 'different' ||
        node.status === 'leftOnly' ||
        node.status === 'rightOnly'
      ) {
        counts[node.status]++
      }
      return node
    }

    const selfIncluded = matchesAnyGlob(include, node.relPath, name)
    const childPrefix = includedByPrefix || selfIncluded
    const originalChildren = node.children || []
    const children: FolderNode[] = []
    for (const child of originalChildren) {
      const kept = filterNode(child, childPrefix)
      if (kept) children.push(kept)
    }

    if (active && children.length === 0 && !childPrefix) return null
    if (node.status === 'typeMismatch') counts.different++

    let status = node.status
    if (node.left && node.right && node.status !== 'typeMismatch') {
      status =
        children.length === 0 || children.every((child) => child.status === 'same')
          ? 'same'
          : 'different'
    } else if (
      node.status !== 'leftOnly' &&
      node.status !== 'rightOnly' &&
      node.status !== 'typeMismatch'
    ) {
      status = children.every((child) => child.status === 'same') ? 'same' : 'different'
    }

    return {
      ...node,
      type: 'dir',
      status,
      children: children.length > 0 ? children : undefined
    }
  }

  const children: FolderNode[] = []
  for (const child of root.children || []) {
    const kept = filterNode(child, false)
    if (kept) children.push(kept)
  }

  return {
    root: {
      ...root,
      type: 'dir',
      status:
        children.length === 0 || children.every((child) => child.status === 'same')
          ? 'same'
          : 'different',
      children: children.length > 0 ? children : undefined
    },
    counts
  }
}
