import type { JSX } from 'react'
import type { ConnectionView, RecentEntry } from '../../../shared/types'
import { basename, formatTime, locationLabel } from '../utils'

interface Props {
  onCreateFile: () => void
  onCreateFolder: () => void
  onConnections: () => void
  recent: RecentEntry[]
  connections: ConnectionView[]
  onOpenRecent: (entry: RecentEntry) => void
  onOpenHistory: () => void
}

export default function Welcome({
  onCreateFile,
  onCreateFolder,
  onConnections,
  recent,
  connections,
  onOpenRecent,
  onOpenHistory
}: Props): JSX.Element {
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <div className="welcome-brand">
          <div className="welcome-logo">m</div>
          <div>
            <h1>mCompare</h1>
            <p>Beyond Compare 风格的轻量对比工具</p>
          </div>
        </div>

        <div className="welcome-cards">
          <button className="welcome-card" onClick={onCreateFile}>
            <span className="card-icon">⇄</span>
            <span className="card-title">文件对比</span>
            <span className="card-text">
              代码文件按文本打开，可编辑保存；二进制自动进入十六进制对比。差异按红（代码）/ 蓝（注释、排版）分级显示。
            </span>
            <span className="card-shortcut">Ctrl + O</span>
          </button>
          <button className="welcome-card" onClick={onCreateFolder}>
            <span className="card-icon">▤</span>
            <span className="card-title">文件夹对比</span>
            <span className="card-text">
              递归比较两个目录，标记相同、不同、仅左侧、仅右侧；支持双向复制和整目录同步，可连接 SSH 远端。
            </span>
            <span className="card-shortcut">Ctrl + Shift + O</span>
          </button>
          <button className="welcome-card" onClick={onConnections}>
            <span className="card-icon">⌁</span>
            <span className="card-title">SSH 连接</span>
            <span className="card-text">
              保存远端服务器连接（用户名 + 密码），支持远端 ↔ 远端目录对比、文件和目录双向同步。
            </span>
            <span className="card-shortcut">远端文件浏览 / 编辑保存</span>
          </button>
        </div>

        {recent.length > 0 && (
          <div className="welcome-recent">
            <div className="welcome-recent-head">
              <span>最近对比</span>
              <button className="btn tiny ghost" onClick={onOpenHistory}>
                查看全部
              </button>
            </div>
            <div className="welcome-recent-list">
              {recent.slice(0, 6).map((entry) => (
                <button
                  key={entry.id}
                  className="welcome-recent-item"
                  onClick={() => onOpenRecent(entry)}
                  title={locationLabel(entry.left, connections) + ' ↔ ' + locationLabel(entry.right, connections)}
                >
                  <span className="recent-item-icon">
                    {entry.kind === 'file' ? '⇄' : '▤'}
                  </span>
                  <span className="recent-item-main">
                    <span className="recent-item-title">
                      {basename(entry.left.path)} ↔ {basename(entry.right.path)}
                    </span>
                    <span className="recent-item-sub">
                      {locationLabel(entry.left, connections)} ↔{' '}
                      {locationLabel(entry.right, connections)}
                    </span>
                  </span>
                  <span className="recent-item-time">{formatTime(entry.addedAt)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="welcome-footer">
          <span>命令行：mCompare.exe &lt;左侧&gt; &lt;右侧&gt;</span>
          <span>F7 / Shift+F7 跳转差异</span>
          <span>Ctrl + S 保存</span>
        </div>
      </div>
    </div>
  )
}
