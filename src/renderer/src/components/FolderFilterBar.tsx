import type { JSX } from 'react'
import type { FolderFilters } from '../../../shared/types'

interface Props {
  filtersOpen: boolean
  filters: FolderFilters
  includeText: string
  excludeText: string
  skippedPaths: string[]
  filtersActive: boolean
  filterHint: boolean
  onIncludeChange: (value: string) => void
  onExcludeChange: (value: string) => void
  onApply: () => void
  onClear: () => void
  onRefresh: () => void
  onRemoveSkip: (relPath: string) => void
  onClearSkips: () => void
}

export default function FolderFilterBar({
  filtersOpen,
  filters,
  includeText,
  excludeText,
  skippedPaths,
  filtersActive,
  filterHint,
  onIncludeChange,
  onExcludeChange,
  onApply,
  onClear,
  onRefresh,
  onRemoveSkip,
  onClearSkips
}: Props): JSX.Element {
  return (
    <>
      {filtersOpen && (
        <div className="filter-bar">
          <label className="filter-field">
            <span>包含</span>
            <input
              value={includeText}
              onChange={(event) => onIncludeChange(event.target.value)}
              placeholder="例如 *.ts, src/**"
              onKeyDown={(event) => {
                if (event.key === 'Enter') onApply()
              }}
            />
          </label>
          <label className="filter-field">
            <span>排除</span>
            <input
              value={excludeText}
              onChange={(event) => onExcludeChange(event.target.value)}
              placeholder="例如 node_modules, .git, *.log"
              onKeyDown={(event) => {
                if (event.key === 'Enter') onApply()
              }}
            />
          </label>
          <button className="btn tiny primary" onClick={onApply}>
            应用
          </button>
          <button className="btn tiny" onClick={onClear}>
            清空
          </button>
          <span className="filter-hint">逗号/分号分隔，支持 *、?、**；留空表示不过滤</span>
        </div>
      )}

      {filtersActive && (
        <div className="filter-summary">
          <span>
            {filters.include.length > 0 || filters.exclude.length > 0 ? '过滤中' : '跳过项'}
            {filters.include.length > 0 ? ` · 包含 ${filters.include.join(', ')}` : ''}
            {filters.exclude.length > 0 ? ` · 排除 ${filters.exclude.join(', ')}` : ''}
            {skippedPaths.length > 0 ? ` · 已跳过 ${skippedPaths.length} 项` : ''}
          </span>
          {filters.include.length > 0 || filters.exclude.length > 0 ? (
            <button className="btn tiny ghost" onClick={onClear}>
              清除过滤
            </button>
          ) : null}
          {skippedPaths.length > 0 ? (
            <button className="btn tiny ghost" onClick={onClearSkips}>
              清除跳过
            </button>
          ) : null}
        </div>
      )}

      {skippedPaths.length > 0 && (
        <div className="skip-list">
          <span className="skip-list-label">已跳过：</span>
          {skippedPaths.map((item) => (
            <button
              key={item}
              className="skip-chip"
              title={`${item}
点击移除此跳过项`}
              onClick={() => onRemoveSkip(item)}
            >
              <span className="skip-chip-text">{item}</span>
              <span className="skip-chip-x">×</span>
            </button>
          ))}
        </div>
      )}

      {filterHint && (
        <div className="filter-summary warn">
          <span>
            当前过滤范围比本次扫描时更宽，部分路径可能未包含在结果中。过滤变更不会自动重扫。
          </span>
          <button className="btn tiny" onClick={onRefresh}>
            重新扫描
          </button>
        </div>
      )}
    </>
  )
}
