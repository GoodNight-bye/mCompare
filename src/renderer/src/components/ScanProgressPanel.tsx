import type { JSX } from 'react'

export interface SideProgress {
  currentPath: string
  files: number
  dirs: number
  finished: boolean
}

export interface ScanProgressState {
  scanId: string
  left: SideProgress
  right: SideProgress
  compareDone: number
  compareTotal: number
}

interface Props {
  mode: 'quick' | 'content'
  progress: ScanProgressState
  onSkipCurrent: (side: 'left' | 'right', relPath: string) => void
}

export default function ScanProgressPanel({
  mode,
  progress,
  onSkipCurrent
}: Props): JSX.Element {
  const comparing = progress.compareTotal > 0
  const percent = comparing
    ? Math.min(
        100,
        Math.round((progress.compareDone / Math.max(1, progress.compareTotal)) * 100)
      )
    : 0

  return (
    <div className="scan-progress compact">
      <div className="scan-head">
        <div className="spinner" />
        <div className="scan-head-text">
          <div className="scan-title">
            {comparing
              ? '正在比较文件内容…'
              : progress.left.finished && progress.right.finished
                ? '正在整理比较结果…'
                : '正在扫描并比较文件夹…'}
          </div>
          <div className="scan-sub">
            {mode === 'quick'
              ? '快速模式：按文件大小判断，忽略时间戳'
              : '内容模式：按 SHA-256 比较同大小文件'}
            <span className="scan-hint"> · 可展开/折叠、右键跳过实时目录树</span>
          </div>
        </div>
      </div>

      <div className="scan-side-cards">
        {(['left', 'right'] as const).map((side) => {
          const info = progress[side]
          return (
            <div className="scan-side-card" key={side}>
              <div className="scan-side-head">
                <span className={`side-pill ${side}`}>{side === 'left' ? '左' : '右'}</span>
                <span className="scan-side-name">{side === 'left' ? '左侧' : '右侧'}</span>
                <span className={'scan-side-state' + (info.finished ? ' done' : '')}>
                  {info.finished
                    ? '扫描完成'
                    : info.currentPath || info.files > 0 || info.dirs > 0
                      ? '扫描中'
                      : '等待中'}
                </span>
                <button
                  className="btn tiny"
                  disabled={!info.currentPath || info.finished}
                  title="停止扫描当前目录并加入跳过（不会重启整个扫描）"
                  onClick={() => onSkipCurrent(side, info.currentPath)}
                >
                  跳过目录
                </button>
              </div>
              <div className="scan-current" title={info.currentPath}>
                {info.currentPath || '准备中…'}
              </div>
              <div className="scan-counts">
                {info.files.toLocaleString()} 个文件 · {info.dirs.toLocaleString()} 个目录
              </div>
            </div>
          )
        })}
      </div>

      {comparing && (
        <div className="scan-compare">
          <div className="scan-compare-label">
            正在比较内容 {progress.compareDone} / {progress.compareTotal}（{percent}%）
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}
