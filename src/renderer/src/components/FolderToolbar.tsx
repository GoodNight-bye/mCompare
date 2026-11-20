import type { JSX } from 'react'

export interface SyncState {
  running: boolean
  done: number
  total: number
  label: string
}

interface Props {
  mode: 'quick' | 'content'
  viewMode: 'all' | 'diff'
  busy: boolean
  filtersActive: boolean
  canRefresh: boolean
  canSyncRight: boolean
  canSyncLeft: boolean
  syncCounts: { toRight: number; toLeft: number }
  canExpand: boolean
  syncState: SyncState | null
  opBusy: string | null
  scanning: boolean
  onModeChange: (mode: 'quick' | 'content') => void
  onViewChange: (mode: 'all' | 'diff') => void
  onToggleFilters: () => void
  onRefresh: () => void
  onSync: (to: 'right' | 'left') => void
  onExpandAll: () => void
  onCollapseAll: () => void
}

export default function FolderToolbar({
  mode,
  viewMode,
  busy,
  filtersActive,
  canRefresh,
  canSyncRight,
  canSyncLeft,
  syncCounts,
  canExpand,
  syncState,
  opBusy,
  scanning,
  onModeChange,
  onViewChange,
  onToggleFilters,
  onRefresh,
  onSync,
  onExpandAll,
  onCollapseAll
}: Props): JSX.Element {
  return (
    <div className="pane-toolbar folder-toolbar">
      <div className="segmented">
        <button
          type="button"
          className={mode === 'quick' ? 'active' : ''}
          disabled={busy}
          onClick={() => onModeChange('quick')}
          title="按文件大小比较，忽略修改时间；不校验内容"
        >
          快速
        </button>
        <button
          type="button"
          className={mode === 'content' ? 'active' : ''}
          disabled={busy}
          onClick={() => onModeChange('content')}
          title="按 SHA-256 内容哈希比较，可准确判断内容是否一致（大目录较慢）"
        >
          内容
        </button>
      </div>
      <div className="segmented">
        <button
          type="button"
          className={viewMode === 'all' ? 'active' : ''}
          onClick={() => onViewChange('all')}
          title="显示全部条目"
        >
          全部
        </button>
        <button
          type="button"
          className={viewMode === 'diff' ? 'active' : ''}
          onClick={() => onViewChange('diff')}
          title="只显示内容/结构有差异的条目（隐藏相同项）"
        >
          仅差异
        </button>
      </div>
      <button
        className={'btn tiny' + (filtersActive ? ' filter-on' : '')}
        onClick={onToggleFilters}
        title="过滤参与比较的文件和目录"
      >
        过滤器{filtersActive ? ' ●' : ''}
      </button>
      <button className="btn tiny" onClick={onRefresh} disabled={!canRefresh || busy}>
        刷新
      </button>
      <button
        className="btn tiny"
        disabled={!canSyncRight || busy || syncCounts.toRight === 0}
        onClick={() => onSync('right')}
      >
        同步差异 → 右侧 {syncCounts.toRight > 0 ? `(${syncCounts.toRight})` : ''}
      </button>
      <button
        className="btn tiny"
        disabled={!canSyncLeft || busy || syncCounts.toLeft === 0}
        onClick={() => onSync('left')}
      >
        ← 左侧 {syncCounts.toLeft > 0 ? `(${syncCounts.toLeft})` : ''}
      </button>
      <button className="btn tiny" disabled={!canExpand} onClick={onExpandAll}>
        展开全部
      </button>
      <button className="btn tiny" disabled={!canExpand} onClick={onCollapseAll}>
        折叠全部
      </button>
      <div className="toolbar-spacer" />
      {syncState?.running && (
        <span className="sync-status">
          {syncState.label} {syncState.done}/{syncState.total}
        </span>
      )}
      {opBusy && <span className="sync-status">正在复制 {opBusy}</span>}
      {scanning && <span className="sync-status">正在扫描…</span>}
    </div>
  )
}
