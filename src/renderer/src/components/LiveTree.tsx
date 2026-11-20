import type { JSX, MouseEvent as ReactMouseEvent } from 'react'
import { flattenLive, type LiveNode } from '../liveTreeModel'
import { formatSize } from '../utils'

interface Props {
  root: LiveNode
  expanded: Set<string>
  onToggle: (relPath: string) => void
  onContextMenu: (event: ReactMouseEvent, node: LiveNode) => void
}

export default function LiveTree({
  root,
  expanded,
  onToggle,
  onContextMenu
}: Props): JSX.Element {
  const rows = flattenLive(root, expanded)
  return (
    <div className="tree live-tree">
      <div className="tree-head">
        <span className="col-name">名称（扫描中）</span>
        <span className="col-status">状态</span>
        <span className="col-side">左侧</span>
        <span className="col-side">右侧</span>
        <span className="col-actions" />
      </div>
      <div className="tree-rows">
        {rows.length === 0 ? (
          <div className="center-state">正在等待扫描到目录或文件…</div>
        ) : (
          rows.map(({ node, depth }) => {
            const isDir = node.type === 'dir'
            const isExpanded = isDir && expanded.has(node.relPath)
            return (
              <div
                key={node.relPath}
                className="tree-row live-row"
                onDoubleClick={() => {
                  if (isDir) onToggle(node.relPath)
                }}
                onContextMenu={(event) => onContextMenu(event, node)}
              >
                <span className="col-name" style={{ paddingLeft: 10 + depth * 18 }}>
                  <button
                    type="button"
                    className={'tree-chevron' + (isDir ? '' : ' empty')}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (isDir) onToggle(node.relPath)
                    }}
                  >
                    {isDir ? (isExpanded ? '▾' : '▸') : ''}
                  </button>
                  <span className="tree-name" title={node.relPath}>
                    {node.name}
                  </span>
                </span>
                <span className="col-status">
                  <span className="status-badge scanning">扫描中</span>
                </span>
                <span className="col-side">
                  {node.left ? (isDir ? '目录' : formatSize(node.left.size)) : '—'}
                </span>
                <span className="col-side">
                  {node.right ? (isDir ? '目录' : formatSize(node.right.size)) : '—'}
                </span>
                <span className="col-actions" />
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
