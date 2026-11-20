import { useEffect, useState, type JSX } from 'react'
import type { ConnectionView, Location, RemoteEntry } from '../../../shared/types'
import { errText, formatSize } from '../utils'

interface Props {
  mode: 'file' | 'dir'
  title: string
  initial: Location | null
  connections: ConnectionView[]
  onClose: () => void
  onConfirm: (location: Location) => void
  onManageConnections: () => void
}

export default function PickSideModal({
  mode,
  title,
  initial,
  connections,
  onClose,
  onConfirm,
  onManageConnections
}: Props): JSX.Element {
  const initialRemote = initial?.kind === 'remote' ? initial : null
  const initialLocal = initial?.kind === 'local' ? initial : null
  const fallbackConnection = connections[0]?.id || ''
  const [tab, setTab] = useState<'local' | 'remote'>(initialRemote ? 'remote' : 'local')
  const [localPath, setLocalPath] = useState(initialLocal?.path || '')
  const [connectionId, setConnectionId] = useState(
    initialRemote && connections.some((c) => c.id === initialRemote.connectionId)
      ? initialRemote.connectionId
      : fallbackConnection
  )
  const [remotePath, setRemotePath] = useState(initialRemote?.path || '/')
  const [browseNonce, setBrowseNonce] = useState(1)
  const [entries, setEntries] = useState<RemoteEntry[]>([])
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [remoteError, setRemoteError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (tab === 'remote' && !connectionId && connections.length > 0) {
      setConnectionId(connections[0].id)
    }
  }, [tab, connectionId, connections])

  useEffect(() => {
    if (tab !== 'remote' || !connectionId) {
      setEntries([])
      return
    }
    let cancelled = false
    setRemoteLoading(true)
    setRemoteError('')
    window.api
      .remoteList(connectionId, remotePath || '/')
      .then((list) => {
        if (cancelled) return
        setEntries(mode === 'dir' ? list.filter((entry) => entry.type === 'dir') : list)
        setRemoteLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setRemoteError(errText(err))
        setEntries([])
        setRemoteLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, connectionId, browseNonce, mode])

  const browseLocal = async (): Promise<void> => {
    setBusy(true)
    try {
      const picked =
        mode === 'file'
          ? await window.api.openLocalFile()
          : await window.api.openLocalFolder()
      if (picked) setLocalPath(picked)
    } finally {
      setBusy(false)
    }
  }

  const navigate = (path: string): void => {
    setRemotePath(path)
    setBrowseNonce((value) => value + 1)
  }

  const goUp = (): void => {
    const trimmed = remotePath.replace(/\/+$/, '')
    const index = trimmed.lastIndexOf('/')
    const parent = index <= 0 ? '/' : trimmed.slice(0, index)
    navigate(parent)
  }

  const canConfirm =
    tab === 'local' ? localPath.trim().length > 0 : Boolean(connectionId) && remotePath.trim().length > 0

  const confirm = (): void => {
    if (!canConfirm) return
    if (tab === 'local') {
      onConfirm({ kind: 'local', path: localPath.trim() })
    } else {
      onConfirm({ kind: 'remote', connectionId, path: remotePath.trim() || '/' })
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal side-modal">
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            <p className="sub">选择本地路径，或通过 SSH 连接选择远端路径</p>
          </div>
          <button className="btn ghost icon" onClick={onClose} title="关闭">
            ×
          </button>
        </div>

        <div className="segmented modal-tabs">
          <button
            className={tab === 'local' ? 'active' : ''}
            onClick={() => setTab('local')}
            type="button"
          >
            本地
          </button>
          <button
            className={tab === 'remote' ? 'active' : ''}
            onClick={() => setTab('remote')}
            type="button"
          >
            远程 SSH
          </button>
        </div>

        <div className="modal-body">
          {tab === 'local' ? (
            <div className="side-local">
              <label className="field">
                <span>路径</span>
                <div className="input-row">
                  <input
                    value={localPath}
                    onChange={(event) => setLocalPath(event.target.value)}
                    placeholder={mode === 'file' ? 'C:\\path\\to\\file.ts' : 'C:\\path\\to\\folder'}
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') confirm()
                    }}
                  />
                  <button className="btn" disabled={busy} onClick={() => void browseLocal()}>
                    浏览…
                  </button>
                </div>
              </label>
              <p className="hint">
                {mode === 'file' ? '选择需要比较的本地文件。' : '选择需要比较的本地文件夹。'}
              </p>
            </div>
          ) : (
            <div className="side-remote">
              <div className="remote-top">
                <label className="field">
                  <span>连接</span>
                  <select
                    value={connectionId}
                    onChange={(event) => setConnectionId(event.target.value)}
                  >
                    {connections.length === 0 && <option value="">尚无保存的连接</option>}
                    {connections.map((connection) => (
                      <option key={connection.id} value={connection.id}>
                        {connection.name} ({connection.username}@{connection.host}:{connection.port})
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn" onClick={onManageConnections}>
                  管理连接
                </button>
              </div>

              {connections.length === 0 ? (
                <div className="empty-note">
                  还没有 SSH 连接。先在“管理连接”中添加服务器（用户名 + 密码），再回到这里选择远端路径。
                </div>
              ) : (
                <>
                  <div className="input-row remote-path-row">
                    <button className="btn icon" onClick={goUp} title="上一级">
                      ↑
                    </button>
                    <input
                      value={remotePath}
                      onChange={(event) => setRemotePath(event.target.value)}
                      placeholder="/home/user/project"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') navigate(remotePath)
                      }}
                    />
                    <button className="btn" onClick={() => navigate(remotePath)}>
                      转到
                    </button>
                    <button className="btn" onClick={() => setBrowseNonce((v) => v + 1)}>
                      刷新
                    </button>
                  </div>

                  <div className="remote-list">
                    {remoteLoading && <div className="list-state">正在读取目录…</div>}
                    {!remoteLoading && remoteError && (
                      <div className="list-state error">{remoteError}</div>
                    )}
                    {!remoteLoading && !remoteError && entries.length === 0 && (
                      <div className="list-state">目录为空</div>
                    )}
                    {!remoteLoading &&
                      !remoteError &&
                      entries.map((entry) => (
                        <div
                          key={entry.path}
                          className={
                            'remote-entry' +
                            (entry.type === 'dir' ? ' is-dir' : '') +
                            (mode === 'file' && remotePath === entry.path ? ' selected' : '')
                          }
                          onClick={() => {
                            if (entry.type === 'dir') navigate(entry.path)
                            else setRemotePath(entry.path)
                          }}
                          onDoubleClick={() => {
                            if (entry.type === 'dir') navigate(entry.path)
                            else if (mode === 'file') confirm()
                          }}
                        >
                          <span className="entry-icon">{entry.type === 'dir' ? '▸' : '·'}</span>
                          <span className="entry-name">{entry.name}</span>
                          <span className="entry-size">
                            {entry.type === 'file' ? formatSize(entry.size) : ''}
                          </span>
                        </div>
                      ))}
                  </div>
                  <p className="hint">
                    {mode === 'file'
                      ? '点击目录进入，点击文件选中。也可以直接输入完整文件路径。'
                      : '进入目标目录后点击“选择文件夹”。'}
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <div className="footer-note">
            {tab === 'remote' && remotePath ? `当前：${remotePath}` : ''}
          </div>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" disabled={!canConfirm} onClick={confirm}>
            {mode === 'file' ? '选择文件' : '选择文件夹'}
          </button>
        </div>
      </div>
    </div>
  )
}
