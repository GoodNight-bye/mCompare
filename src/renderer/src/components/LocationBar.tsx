import { useRef, useState, type JSX } from 'react'
import type { ConnectionView, Location } from '../../../shared/types'
import type { Notify } from '../tabs'
import {
  displayLocationInput,
  resolveLocationInput,
  sameLocation
} from '../utils'

type Side = 'left' | 'right'

interface Props {
  left: Location | null
  right: Location | null
  connections: ConnectionView[]
  itemLabel: '文件' | '文件夹'
  leftInfo?: string
  rightInfo?: string
  onPick: (side: Side) => void
  onApply: (side: Side, location: Location) => Promise<boolean> | boolean
  notify: Notify
}

export default function LocationBar({
  left,
  right,
  connections,
  itemLabel,
  leftInfo,
  rightInfo,
  onPick,
  onApply,
  notify
}: Props): JSX.Element {
  const [editing, setEditing] = useState<Side | null>(null)
  const [draft, setDraft] = useState('')
  const [editError, setEditError] = useState<{ side: Side; text: string } | null>(null)
  const committing = useRef(false)

  const startEdit = (side: Side, loc: Location | null): void => {
    if (editing !== side) {
      setDraft(displayLocationInput(loc, connections))
      setEditError(null)
    }
    setEditing(side)
  }

  const cancelEdit = (): void => {
    setEditing(null)
    setEditError(null)
  }

  const commit = async (side: Side, loc: Location | null): Promise<void> => {
    if (committing.current) return
    const raw = draft
    const parsed = resolveLocationInput(raw, connections, loc)
    if (parsed.error || !parsed.location) {
      const text = parsed.error || '路径无效'
      setEditError({ side, text })
      return
    }
    const next = parsed.location
    if (sameLocation(next, loc)) {
      setEditing(null)
      setEditError(null)
      return
    }
    committing.current = true
    setEditing(null)
    setEditError(null)
    try {
      await onApply(side, next)
    } catch (err) {
      notify('应用路径失败: ' + (err instanceof Error ? err.message : String(err)), 'error')
    } finally {
      committing.current = false
    }
  }

  return (
    <div className="location-bar">
      {(['left', 'right'] as const).map((side) => {
        const loc = side === 'left' ? left : right
        const info = side === 'left' ? leftInfo : rightInfo
        const isEditing = editing === side
        const error = editError?.side === side ? editError.text : ''
        const conn =
          loc?.kind === 'remote'
            ? connections.find((item) => item.id === loc.connectionId)
            : undefined
        const value = isEditing ? draft : displayLocationInput(loc, connections)
        return (
          <div className="loc-cell" key={side}>
            <div className="loc-head">
              <span className={`side-pill ${side}`}>{side === 'left' ? '左' : '右'}</span>
              <input
                className="loc-input"
                value={value}
                title={value || '可直接输入路径'}
                spellCheck={false}
                placeholder="本地路径，或 user@host:/home/user/repo"
                onFocus={() => startEdit(side, loc)}
                onChange={(event) => {
                  setDraft(event.target.value)
                  if (error) setEditError(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void commit(side, loc)
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelEdit()
                  }
                }}
                onBlur={() => {
                  if (editing === side) void commit(side, loc)
                }}
              />
              <span className="loc-kind">
                {loc?.kind === 'remote' ? 'SSH' : loc ? '本地' : '—'}
              </span>
              <button
                className="btn tiny ghost"
                onClick={() => onPick(side)}
                title="从本地文件系统或 SSH 目录中选择"
              >
                更换
              </button>
            </div>
            <div className={'loc-sub' + (error ? ' loc-error' : '')}>
              {error ? (
                error
              ) : isEditing ? (
                <>回车应用 · Esc 取消 · 支持粘贴 user@host:/path</>
              ) : loc ? (
                <>
                  {loc.kind === 'remote'
                    ? `SSH · ${conn?.name || '已保存连接'}`
                    : `本地${itemLabel}`}
                  {info ? <span className="loc-info"> · {info}</span> : null}
                </>
              ) : (
                <>可直接粘贴 SSH 路径，例如 192.0.2.10:/home/user/code</>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
