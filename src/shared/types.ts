export type Location =
  | { kind: 'local'; path: string }
  | { kind: 'remote'; connectionId: string; path: string }

export interface TextFileResult {
  kind: 'text'
  text: string
  encoding: string
  bom: boolean
  size: number
}

export interface BinaryFileResult {
  kind: 'binary'
  base64: string
  size: number
  truncated: boolean
}

export type ReadFileResult = TextFileResult | BinaryFileResult

export interface BinaryData {
  base64: string
  size: number
  truncated: boolean
}

export type FolderStatus = 'same' | 'different' | 'leftOnly' | 'rightOnly' | 'typeMismatch'

export interface FolderNode {
  name: string
  relPath: string
  type: 'file' | 'dir'
  status: FolderStatus
  left?: { size: number; mtimeMs: number }
  right?: { size: number; mtimeMs: number }
  children?: FolderNode[]
}

export interface FolderCounts {
  same: number
  different: number
  leftOnly: number
  rightOnly: number
}

export interface ScanWarning {
  side: 'left' | 'right'
  path: string
  message: string
}

export interface ScanProgressEntry {
  relPath: string
  type: 'file' | 'dir'
  size: number
  mtimeMs: number
}

export interface ScanProgressEvent {
  scanId: string
  side: 'left' | 'right'
  currentPath: string
  files: number
  dirs: number
  entries: ScanProgressEntry[]
  finished?: boolean
  compareDone?: number
  compareTotal?: number
}

export interface FolderFilters {
  include: string[]
  exclude: string[]
}

export type CompareMode = 'quick' | 'content'

export interface FolderScanResult {
  root: FolderNode
  counts: FolderCounts
  mode: CompareMode
  durationMs: number
  /** Paths that could not be fully scanned (permissions, depth limit, hash errors). */
  warnings: ScanWarning[]
}

export interface RemoteEntry {
  name: string
  path: string
  type: 'file' | 'dir'
  size: number
  mtimeMs: number
}

export interface ConnectionView {
  id: string
  name: string
  host: string
  port: number
  username: string
  hasPassword: boolean
}

export interface ConnectionInput {
  id?: string
  name: string
  host: string
  port: number
  username: string
  password?: string
}

export interface LaunchRequest {
  kind: 'file' | 'folder' | 'none'
  paths: string[]
}

export interface RecentEntry {
  id: string
  kind: 'file' | 'folder'
  left: Location
  right: Location
  addedAt: number
}

export interface RecentInput {
  kind: 'file' | 'folder'
  left: Location
  right: Location
}

export interface ConfirmOptions {
  title?: string
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export interface AppApi {
  getLaunchRequest(): Promise<LaunchRequest>
  onLaunch(cb: (req: LaunchRequest) => void): () => void
  rendererReady(): void
  onCloseRequest(cb: () => void): () => void
  closeWindow(): void
  openLocalFile(): Promise<string | null>
  openLocalFolder(): Promise<string | null>
  readFile(location: Location): Promise<ReadFileResult>
  readBinary(location: Location, limit?: number): Promise<BinaryData>
  writeTextFile(location: Location, text: string, encoding: string, bom: boolean): Promise<void>
  scanFolders(
    left: Location,
    right: Location,
    mode: CompareMode,
    filters: FolderFilters | undefined,
    scanId: string,
    skipPaths?: string[]
  ): Promise<FolderScanResult>
  cancelScan(scanId: string): void
  skipScanPath(scanId: string, relPath: string): void
  onScanProgress(cb: (event: ScanProgressEvent) => void): () => void
  copyText(text: string): void
  copyNode(source: Location, relPath: string, target: Location): Promise<void>
  remoteList(connectionId: string, path: string): Promise<RemoteEntry[]>
  listRecent(): Promise<RecentEntry[]>
  addRecent(input: RecentInput): Promise<RecentEntry[]>
  clearRecent(): Promise<void>
  listConnections(): Promise<ConnectionView[]>
  saveConnection(input: ConnectionInput): Promise<ConnectionView>
  deleteConnection(id: string): Promise<void>
  testConnection(input: ConnectionInput): Promise<void>
  confirm(opts: ConfirmOptions): Promise<boolean>
  confirmThree(opts: ConfirmOptions): Promise<'save' | 'discard' | 'cancel'>
  getPathForFile(file: File): string
  platform: string
}
