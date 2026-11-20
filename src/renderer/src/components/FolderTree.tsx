import type { JSX, MouseEvent as ReactMouseEvent } from 'react'
import type { FolderNode } from '../../../shared/types'
import { STATUS_LABEL, sideMeta, type FolderRow } from '../folderTree'

interface Props {
  rows: FolderRow[]
  expanded: Set<string>
  selected: string | null
  busy: boolean
  onSelect: (relPath: string) => void
  onOpen: (node: FolderNode) => void
  onContextMenu: (event: ReactMouseEvent, node: FolderNode) => void
  onCopy: (to: 'right' | 'left', node: FolderNode) => void
}

export default function FolderTree({
  rows,
  expanded,
  selected,
  busy,
  onSelect,
  onOpen,
  onContextMenu,
  onCopy
}: Props): JSX.Element {
  return (
    <div className="tree">
      <div className="tree-head">
        <span className="col-name">名称</span>
        <span className="col-status">状态</span>
        <span className="col-side">左侧</span>
        <span className="col-side">右侧</span>
        <span className="col-actions" />
      </div>
      <div className="tree-rows">
        {rows.map(({ node, depth }) => {
          const isSelected = selected === node.relPath
          const isDir = node.type === 'dir'
          const isExpanded = isDir && expanded.has(node.relPath)
          return (
            <div
              key={node.relPath}
              className={`tree-row status-${node.status}${isSelected ? ' selected' : ''}`}
              onClick={() => onSelect(node.relPath)}
              onDoubleClick={() => onOpen(node)}
              onContextMenu={(event) => onContextMenu(event, node)}
            >
              <span className="col-name" style={{ paddingLeft: 10 + depth * 18 }}>
                <span className={'tree-chevron' + (isDir ? '' : ' empty')}>
                  {isDir ? (isExpanded ? '▾' : '▸') : ''}
                </span>
                <span className="tree-name" title={node.relPath}>
                  {node.name}
                </span>
              </span>
              <span className="col-status">
                <span className={`status-badge ${node.status}`}>
                  {STATUS_LABEL[node.status]}
                </span>
              </span>
              <span className="col-side">{sideMeta(node.left, isDir)}</span>
              <span className="col-side">{sideMeta(node.right, isDir)}</span>
              <span className="col-actions" onClick={(event) => event.stopPropagation()}>
                {node.left && (
                  <button
                    className="btn tiny icon"
                    title="复制到右侧"
                    disabled={busy}
                    onClick={() => onCopy('right', node)}
                  >
                    →
                  </button>
                )}
                {node.right && (
                  <button
                    className="btn tiny icon"
                    title="复制到左侧"
                    disabled={busy}
                    onClick={() => onCopy('left', node)}
                  >
                    ←
                  </button>
                )}
                {!isDir && node.left && node.right && (
                  <button className="btn tiny" disabled={busy} onClick={() => onOpen(node)}>
                    对比
                  </button>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
