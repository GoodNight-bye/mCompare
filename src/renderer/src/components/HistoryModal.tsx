import type { JSX } from 'react'
import type { ConnectionView, RecentEntry } from '../../../shared/types'
import type { Notify } from '../tabs'
import { basename, formatTime, locationLabel } from '../utils'

interface Props {
  entries: RecentEntry[]
  connections: ConnectionView[]
  onClose: () => void
  onOpen: (entry: RecentEntry) => void
  onClear: () => Promise<void>
  notify: Notify
}

export default function HistoryModal({
  entries,
  connections,
  onClose,
  onOpen,
  onClear,
  notify
}: Props): JSX.Element {
  const clear = async (): Promise<void> => {
    if (entries.length === 0) return
    const ok = await window.api.confirm({
      title: '清空历史记录',
      message: `清空全部 ${entries.length} 条最近对比记录？`,
      detail: '只删除本机的历史列表，不会影响任何文件。',
      confirmLabel: '清空',
      danger: true
    })
    if (!ok) return
    await onClear()
    notify('历史记录已清空', 'success')
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal history-modal">
        <div className="modal-header">
          <div>
            <h2>最近对比</h2>
            <p className="sub">最近打开过的文件/文件夹对比会保存在这里，应用重启后仍可重新打开</p>
          </div>
          <button className="btn ghost icon" onClick={onClose} title="关闭">
            ×
          </button>
        </div>
        <div className="modal-body history-body">
          {entries.length === 0 ? (
            <div className="list-state">还没有历史记录。完成一次对比后会自动记录。</div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                className="history-item"
                onClick={() => onOpen(entry)}
                title="重新打开这次对比"
              >
                <span className="history-icon">{entry.kind === 'file' ? '⇄' : '▤'}</span>
                <span className="history-main">
                  <span className="history-title">
                    {basename(entry.left.path)} ↔ {basename(entry.right.path)}
                  </span>
                  <span className="history-sub">
                    {locationLabel(entry.left, connections)} ↔{' '}
                    {locationLabel(entry.right, connections)}
                  </span>
                </span>
                <span className="history-kind">
                  {entry.kind === 'file' ? '文件' : '文件夹'}
                </span>
                <span className="history-time">{formatTime(entry.addedAt)}</span>
              </div>
            ))
          )}
        </div>
        <div className="modal-footer">
          <div className="footer-note">最近 {entries.length} 条</div>
          <button className="btn" disabled={entries.length === 0} onClick={() => void clear()}>
            清空历史
          </button>
          <button className="btn primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
