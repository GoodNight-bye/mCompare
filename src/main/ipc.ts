import { BrowserWindow, clipboard, dialog, ipcMain } from 'electron'
import type {
  BinaryData,
  CompareMode,
  ConnectionInput,
  ConfirmOptions,
  FolderFilters,
  LaunchRequest,
  Location,
  ReadFileResult,
  RecentInput,
  ScanProgressEntry
} from '../shared/types'
import { normalizeSkipPaths } from '../shared/pathUtils'
import { decodeBuffer, encodeTextChecked } from './encoding'
import { readLocalHead, writeLocalText } from './local'
import { SshManager } from './ssh'
import { RecentStore } from './recent'
import { copyNode, scanFolders, type ScanCallbacks } from './scan'

const MAX_TEXT_BYTES = 32 * 1024 * 1024
const MAX_BINARY_BYTES = 4 * 1024 * 1024

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label}无效`)
  }
  return value
}

function requireLocation(value: unknown): Location {
  if (!value || typeof value !== 'object') throw new Error('位置参数无效')
  const location = value as Record<string, unknown>
  if (location.kind === 'local') {
    return { kind: 'local', path: requireString(location.path, '本地路径') }
  }
  if (location.kind === 'remote') {
    return {
      kind: 'remote',
      connectionId: requireString(location.connectionId, 'SSH 连接'),
      path: requireString(location.path, '远端路径')
    }
  }
  throw new Error('位置类型无效')
}

interface IpcDeps {
  ssh: SshManager
  recent: RecentStore
  getWindow: () => BrowserWindow | null
  getLaunchRequest: () => LaunchRequest
}

async function readHead(location: Location, limit: number, ssh: SshManager) {
  if (location.kind === 'local') return readLocalHead(location.path, limit)
  return ssh.readRemoteHead(location.connectionId, location.path, limit)
}

export function registerIpc({ ssh, recent, getWindow, getLaunchRequest }: IpcDeps): void {
  const activeScans = new Map<string, { cancelled: boolean; skips: Set<string> }>()

  ipcMain.handle('app:launch-request', () => getLaunchRequest())

  ipcMain.handle('dialog:open-file', async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: '选择要比较的文件',
      properties: ['openFile']
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:open-folder', async () => {
    const win = getWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: '选择要比较的文件夹',
      properties: ['openDirectory']
    })
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:confirm', async (_event, options: ConfirmOptions) => {
    const win = getWindow()
    const result = await dialog.showMessageBox(win!, {
      type: options.danger ? 'warning' : 'question',
      title: options.title || 'mCompare',
      message: options.message,
      detail: options.detail,
      buttons: [options.confirmLabel || '确定', options.cancelLabel || '取消'],
      defaultId: options.danger ? 1 : 0,
      cancelId: 1,
      noLink: true
    })
    return result.response === 0
  })

  ipcMain.handle('dialog:confirm-three', async (_event, options: ConfirmOptions) => {
    const win = getWindow()
    const result = await dialog.showMessageBox(win!, {
      type: 'warning',
      title: options.title || 'mCompare',
      message: options.message,
      detail: options.detail,
      buttons: ['保存', '放弃修改', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    })
    if (result.response === 0) return 'save'
    if (result.response === 1) return 'discard'
    return 'cancel'
  })

  ipcMain.handle('file:read', async (_event, rawLocation: unknown): Promise<ReadFileResult> => {
    const location = requireLocation(rawLocation)
    const head = await readHead(location, MAX_TEXT_BYTES, ssh)
    const decoded = decodeBuffer(head.buf)
    if (decoded.binary) {
      const clipped = head.buf.subarray(0, MAX_BINARY_BYTES)
      return {
        kind: 'binary',
        base64: clipped.toString('base64'),
        size: head.size,
        truncated: head.size > MAX_BINARY_BYTES
      }
    }
    if (head.truncated) {
      throw new Error('文件超过 32MB，无法作为文本打开；可切换到十六进制查看前 4MB')
    }
    return {
      kind: 'text',
      text: decoded.text,
      encoding: decoded.encoding,
      bom: decoded.bom,
      size: head.size
    }
  })

  ipcMain.handle(
    'file:read-binary',
    async (_event, rawLocation: unknown, limit?: unknown): Promise<BinaryData> => {
      const location = requireLocation(rawLocation)
      const requested = typeof limit === 'number' ? limit : MAX_BINARY_BYTES
      const want = Math.max(1, Math.min(requested || MAX_BINARY_BYTES, 64 * 1024 * 1024))
      const head = await readHead(location, want, ssh)
      return {
        base64: head.buf.toString('base64'),
        size: head.size,
        truncated: head.size > head.buf.length
      }
    }
  )

  ipcMain.handle(
    'file:write-text',
    async (
      _event,
      rawLocation: unknown,
      text: unknown,
      encoding: unknown,
      bom: unknown
    ): Promise<void> => {
      const location = requireLocation(rawLocation)
      if (typeof text !== 'string') throw new Error('文本内容无效')
      const data = encodeTextChecked(
        text,
        requireString(encoding, '编码'),
        Boolean(bom)
      )
      if (location.kind === 'local') {
        await writeLocalText(location.path, data)
      } else {
        await ssh.writeRemoteText(location.connectionId, location.path, data)
      }
    }
  )

  ipcMain.on('scan:cancel', (_event, scanId: unknown) => {
    if (typeof scanId !== 'string') return
    const active = activeScans.get(scanId)
    if (active) active.cancelled = true
  })

  ipcMain.on('scan:skip', (_event, scanId: string, relPath: string) => {
    const active = activeScans.get(scanId)
    if (active && relPath) active.skips.add(relPath.replace(/^\/+|\/+$/g, ''))
  })

  ipcMain.on('clipboard:write', (_event, text: string) => {
    if (typeof text === 'string' && text.length > 0) clipboard.writeText(text)
  })

  ipcMain.handle(
    'folder:scan',
    async (
      _event,
      rawLeft: unknown,
      rawRight: unknown,
      mode: CompareMode,
      filters: FolderFilters | undefined,
      scanId: string,
      skipPaths?: string[]
    ) => {
      const left = requireLocation(rawLeft)
      const right = requireLocation(rawRight)
      const id = scanId || `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const control = {
        cancelled: false,
        skips: new Set(normalizeSkipPaths(skipPaths))
      }
      activeScans.set(id, control)
      const win = getWindow()
      const buffers: Record<'left' | 'right', ScanProgressEntry[]> = { left: [], right: [] }
      const current: Record<'left' | 'right', string> = { left: '', right: '' }
      const finished: Record<'left' | 'right', boolean> = { left: false, right: false }
      const counts = {
        left: { files: 0, dirs: 0 },
        right: { files: 0, dirs: 0 }
      }
      let compareDone = 0
      let compareTotal = 0
      let timer: NodeJS.Timeout | null = null

      const isSkipped = (relPath: string): boolean => {
        for (const prefix of control.skips) {
          if (relPath === prefix || relPath.startsWith(prefix + "/")) return true
        }
        return false
      }

      const flush = (): void => {
        if (timer) {
          clearTimeout(timer)
          timer = null
        }
        if (!win || win.isDestroyed()) return
        for (const side of ['left', 'right'] as const) {
          const pending = buffers[side]
          // The live UI only shows a recent window; avoid flooding IPC on huge trees.
          const entries = pending.filter((entry) => !isSkipped(entry.relPath))
          buffers[side] = []
          if (
            entries.length === 0 &&
            !current[side] &&
            !finished[side] &&
            compareTotal === 0
          ) {
            continue
          }
          win.webContents.send('scan:progress', {
            scanId: id,
            side,
            currentPath: current[side],
            files: counts[side].files,
            dirs: counts[side].dirs,
            entries,
            finished: finished[side],
            compareDone,
            compareTotal
          })
        }
      }

      const schedule = (): void => {
        if (timer) return
        timer = setTimeout(flush, 120)
      }

      const callbacks: ScanCallbacks = {
        shouldCancel: () => control.cancelled,
        isSkipped,
        onDirectory: (side, relPath) => {
          current[side] = relPath
          schedule()
        },
        onEntry: (side, entry) => {
          if (entry.type === 'dir') counts[side].dirs++
          else counts[side].files++
          buffers[side].push({
            relPath: entry.relPath,
            type: entry.type,
            size: entry.size,
            mtimeMs: entry.mtimeMs
          })
          schedule()
        },
        onSideDone: (side) => {
          finished[side] = true
          flush()
        },
        onCompare: (done, total) => {
          compareDone = done
          compareTotal = total
          schedule()
        }
      }

      try {
        return await scanFolders(
          left,
          right,
          mode === 'content' ? 'content' : 'quick',
          ssh,
          filters,
          callbacks
        )
      } finally {
        flush()
        activeScans.delete(id)
      }
    }
  )

  ipcMain.handle(
    'folder:copy',
    async (_event, source: Location, relPath: string, target: Location) => {
      await copyNode(source, relPath, target, ssh)
    }
  )

  ipcMain.handle('recent:list', () => recent.list())
  ipcMain.handle('recent:add', (_event, input: RecentInput) => recent.add(input))
  ipcMain.handle('recent:clear', () => recent.clear())

  ipcMain.handle('ssh:list', () => ssh.list())
  ipcMain.handle('ssh:save', (_event, input: ConnectionInput) => ssh.save(input))
  ipcMain.handle('ssh:delete', async (_event, id: string) => ssh.remove(id))
  ipcMain.handle('ssh:test', async (_event, input: ConnectionInput) => ssh.test(input))
  ipcMain.handle('ssh:remote-list', async (_event, id: unknown, dir: unknown) =>
    ssh.remoteList(requireString(id, '连接'), requireString(dir, '目录'))
  )
}
