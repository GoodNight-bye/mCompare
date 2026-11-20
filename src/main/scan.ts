import fsp from 'node:fs/promises'
import path from 'node:path'
import type {
  CompareMode,
  FolderCounts,
  FolderFilters,
  FolderNode,
  FolderScanResult,
  FolderStatus,
  Location,
  ScanWarning
} from '../shared/types'
import { compileFilters, type CompiledFilters } from './filters'
import { copyLocalFile, hashLocalFile, scanLocalSide, type SideEntry } from './local'
import { resolveLocalWithin, sanitizeWorkspaceRelPath } from './pathSafety'
import { SshManager } from './ssh'

interface MNode {
  name: string
  relPath: string
  left?: SideEntry
  right?: SideEntry
  status: FolderStatus
  children: Map<string, MNode>
}

function rjoin(base: string, rel: string): string {
  if (!rel) return base
  const b = base.replace(/\/+$/, '')
  const r = rel.replace(/^\/+/, '')
  return (b === '' ? '/' : b + '/') + r
}

export interface ScanCallbacks {
  shouldCancel?: () => boolean
  isSkipped?: (relPath: string) => boolean
  onDirectory?: (side: 'left' | 'right', relPath: string) => void
  onEntry?: (side: 'left' | 'right', entry: SideEntry) => void
  onSideDone?: (side: 'left' | 'right') => void
  onCompare?: (done: number, total: number) => void
  onWarning?: (warning: ScanWarning) => void
}

async function scanSide(
  side: 'left' | 'right',
  loc: Location,
  ssh: SshManager,
  shouldSkip?: (relPath: string, name: string, isDir: boolean) => boolean,
  callbacks?: ScanCallbacks
): Promise<Map<string, SideEntry>> {
  const options = callbacks
    ? {
        shouldCancel: callbacks.shouldCancel,
        isSkipped: callbacks.isSkipped,
        onDirectory: (relPath: string) => callbacks.onDirectory?.(side, relPath),
        onEntry: (entry: SideEntry) => callbacks.onEntry?.(side, entry),
        onWarning: (path: string, message: string) =>
          callbacks.onWarning?.({ side, path, message })
      }
    : undefined
  const entrySkip =
    shouldSkip || callbacks?.isSkipped
      ? (relPath: string, name: string, isDir: boolean): boolean =>
          Boolean(shouldSkip?.(relPath, name, isDir) || callbacks?.isSkipped?.(relPath))
      : undefined
  if (loc.kind === 'local') return scanLocalSide(loc.path, entrySkip, options)
  return ssh.scanRemoteSide(loc.connectionId, loc.path, entrySkip, options)
}

function pruneSkipped(
  map: Map<string, SideEntry>,
  isSkipped?: (relPath: string) => boolean
): Map<string, SideEntry> {
  if (!isSkipped) return map
  const out = new Map<string, SideEntry>()
  for (const [key, entry] of map) {
    if (!isSkipped(entry.relPath)) out.set(key, entry)
  }
  return out
}

function filterIncludeMap(
  map: Map<string, SideEntry>,
  compiled: CompiledFilters
): Map<string, SideEntry> {
  if (!compiled.hasInclude) return map

  const dirPrefixes: string[] = []
  for (const entry of map.values()) {
    if (entry.type !== 'dir') continue
    const name = entry.relPath.split('/').pop() || entry.relPath
    if (compiled.matchesInclude(entry.relPath, name)) dirPrefixes.push(entry.relPath + '/')
  }

  const keptFiles = new Set<string>()
  for (const entry of map.values()) {
    if (entry.type !== 'file') continue
    const name = entry.relPath.split('/').pop() || entry.relPath
    if (
      compiled.matchesInclude(entry.relPath, name) ||
      dirPrefixes.some((prefix) => entry.relPath.startsWith(prefix))
    ) {
      keptFiles.add(entry.relPath)
    }
  }

  const keep = new Set<string>(keptFiles)
  const keepAncestors = (relPath: string): void => {
    const parts = relPath.split('/')
    let acc = ''
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i]
      keep.add(acc)
    }
  }
  for (const file of keptFiles) keepAncestors(file)
  for (const prefix of dirPrefixes) {
    const dir = prefix.slice(0, -1)
    keep.add(dir)
    keepAncestors(dir)
  }

  const out = new Map<string, SideEntry>()
  for (const [key, value] of map) {
    if (keep.has(key)) out.set(key, value)
  }
  return out
}

function ensureNode(root: MNode, relPath: string): MNode {
  if (!relPath) return root
  const parts = relPath.split('/')
  let cur = root
  let acc = ''
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    acc = acc ? `${acc}/${part}` : part
    let child = cur.children.get(part)
    if (!child) {
      child = {
        name: part,
        relPath: acc,
        status: 'same',
        children: new Map()
      }
      cur.children.set(part, child)
    }
    cur = child
  }
  return cur
}

function nodeType(node: MNode): 'file' | 'dir' {
  const l = node.left?.type
  const r = node.right?.type
  if (l === 'dir' || r === 'dir') return 'dir'
  return 'file'
}

function localPathFor(root: string, rel: string): string {
  return resolveLocalWithin(root, rel)
}

async function runLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0
  const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    for (;;) {
      const current = index++
      if (current >= items.length) return
      await fn(items[current])
    }
  })
  await Promise.all(workers)
}

async function hashFile(loc: Location, rel: string, ssh: SshManager): Promise<string> {
  if (loc.kind === 'local') return hashLocalFile(localPathFor(loc.path, rel))
  return ssh.hashRemoteFile(loc.connectionId, rjoin(loc.path, rel))
}

export async function scanFolders(
  left: Location,
  right: Location,
  mode: CompareMode,
  ssh: SshManager,
  filters?: FolderFilters,
  callbacks?: ScanCallbacks
): Promise<FolderScanResult> {
  const started = Date.now()
  const compiled = compileFilters(filters)
  const shouldSkip = compiled.hasExclude
    ? (relPath: string, name: string): boolean => compiled.matchesExclude(relPath, name)
    : undefined
  const warnings: ScanWarning[] = []
  const reportWarning = (warning: ScanWarning): void => {
    // Permission errors and depth limits are surfaced instead of silently
    // omitting entries, which would otherwise look like one-sided files.
    warnings.push(warning)
    callbacks?.onWarning?.(warning)
  }
  const scanCallbacks: ScanCallbacks = {
    ...callbacks,
    onWarning: reportWarning
  }

  let leftMap: Map<string, SideEntry>
  let rightMap: Map<string, SideEntry>
  try {
    leftMap = await scanSide('left', left, ssh, shouldSkip, scanCallbacks)
  } catch (err) {
    if (err instanceof Error && err.message === 'SCAN_CANCELLED') throw err
    throw new Error('左侧读取失败: ' + (err instanceof Error ? err.message : String(err)))
  }
  callbacks?.onSideDone?.('left')
  try {
    rightMap = await scanSide('right', right, ssh, shouldSkip, scanCallbacks)
  } catch (err) {
    if (err instanceof Error && err.message === 'SCAN_CANCELLED') throw err
    throw new Error('右侧读取失败: ' + (err instanceof Error ? err.message : String(err)))
  }
  callbacks?.onSideDone?.('right')

  leftMap = pruneSkipped(leftMap, callbacks?.isSkipped)
  rightMap = pruneSkipped(rightMap, callbacks?.isSkipped)

  if (compiled.hasInclude) {
    leftMap = filterIncludeMap(leftMap, compiled)
    rightMap = filterIncludeMap(rightMap, compiled)
  }
  if (callbacks?.shouldCancel?.()) throw new Error('SCAN_CANCELLED')

  const root: MNode = { name: '', relPath: '', status: 'same', children: new Map() }
  for (const entry of leftMap.values()) {
    const node = ensureNode(root, entry.relPath)
    node.left = entry
  }
  for (const entry of rightMap.values()) {
    const node = ensureNode(root, entry.relPath)
    node.right = entry
  }

  const allNodes: MNode[] = []
  const visit = (node: MNode): void => {
    allNodes.push(node)
    for (const child of node.children.values()) visit(child)
  }
  visit(root)

  const hashCache = new Map<string, Promise<string>>()
  const hashOf = async (loc: Location, rel: string): Promise<string> => {
    const key =
      loc.kind === 'local'
        ? `local:${loc.path}:${rel}`
        : `remote:${loc.connectionId}:${loc.path}:${rel}`
    let pending = hashCache.get(key)
    if (!pending) {
      pending = hashFile(loc, rel, ssh)
      hashCache.set(key, pending)
    }
    return pending
  }

  const compares: MNode[] = []
  for (const node of allNodes) {
    if (node === root) continue
    const l = node.left
    const r = node.right
    if (!l && r) {
      node.status = 'rightOnly'
      continue
    }
    if (l && !r) {
      node.status = 'leftOnly'
      continue
    }
    if (!l || !r) continue
    if (l.type !== r.type) {
      node.status = 'typeMismatch'
      continue
    }
    if (l.type === 'dir') {
      node.status = 'different'
      continue
    }
    if (l.size !== r.size) {
      node.status = 'different'
      continue
    }
    if (mode === 'quick') {
      // Quick mode only looks at file size. Timestamps are intentionally
      // ignored; use "content" mode when same-size content matters.
      node.status = 'same'
      continue
    }
    node.status = 'same'
    compares.push(node)
  }

  if (compares.length > 0) callbacks?.onCompare?.(0, compares.length)
  let compared = 0
  await runLimited(compares, 4, async (node) => {
    if (callbacks?.shouldCancel?.()) throw new Error('SCAN_CANCELLED')
    if (callbacks?.isSkipped?.(node.relPath)) {
      compared++
      callbacks?.onCompare?.(compared, compares.length)
      return
    }
    const [lh, rh] = await Promise.allSettled([
      hashOf(left, node.relPath),
      hashOf(right, node.relPath)
    ])
    if (lh.status === 'fulfilled' && rh.status === 'fulfilled') {
      node.status = lh.value === rh.value ? 'same' : 'different'
    } else {
      // A failed hash is conservatively reported as different, and the
      // warning makes the uncertainty explicit.
      node.status = 'different'
      for (const [side, result] of [
        ['left', lh],
        ['right', rh]
      ] as const) {
        if (result.status === 'rejected') {
          reportWarning({
            side,
            path: node.relPath,
            message: `无法读取内容进行哈希比较: ${
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason)
            }`
          })
        }
      }
    }
    compared++
    callbacks?.onCompare?.(compared, compares.length)
  })

  const finalize = (node: MNode): FolderNode => {
    if (node !== root && node.left && node.right && node.left.type !== node.right.type) {
      return {
        name: node.name,
        relPath: node.relPath,
        type: 'dir',
        status: 'typeMismatch',
        left: { size: node.left.size, mtimeMs: node.left.mtimeMs },
        right: { size: node.right.size, mtimeMs: node.right.mtimeMs }
      }
    }

    const children: FolderNode[] = []
    const sorted = Array.from(node.children.values()).sort((a, b) => {
      const at = nodeType(a)
      const bt = nodeType(b)
      if (at !== bt) return at === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })
    for (const child of sorted) {
      // A skip can arrive while content hashes are still running; drop those
      // nodes from the final tree too.
      if (callbacks?.isSkipped?.(child.relPath)) continue
      children.push(finalize(child))
    }

    const aggregate = (): FolderStatus =>
      children.every((child) => child.status === 'same') ? 'same' : 'different'

    let status: FolderStatus = node.status
    if (node === root) {
      status = aggregate()
    } else if (!node.left && node.right) {
      status = 'rightOnly'
    } else if (node.left && !node.right) {
      status = 'leftOnly'
    } else if (nodeType(node) === 'dir') {
      status = aggregate()
    }

    return {
      name: node.name,
      relPath: node.relPath,
      type: node === root ? 'dir' : nodeType(node),
      status,
      left: node.left ? { size: node.left.size, mtimeMs: node.left.mtimeMs } : undefined,
      right: node.right ? { size: node.right.size, mtimeMs: node.right.mtimeMs } : undefined,
      children: children.length > 0 ? children : undefined
    }
  }

  const finalRoot = finalize(root)
  const counts: FolderCounts = {
    same: 0,
    different: 0,
    leftOnly: 0,
    rightOnly: 0
  }
  const countNode = (node: FolderNode): void => {
    if (node.status === 'typeMismatch') {
      counts.different++
    } else if (node.type === 'file') {
      if (
        node.status === 'same' ||
        node.status === 'different' ||
        node.status === 'leftOnly' ||
        node.status === 'rightOnly'
      ) {
        counts[node.status]++
      }
    }
    node.children?.forEach(countNode)
  }
  countNode(finalRoot)

  return {
    root: finalRoot,
    counts,
    mode,
    durationMs: Date.now() - started,
    warnings
  }
}

interface TransferItem {
  rel: string
  type: 'file' | 'dir'
}

async function collectSource(
  loc: Location,
  relPath: string,
  ssh: SshManager
): Promise<TransferItem[]> {
  if (loc.kind === 'local') {
    const abs = localPathFor(loc.path, relPath)
    const st = await fsp.stat(abs)
    const items: TransferItem[] = []
    const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
      if (depth > 48) return
      const entries = await fsp.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        const childRel = `${rel}/${entry.name}`
        const info = await fsp.lstat(full)
        if (info.isSymbolicLink()) continue
        if (info.isDirectory()) {
          items.push({ rel: childRel, type: 'dir' })
          await walk(full, childRel, depth + 1)
        } else if (info.isFile()) {
          items.push({ rel: childRel, type: 'file' })
        }
      }
    }
    if (st.isDirectory()) {
      items.push({ rel: relPath, type: 'dir' })
      await walk(abs, relPath, 0)
    } else {
      items.push({ rel: relPath, type: 'file' })
    }
    return items
  }

  const items: TransferItem[] = []
  const stat = await ssh.remoteStat(loc.connectionId, rjoin(loc.path, relPath))
  if (stat.type === 'file') return [{ rel: relPath, type: 'file' }]
  items.push({ rel: relPath, type: 'dir' })
  const walk = async (dirRel: string, depth: number): Promise<void> => {
    if (depth > 48) return
    const entries = await ssh.remoteList(loc.connectionId, rjoin(loc.path, dirRel))
    for (const entry of entries) {
      const childRel = `${dirRel}/${entry.name}`
      items.push({ rel: childRel, type: entry.type })
      if (entry.type === 'dir') await walk(childRel, depth + 1)
    }
  }
  await walk(relPath, 0)
  return items
}

export async function copyNode(
  source: Location,
  relPath: string,
  target: Location,
  ssh: SshManager
): Promise<void> {
  if (source.kind === target.kind && source.path === target.path) {
    throw new Error('源位置和目标位置相同')
  }
  const safeRelPath = sanitizeWorkspaceRelPath(relPath)
  const items = await collectSource(source, safeRelPath, ssh)
  items.sort((a, b) => {
    const da = a.rel.split('/').length
    const db = b.rel.split('/').length
    return da - db
  })

  const targetAbs = (rel: string): string => {
    const safeRel = sanitizeWorkspaceRelPath(rel)
    if (target.kind === 'local') return resolveLocalWithin(target.path, safeRel)
    return rjoin(target.path, safeRel)
  }

  for (const item of items) {
    if (item.type === 'dir') {
      if (target.kind === 'local') {
        await fsp.mkdir(targetAbs(item.rel), { recursive: true })
      } else {
        await ssh.ensureRemoteDir(target.connectionId, targetAbs(item.rel))
      }
    }
  }

  for (const item of items) {
    if (item.type !== 'file') continue
    const dst = targetAbs(item.rel)
    if (target.kind === 'local') {
      if (source.kind === 'local') {
        await copyLocalFile(localPathFor(source.path, item.rel), dst)
      } else {
        await fsp.mkdir(path.dirname(dst), { recursive: true })
        const tmp = `${dst}.${process.pid}.${Date.now()}.${Math.random()
          .toString(36)
          .slice(2)}.mcompare.tmp`
        try {
          await ssh.downloadFile(
            source.connectionId,
            rjoin(source.path, item.rel),
            tmp
          )
          await fsp.rename(tmp, dst)
        } catch (error) {
          try {
            await fsp.unlink(tmp)
          } catch {
            /* ignore cleanup */
          }
          throw error
        }
      }
    } else if (source.kind === 'remote') {
      const temp = await ssh.tempPath(item.rel.split('/').pop() || 'file')
      try {
        await ssh.downloadFile(source.connectionId, rjoin(source.path, item.rel), temp)
        await ssh.uploadFile(target.connectionId, temp, dst)
      } finally {
        try {
          await fsp.unlink(temp)
          await fsp.rmdir(path.dirname(temp))
        } catch {
          /* ignore temp cleanup */
        }
      }
    } else {
      await ssh.uploadFile(target.connectionId, localPathFor(source.path, item.rel), dst)
    }
  }
}

