import type { FolderNode, FolderStatus } from '../../shared/types'
import { formatSize, formatTime } from './utils'

export interface FolderRow {
  node: FolderNode
  depth: number
}

export const STATUS_LABEL: Record<FolderStatus, string> = {
  same: '相同',
  different: '不同',
  leftOnly: '仅左侧',
  rightOnly: '仅右侧',
  typeMismatch: '类型不同'
}

export function isContentDiff(node: FolderNode): boolean {
  if (node.type === 'file') {
    return (
      node.status === 'different' ||
      node.status === 'leftOnly' ||
      node.status === 'rightOnly' ||
      node.status === 'typeMismatch'
    )
  }
  if (
    node.status === 'leftOnly' ||
    node.status === 'rightOnly' ||
    node.status === 'typeMismatch'
  ) {
    return true
  }
  return (node.children || []).some(isContentDiff)
}

export function flatten(
  root: FolderNode,
  expanded: Set<string>,
  diffOnly: boolean
): FolderRow[] {
  const rows: FolderRow[] = []
  const walk = (node: FolderNode, depth: number): void => {
    for (const child of node.children || []) {
      if (diffOnly && !isContentDiff(child)) continue
      rows.push({ node: child, depth })
      if (child.type === 'dir' && expanded.has(child.relPath)) walk(child, depth + 1)
    }
  }
  walk(root, 0)
  return rows
}

export function diffDirPaths(root: FolderNode): Set<string> {
  const set = new Set<string>()
  const walk = (node: FolderNode): void => {
    for (const child of node.children || []) {
      if (child.type === 'dir' && isContentDiff(child)) {
        set.add(child.relPath)
        walk(child)
      }
    }
  }
  walk(root)
  return set
}

export function allDirPaths(root: FolderNode): Set<string> {
  const set = new Set<string>()
  const walk = (node: FolderNode): void => {
    for (const child of node.children || []) {
      if (child.type === 'dir') {
        set.add(child.relPath)
        walk(child)
      }
    }
  }
  walk(root)
  return set
}

/**
 * Files eligible for "sync all": missing on the target, or present on both
 * sides with a content/type difference. Left-only/right-only directories are
 * represented by their file descendants.
 */
/** File/directory collisions cannot be resolved by copying alone. */
export function countTypeMismatch(root: FolderNode): number {
  let count = 0
  const walk = (node: FolderNode): void => {
    for (const child of node.children || []) {
      if (child.status === 'typeMismatch') count++
      else walk(child)
    }
  }
  walk(root)
  return count
}

export function collectSyncFiles(root: FolderNode, to: 'right' | 'left'): FolderNode[] {
  const files: FolderNode[] = []
  const walk = (node: FolderNode): void => {
    for (const child of node.children || []) {
      if (child.type === 'file') {
        const eligible =
          to === 'right'
            ? Boolean(child.left) && (!child.right || child.status === 'different')
            : Boolean(child.right) && (!child.left || child.status === 'different')
        if (eligible) files.push(child)
      } else {
        walk(child)
      }
    }
  }
  walk(root)
  return files
}

export function sideMeta(
  side: { size: number; mtimeMs: number } | undefined,
  isDir: boolean
): string {
  if (!side) return '—'
  if (isDir) return formatTime(side.mtimeMs)
  return `${formatSize(side.size)} · ${formatTime(side.mtimeMs)}`
}
