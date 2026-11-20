import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppApi,
  BinaryData,
  CompareMode,
  ConfirmOptions,
  ConnectionInput,
  ConnectionView,
  FolderFilters,
  FolderScanResult,
  LaunchRequest,
  Location,
  ReadFileResult,
  RecentEntry,
  RecentInput,
  RemoteEntry,
  ScanProgressEvent
} from '../shared/types'

const api: AppApi = {
  getLaunchRequest: () => ipcRenderer.invoke('app:launch-request') as Promise<LaunchRequest>,
  onLaunch: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, req: LaunchRequest): void => cb(req)
    ipcRenderer.on('app:launch', listener)
    return () => ipcRenderer.removeListener('app:launch', listener)
  },
  rendererReady: () => {
    ipcRenderer.send('app:renderer-ready')
  },
  onCloseRequest: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('app:close-request', listener)
    return () => ipcRenderer.removeListener('app:close-request', listener)
  },
  closeWindow: () => {
    ipcRenderer.send('app:close-window')
  },
  openLocalFile: () => ipcRenderer.invoke('dialog:open-file') as Promise<string | null>,
  openLocalFolder: () => ipcRenderer.invoke('dialog:open-folder') as Promise<string | null>,
  readFile: (location: Location) =>
    ipcRenderer.invoke('file:read', location) as Promise<ReadFileResult>,
  readBinary: (location: Location, limit?: number) =>
    ipcRenderer.invoke('file:read-binary', location, limit) as Promise<BinaryData>,
  writeTextFile: (location: Location, text: string, encoding: string, bom: boolean) =>
    ipcRenderer.invoke('file:write-text', location, text, encoding, bom) as Promise<void>,
  scanFolders: (
    left: Location,
    right: Location,
    mode: CompareMode,
    filters: FolderFilters | undefined,
    scanId: string,
    skipPaths?: string[]
  ) =>
    ipcRenderer.invoke('folder:scan', left, right, mode, filters, scanId, skipPaths) as Promise<FolderScanResult>,
  cancelScan: (scanId: string) => {
    ipcRenderer.send('scan:cancel', scanId)
  },
  skipScanPath: (scanId: string, relPath: string) => {
    ipcRenderer.send('scan:skip', scanId, relPath)
  },
  onScanProgress: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ScanProgressEvent): void =>
      cb(progress)
    ipcRenderer.on('scan:progress', listener)
    return () => ipcRenderer.removeListener('scan:progress', listener)
  },
  copyText: (text: string) => {
    ipcRenderer.send('clipboard:write', text)
  },
  copyNode: (source: Location, relPath: string, target: Location) =>
    ipcRenderer.invoke('folder:copy', source, relPath, target) as Promise<void>,
  listRecent: () => ipcRenderer.invoke('recent:list') as Promise<RecentEntry[]>,
  addRecent: (input: RecentInput) =>
    ipcRenderer.invoke('recent:add', input) as Promise<RecentEntry[]>,
  clearRecent: () => ipcRenderer.invoke('recent:clear') as Promise<void>,
  remoteList: (connectionId: string, path: string) =>
    ipcRenderer.invoke('ssh:remote-list', connectionId, path) as Promise<RemoteEntry[]>,
  listConnections: () => ipcRenderer.invoke('ssh:list') as Promise<ConnectionView[]>,
  saveConnection: (input: ConnectionInput) =>
    ipcRenderer.invoke('ssh:save', input) as Promise<ConnectionView>,
  deleteConnection: (id: string) => ipcRenderer.invoke('ssh:delete', id) as Promise<void>,
  testConnection: (input: ConnectionInput) =>
    ipcRenderer.invoke('ssh:test', input) as Promise<void>,
  confirm: (opts: ConfirmOptions) =>
    ipcRenderer.invoke('dialog:confirm', opts) as Promise<boolean>,
  confirmThree: (opts: ConfirmOptions) =>
    ipcRenderer.invoke('dialog:confirm-three', opts) as Promise<'save' | 'discard' | 'cancel'>,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)
