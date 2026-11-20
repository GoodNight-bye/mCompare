import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type {
  ConnectionView,
  LaunchRequest,
  Location,
  RecentEntry
} from '../../shared/types'
import type { FileTabModel, FolderTabModel, TabModel, Theme } from './tabs'
import { errText, joinLocation, locationLabel, tabLabel } from './utils'
import FileCompareTab from './components/FileCompareTab'
import FolderCompareTab from './components/FolderCompareTab'
import ConnectionModal from './components/ConnectionModal'
import HistoryModal from './components/HistoryModal'
import Welcome from './components/Welcome'
import { setMonacoTheme } from './monaco'

interface Toast {
  id: number
  text: string
  kind: 'info' | 'success' | 'error'
}

export default function App(): JSX.Element {
  const [tabs, setTabs] = useState<TabModel[]>([])
  const [activeId, setActiveId] = useState('')
  const [connections, setConnections] = useState<ConnectionView[]>([])
  const [recent, setRecent] = useState<RecentEntry[]>([])
  const [theme, setTheme] = useState<Theme>(
    localStorage.getItem('mcompare-theme') === 'light' ? 'light' : 'dark'
  )
  const [connModal, setConnModal] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [dirty, setDirty] = useState<Record<string, boolean>>({})

  const seqRef = useRef(0)
  const toastSeq = useRef(0)
  const saveFns = useRef(new Map<string, () => Promise<void>>())
  const tabsRef = useRef(tabs)
  const activeIdRef = useRef(activeId)
  const dirtyRef = useRef(dirty)
  const initialLaunchHandled = useRef(false)
  tabsRef.current = tabs
  activeIdRef.current = activeId
  dirtyRef.current = dirty

  const notify = useCallback((text: string, kind: 'info' | 'success' | 'error' = 'info') => {
    const id = ++toastSeq.current
    setToasts((prev) => [...prev, { id, text, kind }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id))
    }, 4200)
  }, [])

  const nextId = (): string => `tab-${Date.now().toString(36)}-${++seqRef.current}`

  const newFileTab = useCallback((left: Location | null = null, right: Location | null = null) => {
    const tab: FileTabModel = { id: nextId(), kind: 'file', left, right, view: 'auto' }
    setTabs((prev) => [...prev, tab])
    setActiveId(tab.id)
    return tab.id
  }, [])

  const newFolderTab = useCallback((left: Location | null = null, right: Location | null = null) => {
    const tab: FolderTabModel = { id: nextId(), kind: 'folder', left, right }
    setTabs((prev) => [...prev, tab])
    setActiveId(tab.id)
    return tab.id
  }, [])

  const loadConnections = useCallback(async () => {
    try {
      setConnections(await window.api.listConnections())
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void loadConnections()
    window.api
      .listRecent()
      .then((entries) => setRecent(entries))
      .catch(() => undefined)
  }, [loadConnections])

  const remember = useCallback(
    async (kind: 'file' | 'folder', left: Location, right: Location) => {
      try {
        setRecent(await window.api.addRecent({ kind, left, right }))
      } catch {
        /* history is best-effort */
      }
    },
    []
  )

  const openRecent = useCallback(
    (entry: RecentEntry) => {
      setHistoryOpen(false)
      if (entry.kind === 'file') newFileTab(entry.left, entry.right)
      else newFolderTab(entry.left, entry.right)
    },
    [newFileTab, newFolderTab]
  )

  const clearRecent = useCallback(async () => {
    await window.api.clearRecent()
    setRecent([])
  }, [])

  const updateTab = useCallback(
    (id: string, patch: Partial<FileTabModel> | Partial<FolderTabModel>) => {
      setTabs((prev) =>
        prev.map((tab) => (tab.id === id ? ({ ...tab, ...patch } as TabModel) : tab))
      )
    },
    []
  )

  const handleLaunch = useCallback(
    (request: LaunchRequest) => {
      if (request.kind === 'none' || request.paths.length === 0) return
      const locations: Location[] = request.paths.map((item) => ({ kind: 'local', path: item }))
      const currentTabs = tabsRef.current
      const active = currentTabs.find((tab) => tab.id === activeIdRef.current)

      if (active && active.kind === request.kind) {
        const missing =
          active.kind === 'file'
            ? !active.left || !active.right
            : !active.left || !active.right
        if (missing) {
          setTabs((prev) =>
            prev.map((tab) => {
              if (tab.id !== active.id) return tab
              const currentLeft = tab.left
              const left = currentLeft ?? locations[0]
              const right =
                tab.right ?? (locations.length > 1 ? locations[1] : currentLeft ? locations[0] : null)
              return { ...tab, left, right } as TabModel
            })
          )
          return
        }
      }

      if (request.kind === 'file') {
        if (locations.length > 1) newFileTab(locations[0], locations[1])
        else newFileTab(locations[0], null)
      } else {
        if (locations.length > 1) newFolderTab(locations[0], locations[1])
        else newFolderTab(locations[0], null)
      }
    },
    [newFileTab, newFolderTab]
  )

  useEffect(() => {
    let alive = true
    let unsubscribe: (() => void) | null = null
    const startListening = (request: LaunchRequest | null): void => {
      if (!alive) return
      if (request && !initialLaunchHandled.current) {
        initialLaunchHandled.current = true
        handleLaunch(request)
      }
      unsubscribe = window.api.onLaunch(handleLaunch)
      // Main process flushes any second-instance launches queued during startup.
      window.api.rendererReady()
    }
    window.api
      .getLaunchRequest()
      .then((request) => startListening(request))
      .catch(() => startListening(null))
    return () => {
      alive = false
      unsubscribe?.()
    }
  }, [handleLaunch])

  const closeTab = useCallback(
    async (id: string) => {
      if (dirtyRef.current[id]) {
        const result = await window.api.confirmThree({
          title: '关闭标签页',
          message: '当前标签页有未保存的修改。',
          detail: '关闭前是否保存？',
          confirmLabel: '保存并关闭'
        })
        if (result === 'cancel') return
        if (result === 'save') {
          const save = saveFns.current.get(id)
          if (!save) {
            notify('当前视图不支持保存', 'error')
            return
          }
          try {
            await save()
          } catch (err) {
            if (errText(err) !== 'SAVE_CANCELLED') {
              notify('保存失败: ' + errText(err), 'error')
            }
            return
          }
        }
      }
      const current = tabsRef.current
      const index = current.findIndex((tab) => tab.id === id)
      const next = current.filter((tab) => tab.id !== id)
      setTabs(next)
      saveFns.current.delete(id)
      setDirty((prev) => {
        if (!(id in prev)) return prev
        const copy = { ...prev }
        delete copy[id]
        return copy
      })
      if (activeIdRef.current === id) {
        const fallback = next[Math.min(index, next.length - 1)]
        setActiveId(fallback ? fallback.id : '')
      }
    },
    [notify]
  )

  const registerSave = useCallback((id: string, fn: (() => Promise<void>) | null) => {
    if (fn) saveFns.current.set(id, fn)
    else saveFns.current.delete(id)
  }, [])

  const openFileFromFolder = useCallback(
    (left: Location, right: Location, relPath: string) => {
      newFileTab(joinLocation(left, relPath), joinLocation(right, relPath))
    },
    [newFileTab]
  )

  const toggleTheme = (): void => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('mcompare-theme', next)
    setMonacoTheme(next)
  }

  useEffect(() => {
    setMonacoTheme(theme)
  }, [theme])

  useEffect(() => {
    return window.api.onCloseRequest(() => {
      void (async () => {
        const dirtyIds = Object.keys(dirtyRef.current).filter((id) => dirtyRef.current[id])
        if (dirtyIds.length === 0) {
          window.api.closeWindow()
          return
        }
        const result = await window.api.confirmThree({
          title: '退出 mCompare',
          message: `有 ${dirtyIds.length} 个标签页存在未保存的修改。`,
          detail: '退出前是否保存这些修改？',
          confirmLabel: '保存并退出'
        })
        if (result === 'cancel') return
        if (result === 'save') {
          for (const id of dirtyIds) {
            const save = saveFns.current.get(id)
            if (!save) continue
            try {
              await save()
            } catch (err) {
              if (errText(err) !== 'SAVE_CANCELLED') {
                notify('保存失败: ' + errText(err), 'error')
              }
              return
            }
          }
        }
        window.api.closeWindow()
      })()
    })
  }, [notify])

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      const mod = event.ctrlKey || event.metaKey
      if (!mod) return
      const key = event.key.toLowerCase()
      if (key === 'o') {
        event.preventDefault()
        if (event.shiftKey) newFolderTab()
        else newFileTab()
      } else if (key === 'w') {
        event.preventDefault()
        if (activeIdRef.current) void closeTab(activeIdRef.current)
      } else if (key === 's') {
        event.preventDefault()
        const save = saveFns.current.get(activeIdRef.current)
        if (save) {
          save().catch((err) => {
            if (errText(err) !== 'SAVE_CANCELLED') {
              notify('保存失败: ' + errText(err), 'error')
            }
          })
        }
      } else if (event.key === 'Tab') {
        const current = tabsRef.current
        if (current.length < 2) return
        event.preventDefault()
        const index = current.findIndex((tab) => tab.id === activeIdRef.current)
        const next = current[(index + (event.shiftKey ? -1 : 1) + current.length) % current.length]
        setActiveId(next.id)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [closeTab, newFileTab, newFolderTab, notify])

  return (
    <div className="app" data-theme={theme}>
      <header className="app-header">
        <div className="brand">
          <span className="brand-logo">m</span>
          <span className="brand-name">mCompare</span>
        </div>
        <div className="tab-strip">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={'tab' + (tab.id === activeId ? ' active' : '')}
              onClick={() => setActiveId(tab.id)}
              title={`${tab.left ? locationLabel(tab.left, connections) : '未选择'} ↔ ${
                tab.right ? locationLabel(tab.right, connections) : '未选择'
              }`}
            >
              <span className="tab-icon">{tab.kind === 'file' ? '⇄' : '▤'}</span>
              <span className="tab-label">{tabLabel(tab)}</span>
              {dirty[tab.id] && <span className="tab-dot" />}
              <button
                className="tab-close"
                title="关闭 (Ctrl+W)"
                onClick={(event) => {
                  event.stopPropagation()
                  void closeTab(tab.id)
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="header-actions">
          <button className="btn" onClick={() => newFileTab()} title="新建文件对比 (Ctrl+O)">
            <span className="btn-mark">⇄</span> 文件对比
          </button>
          <button
            className="btn"
            onClick={() => newFolderTab()}
            title="新建文件夹对比 (Ctrl+Shift+O)"
          >
            <span className="btn-mark">▤</span> 文件夹对比
          </button>
          <button className="btn" onClick={() => setConnModal(true)} title="SSH 连接管理">
            <span className="btn-mark">⌁</span> SSH
          </button>
          <button className="btn" onClick={() => setHistoryOpen(true)} title="最近对比历史">
            <span className="btn-mark">◷</span> 历史
          </button>
          <button className="btn icon" onClick={toggleTheme} title="切换深浅主题">
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        </div>
      </header>

      <main className="app-main">
        {tabs.length === 0 ? (
          <Welcome
            onCreateFile={() => newFileTab()}
            onCreateFolder={() => newFolderTab()}
            onConnections={() => setConnModal(true)}
            recent={recent}
            connections={connections}
            onOpenRecent={openRecent}
            onOpenHistory={() => setHistoryOpen(true)}
          />
        ) : (
          tabs.map((tab) => (
            <section
              key={tab.id}
              className={'tab-panel' + (tab.id === activeId ? ' active' : '')}
            >
              {tab.kind === 'file' ? (
                <FileCompareTab
                  tab={tab}
                  active={tab.id === activeId}
                  theme={theme}
                  connections={connections}
                  onChange={(patch) => updateTab(tab.id, patch)}
                  onManageConnections={() => setConnModal(true)}
                  onDirtyChange={(value) =>
                    setDirty((prev) =>
                      prev[tab.id] === value ? prev : { ...prev, [tab.id]: value }
                    )
                  }
                  registerSave={(fn) => registerSave(tab.id, fn)}
                  onRemember={(leftLoc, rightLoc) => {
                    void remember('file', leftLoc, rightLoc)
                  }}
                  notify={notify}
                />
              ) : (
                <FolderCompareTab
                  tab={tab}
                  active={tab.id === activeId}
                  connections={connections}
                  onChange={(patch) => updateTab(tab.id, patch)}
                  onOpenFile={openFileFromFolder}
                  onManageConnections={() => setConnModal(true)}
                  onRemember={(leftLoc, rightLoc) => {
                    void remember('folder', leftLoc, rightLoc)
                  }}
                  notify={notify}
                />
              )}
            </section>
          ))
        )}
      </main>

      {connModal && (
        <ConnectionModal
          connections={connections}
          onClose={() => setConnModal(false)}
          onChanged={loadConnections}
          notify={notify}
        />
      )}

      {historyOpen && (
        <HistoryModal
          entries={recent}
          connections={connections}
          onClose={() => setHistoryOpen(false)}
          onOpen={openRecent}
          onClear={clearRecent}
          notify={notify}
        />
      )}

      <div className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={'toast ' + toast.kind}>
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  )
}
