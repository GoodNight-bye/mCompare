import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

export interface SideEntry {
  relPath: string
  type: 'file' | 'dir'
  size: number
  mtimeMs: number
}

export interface BufferResult {
  buf: Buffer
  truncated: boolean
  size: number
}

export async function readLocalHead(filePath: string, limit: number): Promise<BufferResult> {
  const st = await fsp.stat(filePath)
  if (!st.isFile()) throw new Error('不是文件: ' + filePath)
  const size = st.size
  const want = Math.min(size, limit)
  const fh = await fsp.open(filePath, 'r')
  try {
    const buf = Buffer.alloc(want)
    let off = 0
    while (off < want) {
      const { bytesRead } = await fh.read(buf, off, want - off, off)
      if (bytesRead <= 0) break
      off += bytesRead
    }
    return { buf: buf.subarray(0, off), truncated: size > limit, size }
  } finally {
    await fh.close()
  }
}

export async function writeLocalText(
  filePath: string,
  data: Buffer
): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2)}.mcompare.tmp`
  try {
    await fsp.writeFile(tmp, data)
    try {
      const original = await fsp.stat(filePath)
      await fsp.chmod(tmp, original.mode)
    } catch {
      /* new file */
    }
    await fsp.rename(tmp, filePath)
  } catch (error) {
    try {
      await fsp.unlink(tmp)
    } catch {
      /* ignore cleanup */
    }
    throw error
  }
}

export const MAX_SCAN_DEPTH = 48

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export type SkipPredicate = (relPath: string, name: string, isDir: boolean) => boolean

export interface WalkOptions {
  shouldCancel?: () => boolean
  isSkipped?: (relPath: string) => boolean
  onDirectory?: (relPath: string) => void
  onEntry?: (entry: SideEntry) => void
  onWarning?: (relPath: string, message: string) => void
}

export async function scanLocalSide(
  root: string,
  shouldSkip?: SkipPredicate,
  options?: WalkOptions
): Promise<Map<string, SideEntry>> {
  const st = await fsp.stat(root)
  if (!st.isDirectory()) throw new Error('不是文件夹: ' + root)

  const map = new Map<string, SideEntry>()

  async function walk(dir: string, rel: string, depth: number): Promise<void> {
    if (depth > MAX_SCAN_DEPTH) {
      options?.onWarning?.(
        rel,
        `目录层级超过 ${MAX_SCAN_DEPTH} 层，已停止继续递归`
      )
      return
    }
    if (options?.shouldCancel?.()) throw new Error('SCAN_CANCELLED')
    if (options?.isSkipped?.(rel)) return
    options?.onDirectory?.(rel)
    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch (err) {
      options?.onWarning?.(rel, `无法读取目录: ${errorText(err)}`)
      return
    }
    for (const ent of entries) {
      if (options?.shouldCancel?.()) throw new Error('SCAN_CANCELLED')
      if (options?.isSkipped?.(rel)) return
      const full = path.join(dir, ent.name)
      const childRel = rel ? `${rel}/${ent.name}` : ent.name
      let info: fs.Stats
      try {
        info = await fsp.lstat(full)
      } catch (err) {
        options?.onWarning?.(childRel, `无法读取条目: ${errorText(err)}`)
        continue
      }
      if (info.isSymbolicLink()) continue
      if (info.isDirectory()) {
        if (shouldSkip?.(childRel, ent.name, true)) continue
        const item: SideEntry = {
          relPath: childRel,
          type: 'dir',
          size: 0,
          mtimeMs: info.mtimeMs
        }
        map.set(childRel, item)
        options?.onEntry?.(item)
        await walk(full, childRel, depth + 1)
      } else if (info.isFile()) {
        if (shouldSkip?.(childRel, ent.name, false)) continue
        const item: SideEntry = {
          relPath: childRel,
          type: 'file',
          size: info.size,
          mtimeMs: info.mtimeMs
        }
        map.set(childRel, item)
        options?.onEntry?.(item)
      }
    }
  }

  await walk(root, '', 0)
  return map
}

export function hashLocalFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * Copy through a sibling temp file and rename, so an interrupted/failed copy
 * never leaves a half-written destination. The source mode is preserved.
 */
export async function copyLocalFile(src: string, dst: string): Promise<void> {
  await fsp.mkdir(path.dirname(dst), { recursive: true })
  const tmp = `${dst}.${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2)}.mcompare.tmp`
  try {
    await fsp.copyFile(src, tmp)
    try {
      const source = await fsp.stat(src)
      await fsp.chmod(tmp, source.mode)
    } catch {
      /* permission bits are best-effort (e.g. on Windows) */
    }
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
