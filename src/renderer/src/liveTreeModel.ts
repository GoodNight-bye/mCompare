import { isSkippedByAny, normalizeSkipPaths } from '../../shared/pathUtils'
import type { ScanProgressEntry } from '../../shared/types'

export interface LiveNode {
  name: string
  relPath: string
  type: 'file' | 'dir'
  children: LiveNode[]
  left?: ScanProgressEntry
  right?: ScanProgressEntry
}

export function isSkippedPath(relPath: string, skipped: Iterable<string>): boolean {
  return isSkippedByAny(relPath, skipped)
}

export function buildLiveTree(
  left: Map<string, ScanProgressEntry>,
  right: Map<string, ScanProgressEntry>,
  skippedPaths: string[]
): LiveNode {
  const root: LiveNode = { name: '', relPath: '', type: 'dir', children: [] }
  const nodes = new Map<string, LiveNode>([['', root]])
  const skipped = new Set(normalizeSkipPaths(skippedPaths))

  const ensureNode = (relPath: string, type: 'file' | 'dir'): LiveNode => {
    const existing = nodes.get(relPath)
    if (existing) {
      if (type === 'dir') existing.type = 'dir'
      return existing
    }
    const parts = relPath.split('/')
    const name = parts[parts.length - 1]
    const parentRel = parts.slice(0, -1).join('/')
    const parent = parentRel ? ensureNode(parentRel, 'dir') : root
    const node: LiveNode = { name, relPath, type, children: [] }
    nodes.set(relPath, node)
    parent.children.push(node)
    return node
  }

  for (const entry of left.values()) {
    if (isSkippedPath(entry.relPath, skipped)) continue
    const node = ensureNode(entry.relPath, entry.type)
    node.left = entry
  }
  for (const entry of right.values()) {
    if (isSkippedPath(entry.relPath, skipped)) continue
    const node = ensureNode(entry.relPath, entry.type)
    node.right = entry
  }

  const sortNode = (node: LiveNode): void => {
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })
    for (const child of node.children) sortNode(child)
  }
  sortNode(root)
  return root
}

export function liveDirPaths(root: LiveNode): Set<string> {
  const out = new Set<string>()
  const walk = (node: LiveNode): void => {
    for (const child of node.children) {
      if (child.type === 'dir') {
        out.add(child.relPath)
        walk(child)
      }
    }
  }
  walk(root)
  return out
}

export function flattenLive(
  root: LiveNode,
  expanded: Set<string>
): Array<{ node: LiveNode; depth: number }> {
  const rows: Array<{ node: LiveNode; depth: number }> = []
  const walk = (node: LiveNode, depth: number): void => {
    for (const child of node.children) {
      rows.push({ node: child, depth })
      if (child.type === 'dir' && expanded.has(child.relPath)) walk(child, depth + 1)
    }
  }
  walk(root, 0)
  return rows
}
