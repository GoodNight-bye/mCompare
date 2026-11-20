import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type MouseEvent as ReactMouseEvent
} from 'react'
import type {
  ConnectionView,
  FolderFilters,
  FolderNode,
  FolderScanResult,
  Location,
  ScanProgressEntry
} from '../../../shared/types'
import { isSkippedByAny, normalizeRelativePath } from '../../../shared/pathUtils'
import type { FolderTabModel, Notify } from '../tabs'
import { useSetting } from '../settings'
import {
  allDirPaths,
  collectSyncFiles,
  countTypeMismatch,
  diffDirPaths,
  flatten
} from '../folderTree'
import { filterFolderTree, filtersWithinScan } from '../treeFilter'
import {
  basename,
  errText,
  joinLocationPath,
  locKey,
  splitMasks
} from '../utils'
import ContextMenu, { type MenuEntry } from './ContextMenu'
import { buildLiveTree, liveDirPaths, type LiveNode } from '../liveTreeModel'
import FolderFilterBar from './FolderFilterBar'
import FolderToolbar, { type SyncState } from './FolderToolbar'
import FolderTree from './FolderTree'
import LiveTree from './LiveTree'
import LocationBar from './LocationBar'
import PickSideModal from './PickSideModal'
import ScanProgressPanel, { type ScanProgressState } from './ScanProgressPanel'

interface Props {
  tab: FolderTabModel
  active: boolean
  connections: ConnectionView[]
  onChange: (patch: Partial<FolderTabModel>) => void
  onOpenFile: (left: Location, right: Location, relPath: string) => void
  onManageConnections: () => void
  onRemember: (left: Location, right: Location) => void
  notify: Notify
}

export default function FolderCompareTab({
  tab,
  active,
  connections,
  onChange,
  onOpenFile,
  onManageConnections,
  onRemember,
  notify
}: Props): JSX.Element {
  const [scan, setScan] = useState<FolderScanResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useSetting<'quick' | 'content'>('folder.mode', 'quick')
  const [viewMode, setViewMode] = useSetting<'all' | 'diff'>('folder.viewMode', 'all')
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [pickerSide, setPickerSide] = useState<'left' | 'right' | null>(null)
  const [syncState, setSyncState] = useState<SyncState | null>(null)
  const [opBusy, setOpBusy] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [storedFilters, setFilters] = useSetting<FolderFilters>('folder.filters', {
    include: [],
    exclude: []
  })
  const filters = useMemo<FolderFilters>(() => ({
    include: Array.isArray(storedFilters?.include) ? storedFilters.include : [],
    exclude: Array.isArray(storedFilters?.exclude) ? storedFilters.exclude : []
  }), [storedFilters])
  const [includeText, setIncludeText] = useState(() => filters.include.join(', '))
  const [excludeText, setExcludeText] = useState(() => filters.exclude.join(', '))
  const [scanFilters, setScanFilters] = useState<FolderFilters>(filters)
  const [scanSkips, setScanSkips] = useState<string[]>([])
  const [skippedPaths, setSkippedPaths] = useState<string[]>([])
  const [progress, setProgress] = useState<ScanProgressState | null>(null)
  const [liveTree, setLiveTree] = useState<LiveNode | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null)
  const liveMapsRef = useRef<{ left: Map<string, ScanProgressEntry>; right: Map<string, ScanProgressEntry> }>({
    left: new Map(),
    right: new Map()
  })
  const liveTimerRef = useRef<number | null>(null)
  const activeScanIdRef = useRef<string | null>(null)
  const skippedPathsRef = useRef<string[]>([])
  skippedPathsRef.current = skippedPaths
  const rememberRef = useRef(onRemember)
  rememberRef.current = onRemember
  const tabRef = useRef(tab)
  tabRef.current = tab
  const operationLockRef = useRef(false)
  const lastScanSidesRef = useRef('')

  const scheduleLiveTree = (): void => {
    if (liveTimerRef.current !== null) return
    liveTimerRef.current = window.setTimeout(() => {
      liveTimerRef.current = null
      setLiveTree(
        buildLiveTree(
          liveMapsRef.current.left,
          liveMapsRef.current.right,
          skippedPathsRef.current
        )
      )
    }, 300)
  }

  const clearLiveTimer = (): void => {
    if (liveTimerRef.current !== null) {
      window.clearTimeout(liveTimerRef.current)
      liveTimerRef.current = null
    }
  }
  const busy = scanning || Boolean(opBusy) || Boolean(syncState?.running)

  const leftKey = locKey(tab.left)
  const rightKey = locKey(tab.right)
  const filtersActive =
    filters.include.length > 0 || filters.exclude.length > 0 || skippedPaths.length > 0

  useEffect(() => {
    if (!tab.left || !tab.right) {
      setScan(null)
      setProgress(null)
      setError('')
      setScanning(false)
      return
    }
    const sidesKey = `${leftKey}|${rightKey}`
    const sidesChanged = lastScanSidesRef.current !== sidesKey
    if (sidesChanged) {
      lastScanSidesRef.current = sidesKey
      setScan(null)
      setExpanded(new Set())
      skippedPathsRef.current = []
      setSkippedPaths([])
    }
    const skipsForScan = sidesChanged ? [] : skippedPathsRef.current
    const showLiveTree = !scan || sidesChanged
    clearLiveTimer()
    liveMapsRef.current = { left: new Map(), right: new Map() }
    setLiveTree(null)
    let cancelled = false
    let settled = false
    const scanId =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setScanning(true)
    setError('')
    activeScanIdRef.current = scanId
    setScanFilters(filters)
    setScanSkips(skipsForScan)
    setProgress({
      scanId,
      left: { currentPath: '', files: 0, dirs: 0, finished: false },
      right: { currentPath: '', files: 0, dirs: 0, finished: false },
      compareDone: 0,
      compareTotal: 0
    })

    const unsubscribe = window.api.onScanProgress((event) => {
      if (cancelled || settled || event.scanId !== scanId) return
      if (showLiveTree) {
        const map = liveMapsRef.current[event.side]
        for (const entry of event.entries) map.set(entry.relPath, entry)
        if (event.entries.length > 0) scheduleLiveTree()
      }
      setProgress((prev) => {
        if (!prev || prev.scanId !== scanId) return prev
        const updateSide = (side: 'left' | 'right'): ScanProgressState['left'] => ({
          currentPath: event.currentPath || prev[side].currentPath,
          files: event.files,
          dirs: event.dirs,
          finished: Boolean(event.finished) || prev[side].finished
        })
        return {
          ...prev,
          left: event.side === 'left' ? updateSide('left') : prev.left,
          right: event.side === 'right' ? updateSide('right') : prev.right,
          compareDone: event.compareDone ?? prev.compareDone,
          compareTotal: event.compareTotal ?? prev.compareTotal
        }
      })
    })

    window.api
      .scanFolders(tab.left, tab.right, mode, filters, scanId, skipsForScan)
      .then((result) => {
        if (cancelled) return
        settled = true
        if (activeScanIdRef.current === scanId) activeScanIdRef.current = null
        clearLiveTimer()
        liveMapsRef.current = { left: new Map(), right: new Map() }
        setLiveTree(null)
        setScan(result)
        setSelected(null)
        setScanning(false)
        setProgress(null)
        rememberRef.current(tab.left!, tab.right!)
      })
      .catch((err) => {
        if (cancelled) return
        const message = errText(err)
        if (message.includes('SCAN_CANCELLED')) return
        settled = true
        if (activeScanIdRef.current === scanId) activeScanIdRef.current = null
        setError(message)
        setScan(null)
        clearLiveTimer()
        setLiveTree(null)
        setScanning(false)
        setProgress(null)
      })
    return () => {
      cancelled = true
      if (activeScanIdRef.current === scanId) activeScanIdRef.current = null
      clearLiveTimer()
      unsubscribe()
      if (!settled) window.api.cancelScan(scanId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftKey, rightKey, mode, refreshNonce])

  const filtered = useMemo(
    () => (scan ? filterFolderTree(scan.root, filters, skippedPaths) : null),
    [scan, filters, skippedPaths]
  )
  const filterHint =
    (Boolean(scan) || scanning) &&
    !filtersWithinScan(scanFilters, filters, scanSkips, skippedPaths)

  const rows = useMemo(
    () => (filtered ? flatten(filtered.root, expanded, viewMode === 'diff') : []),
    [filtered, expanded, viewMode]
  )

  const syncCounts = useMemo(() => {
    if (!filtered) return { toRight: 0, toLeft: 0 }
    return {
      toRight: collectSyncFiles(filtered.root, 'right').length,
      toLeft: collectSyncFiles(filtered.root, 'left').length
    }
  }, [filtered])

  useEffect(() => {
    if (!active) return
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'F5') {
        event.preventDefault()
        setRefreshNonce((value) => value + 1)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active])

  const toggleDir = (relPath: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(relPath)) next.delete(relPath)
      else next.add(relPath)
      return next
    })
  }

  const applySide = (side: 'left' | 'right', location: Location): boolean => {
    onChange(side === 'left' ? { left: location } : { right: location })
    setPickerSide(null)
    return true
  }

  const refresh = (): void => setRefreshNonce((value) => value + 1)

  const applyFilters = (): void => {
    setFilters({ include: splitMasks(includeText), exclude: splitMasks(excludeText) })
  }

  const clearFilters = (): void => {
    setIncludeText('')
    setExcludeText('')
    setFilters({ include: [], exclude: [] })
  }

  const changeView = (next: 'all' | 'diff'): void => {
    setViewMode(next)
    if (next === 'diff' && filtered) {
      setExpanded((prev) => {
        const merged = new Set(prev)
        for (const relPath of diffDirPaths(filtered.root)) merged.add(relPath)
        return merged
      })
    }
  }

  const copyText = (text: string): void => {
    if (!text) return
    window.api.copyText(text)
    notify('已复制到剪贴板', 'success')
  }

  const skipPath = (rawRelPath: string): void => {
    const relPath = normalizeRelativePath(rawRelPath)
    if (!relPath) return
    const already = skippedPathsRef.current.includes(relPath)
    const nextSkipped = already
      ? skippedPathsRef.current
      : [...skippedPathsRef.current, relPath]
    skippedPathsRef.current = nextSkipped
    setSkippedPaths(nextSkipped)

    const scanId = activeScanIdRef.current
    if (scanId) {
      window.api.skipScanPath(scanId, relPath)
      setScanSkips((prev) =>
        prev.includes(relPath) ? prev : [...prev, relPath]
      )
      for (const side of ['left', 'right'] as const) {
        const map = liveMapsRef.current[side]
        for (const path of [...map.keys()]) {
          if (isSkippedByAny(path, [relPath])) map.delete(path)
        }
      }
      setLiveTree(
        buildLiveTree(
          liveMapsRef.current.left,
          liveMapsRef.current.right,
          nextSkipped
        )
      )
      notify(`已跳过 ${relPath}，当前扫描继续`, 'success')
    } else if (!already) {
      notify(`已跳过 ${relPath}（本次对比不再显示）`, 'success')
    } else {
      notify('该路径已被跳过', 'info')
    }
  }

  const applySkips = (next: string[]): void => {
    skippedPathsRef.current = next
    setSkippedPaths(next)
    setLiveTree(
      buildLiveTree(liveMapsRef.current.left, liveMapsRef.current.right, next)
    )
  }

  const clearSkips = (): void => {
    applySkips([])
  }

  const removeSkip = (relPath: string): void => {
    applySkips(skippedPathsRef.current.filter((item) => item !== relPath))
  }

  const openRowMenu = (event: ReactMouseEvent, node: FolderNode): void => {
    event.preventDefault()
    setSelected(node.relPath)
    const isDir = node.type === 'dir'
    const items: MenuEntry[] = []
    if (!isDir && node.left && node.right) {
      items.push({ type: 'item', label: '对比', onClick: () => openRow(node) })
    }
    if (node.left) {
      items.push({
        type: 'item',
        label: '复制到右侧',
        disabled: busy,
        onClick: () => void copyRow('right', node)
      })
    }
    if (node.right) {
      items.push({
        type: 'item',
        label: '复制到左侧',
        disabled: busy,
        onClick: () => void copyRow('left', node)
      })
    }
    if (items.length > 0) items.push({ type: 'separator' })
    items.push({
      type: 'item',
      label: isDir ? '跳过此目录（当前对比）' : '跳过此文件（当前对比）',
      danger: true,
      onClick: () => skipPath(node.relPath)
    })
    items.push({ type: 'separator' })
    items.push({ type: 'item', label: '复制文件名', onClick: () => copyText(node.name) })
    items.push({
      type: 'item',
      label: '复制相对路径',
      shortcut: '用于过滤器',
      onClick: () => copyText(node.relPath)
    })
    if (node.left && tab.left) {
      items.push({
        type: 'item',
        label: '复制左侧完整路径',
        onClick: () => copyText(joinLocationPath(tab.left!, node.relPath))
      })
    }
    if (node.right && tab.right) {
      items.push({
        type: 'item',
        label: '复制右侧完整路径',
        onClick: () => copyText(joinLocationPath(tab.right!, node.relPath))
      })
    }
    items.push({ type: 'separator' })
    items.push({ type: 'item', label: '重新扫描', onClick: refresh })
    setMenu({ x: event.clientX, y: event.clientY, items })
  }

  const openLiveNodeMenu = (event: ReactMouseEvent, node: LiveNode): void => {
    event.preventDefault()
    const isDir = node.type === 'dir'
    const items: MenuEntry[] = [
      {
        type: 'item',
        label: isDir ? '跳过此目录（停止扫描）' : '跳过此文件（停止扫描）',
        danger: true,
        onClick: () => skipPath(node.relPath)
      },
      { type: 'separator' },
      { type: 'item', label: '复制文件名', onClick: () => copyText(node.name) },
      { type: 'item', label: '复制相对路径', onClick: () => copyText(node.relPath) }
    ]
    if (node.left && tab.left) {
      items.push({
        type: 'item',
        label: '复制左侧完整路径',
        onClick: () => copyText(joinLocationPath(tab.left!, node.relPath))
      })
    }
    if (node.right && tab.right) {
      items.push({
        type: 'item',
        label: '复制右侧完整路径',
        onClick: () => copyText(joinLocationPath(tab.right!, node.relPath))
      })
    }
    setMenu({ x: event.clientX, y: event.clientY, items })
  }

  const openRow = (node: FolderNode): void => {
    if (node.type === 'dir') {
      toggleDir(node.relPath)
      return
    }
    if (!tab.left || !tab.right) return
    if (node.left && node.right) {
      onOpenFile(tab.left, tab.right, node.relPath)
    } else {
      notify(
        node.left ? '该文件只存在于左侧，先复制到右侧再比较' : '该文件只存在于右侧，先复制到左侧再比较',
        'info'
      )
    }
  }

  const copyRow = async (to: 'right' | 'left', node: FolderNode): Promise<void> => {
    const current = tabRef.current
    if (
      !current.left ||
      !current.right ||
      operationLockRef.current ||
      activeScanIdRef.current ||
      opBusy ||
      syncState?.running
    ) {
      return
    }
    const source = to === 'right' ? current.left : current.right
    const target = to === 'right' ? current.right : current.left
    if (to === 'right' ? !node.left : !node.right) return
    const targetExists = to === 'right' ? Boolean(node.right) : Boolean(node.left)
    operationLockRef.current = true
    setOpBusy(node.relPath)
    try {
      const ok = await window.api.confirm({
        title: '复制',
        message: `将${node.type === 'dir' ? '目录' : '文件'}「${node.name}」复制到${to === 'right' ? '右侧' : '左侧'}？`,
        detail: targetExists ? '目标侧已存在，将被覆盖。' : undefined,
        confirmLabel: '复制',
        danger: true
      })
      if (!ok) return
      await window.api.copyNode(source, node.relPath, target)
      notify(`已复制「${node.name}」到${to === 'right' ? '右侧' : '左侧'}`, 'success')
      refresh()
    } catch (err) {
      notify('复制失败: ' + errText(err), 'error')
    } finally {
      operationLockRef.current = false
      setOpBusy(null)
    }
  }

  const syncAll = async (to: 'right' | 'left'): Promise<void> => {
    const current = tabRef.current
    if (
      !filtered ||
      !current.left ||
      !current.right ||
      operationLockRef.current ||
      activeScanIdRef.current ||
      syncState?.running
    ) {
      return
    }
    const files = collectSyncFiles(filtered.root, to)
    if (files.length === 0) {
      notify('没有需要同步的文件', 'info')
      return
    }
    const mismatches = countTypeMismatch(filtered.root)
    const label = `同步到${to === 'right' ? '右侧' : '左侧'}`
    operationLockRef.current = true
    try {
      const ok = await window.api.confirm({
        title: '同步文件夹',
        message: `将 ${files.length} 个差异文件同步到${to === 'right' ? '右侧' : '左侧'}？`,
        detail:
          '仅复制缺失或有内容差异的文件；目标侧同名文件会被覆盖。' +
          (mismatches > 0
            ? `\n\n另有 ${mismatches} 个文件/目录类型冲突的条目不会自动同步，请手动处理。`
            : '') +
          (mode === 'quick'
            ? '\n\n注意：当前为快速模式，只按大小判断，同大小但内容不同的文件会被视为一致；如需确保内容一致，请先切换到“内容”模式。'
            : ''),
        confirmLabel: '开始同步',
        danger: true
      })
      if (!ok) return
      const source = to === 'right' ? current.left : current.right
      const target = to === 'right' ? current.right : current.left
      let failures = 0
      setSyncState({ running: true, done: 0, total: files.length, label })
      for (let index = 0; index < files.length; index++) {
        setSyncState({ running: true, done: index, total: files.length, label })
        try {
          await window.api.copyNode(source, files[index].relPath, target)
        } catch {
          failures++
        }
      }
      setSyncState({
        running: false,
        done: files.length,
        total: files.length,
        label
      })
      if (failures > 0) {
        notify(`同步完成，${failures} 个文件失败`, 'error')
      } else {
        notify(`已同步 ${files.length} 个文件`, 'success')
      }
      refresh()
    } finally {
      operationLockRef.current = false
    }
  }

  const picker = pickerSide && (
    <PickSideModal
      mode="dir"
      title={pickerSide === 'left' ? '选择左侧文件夹' : '选择右侧文件夹'}
      initial={pickerSide === 'left' ? tab.left : tab.right}
      connections={connections}
      onClose={() => setPickerSide(null)}
      onConfirm={(location) => {
        applySide(pickerSide, location)
      }}
      onManageConnections={onManageConnections}
    />
  )

  const displayRoot = filtered?.root ?? liveTree
  const displayDirPaths = (): Set<string> => {
    if (filtered) return allDirPaths(filtered.root)
    if (liveTree) return liveDirPaths(liveTree)
    return new Set()
  }

  const counts = filtered?.counts

  return (
    <div className="folder-compare">
      <LocationBar
        left={tab.left}
        right={tab.right}
        connections={connections}
        itemLabel="文件夹"
        onPick={setPickerSide}
        onApply={applySide}
        notify={notify}
      />

      <FolderToolbar
        mode={mode}
        viewMode={viewMode}
        busy={busy}
        filtersActive={filtersActive}
        canRefresh={Boolean(tab.left && tab.right)}
        canSyncRight={Boolean(scan)}
        canSyncLeft={Boolean(scan)}
        syncCounts={syncCounts}
        canExpand={Boolean(displayRoot)}
        syncState={syncState}
        opBusy={opBusy}
        scanning={scanning}
        onModeChange={setMode}
        onViewChange={changeView}
        onToggleFilters={() => setFiltersOpen((value) => !value)}
        onRefresh={refresh}
        onSync={(to) => void syncAll(to)}
        onExpandAll={() => setExpanded(displayDirPaths())}
        onCollapseAll={() => setExpanded(new Set())}
      />

      <FolderFilterBar
        filtersOpen={filtersOpen}
        filters={filters}
        includeText={includeText}
        excludeText={excludeText}
        skippedPaths={skippedPaths}
        filtersActive={filtersActive}
        filterHint={filterHint}
        onIncludeChange={setIncludeText}
        onExcludeChange={setExcludeText}
        onApply={applyFilters}
        onClear={clearFilters}
        onRefresh={refresh}
        onRemoveSkip={removeSkip}
        onClearSkips={clearSkips}
      />

      {counts && !scanning && (
        <div className="count-bar">
          <span className="count same">相同 {counts.same}</span>
          <span className="count different">不同 {counts.different}</span>
          <span className="count leftOnly">仅左侧 {counts.leftOnly}</span>
          <span className="count rightOnly">仅右侧 {counts.rightOnly}</span>
          <span className="count duration">耗时 {scan?.durationMs ?? 0} ms</span>
        </div>
      )}

      {scan && scan.warnings.length > 0 && !scanning && (
        <details className="scan-warnings">
          <summary>
            {scan.warnings.length} 个路径未能完整扫描（结果可能不完整，点击查看）
          </summary>
          <ul>
            {scan.warnings.slice(0, 50).map((warning, index) => (
              <li key={`${warning.side}:${warning.path}:${index}`}>
                <b>{warning.side === 'left' ? '左' : '右'}</b> ·{' '}
                {warning.path || '/'} — {warning.message}
              </li>
            ))}
          </ul>
          {scan.warnings.length > 50 && (
            <div className="scan-warnings-more">
              另有 {scan.warnings.length - 50} 条未显示
            </div>
          )}
        </details>
      )}

      <div className="folder-body">
        {!tab.left || !tab.right ? (
          <div className="center-empty">
            <div className="empty-icon">▤</div>
            <h2>选择左右两个文件夹</h2>
            <p>支持本地 ↔ 本地、远端 ↔ 远端（SSH），以及本地 ↔ 远端。</p>
            <div className="empty-actions">
              <button className="btn primary" onClick={() => setPickerSide('left')}>
                选择左侧文件夹
              </button>
              <button className="btn" onClick={() => setPickerSide('right')}>
                选择右侧文件夹
              </button>
            </div>
          </div>
        ) : (
          <>
            {scanning &&
              (progress ? (
                <ScanProgressPanel
                  mode={mode}
                  progress={progress}
                  onSkipCurrent={(_side, relPath) => skipPath(relPath)}
                />
              ) : (
                <div className="center-state">
                  <div className="spinner" />
                  正在准备扫描…
                </div>
              ))}
            {error && !scanning ? (
          <div className="center-state error">
            <div>扫描失败：{error}</div>
            <button className="btn" onClick={refresh}>
              重试
            </button>
          </div>
            ) : !scan ? (
              liveTree ? (
                <LiveTree
                  root={liveTree}
                  expanded={expanded}
                  onToggle={toggleDir}
                  onContextMenu={openLiveNodeMenu}
                />
              ) : scanning ? (
                <div className="center-state">
                  <div className="spinner" />
                  正在扫描，等待目录或文件…
                </div>
              ) : (
                <div className="center-state">准备扫描…</div>
              )
            ) : rows.length === 0 ? (
          <div className="center-state">
            {filtersActive
              ? '没有匹配过滤条件的文件或目录。'
              : viewMode === 'diff'
                ? '当前视图下没有内容差异。'
                : '两个文件夹都是空的，或没有可比对的内容。'}
          </div>
        ) : (
          <FolderTree
            rows={rows}
            expanded={expanded}
            selected={selected}
            busy={busy}
            onSelect={setSelected}
            onOpen={openRow}
            onContextMenu={openRowMenu}
            onCopy={(to, node) => void copyRow(to, node)}
          />
        )}
          </>
        )}
      </div>
      {picker}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
