import { useEffect, useState, type JSX } from 'react'
import type { ConnectionView } from '../../../shared/types'
import type { Notify } from '../tabs'
import { errText } from '../utils'

interface Props {
  connections: ConnectionView[]
  onClose: () => void
  onChanged: () => Promise<void> | void
  notify: Notify
}

interface FormState {
  name: string
  host: string
  port: number
  username: string
  password: string
}

const blankForm: FormState = { name: '', host: '', port: 22, username: '', password: '' }

export default function ConnectionModal({
  connections,
  onClose,
  onChanged,
  notify
}: Props): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(blankForm)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [testMessage, setTestMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const resetForm = (): void => {
    setEditingId(null)
    setForm(blankForm)
    setTestMessage(null)
    setError('')
  }

  const startEdit = (connection: ConnectionView): void => {
    setEditingId(connection.id)
    setForm({
      name: connection.name,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      password: ''
    })
    setTestMessage(null)
    setError('')
  }

  const buildInput = (): {
    id?: string
    name: string
    host: string
    port: number
    username: string
    password?: string
  } => ({
    id: editingId || undefined,
    name: form.name,
    host: form.host,
    port: Number(form.port) || 22,
    username: form.username,
    password: form.password || undefined
  })

  const save = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await window.api.saveConnection(buildInput())
      await onChanged()
      notify('SSH 连接已保存', 'success')
      resetForm()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(false)
    }
  }

  const test = async (): Promise<void> => {
    setBusy(true)
    setTestMessage(null)
    setError('')
    try {
      await window.api.testConnection(buildInput())
      setTestMessage({ ok: true, text: '连接成功' })
    } catch (err) {
      setTestMessage({ ok: false, text: errText(err) })
    } finally {
      setBusy(false)
    }
  }

  const remove = async (connection: ConnectionView): Promise<void> => {
    const ok = await window.api.confirm({
      title: '删除连接',
      message: `删除 SSH 连接「${connection.name}」？`,
      detail: '仅删除本地保存的连接信息，不会影响服务器。',
      confirmLabel: '删除',
      danger: true
    })
    if (!ok) return
    try {
      await window.api.deleteConnection(connection.id)
      if (editingId === connection.id) resetForm()
      await onChanged()
      notify('连接已删除', 'success')
    } catch (err) {
      notify('删除失败: ' + errText(err), 'error')
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal connection-modal">
        <div className="modal-header">
          <div>
            <h2>SSH 连接管理</h2>
            <p className="sub">支持用户名 + 密码登录；密码使用系统安全存储加密后保存在本机</p>
          </div>
          <button className="btn ghost icon" onClick={onClose} title="关闭">
            ×
          </button>
        </div>

        <div className="connection-body">
          <div className="connection-list">
            <div className="list-title">
              已保存连接
              <button className="btn tiny" onClick={resetForm}>
                + 新建
              </button>
            </div>
            {connections.length === 0 && (
              <div className="list-state">还没有连接，右侧填写信息后保存。</div>
            )}
            {connections.map((connection) => (
              <div
                key={connection.id}
                className={'connection-item' + (editingId === connection.id ? ' active' : '')}
                onClick={() => startEdit(connection)}
              >
                <div className="connection-main">
                  <div className="connection-name">{connection.name}</div>
                  <div className="connection-meta">
                    {connection.username}@{connection.host}:{connection.port}
                    {connection.hasPassword ? ' · 密码已保存' : ' · 未保存密码'}
                  </div>
                </div>
                <div className="connection-actions">
                  <button
                    className="btn tiny"
                    onClick={(event) => {
                      event.stopPropagation()
                      startEdit(connection)
                    }}
                  >
                    编辑
                  </button>
                  <button
                    className="btn tiny"
                    onClick={(event) => {
                      event.stopPropagation()
                      void remove(connection)
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="connection-form">
            <div className="form-title">
              {editingId ? '编辑连接' : '新建连接'}
              {editingId && (
                <button className="btn tiny ghost" onClick={resetForm}>
                  取消编辑
                </button>
              )}
            </div>
            <div className="form-grid">
              <label className="field">
                <span>名称</span>
                <input
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  placeholder="例如：dev-server"
                />
              </label>
              <label className="field">
                <span>主机</span>
                <input
                  value={form.host}
                  onChange={(event) => setForm({ ...form, host: event.target.value })}
                  placeholder="192.168.1.10"
                />
              </label>
              <label className="field">
                <span>端口</span>
                <input
                  type="number"
                  value={form.port}
                  onChange={(event) =>
                    setForm({ ...form, port: Number(event.target.value) || 22 })
                  }
                />
              </label>
              <label className="field">
                <span>用户名</span>
                <input
                  value={form.username}
                  onChange={(event) => setForm({ ...form, username: event.target.value })}
                  placeholder="root"
                />
              </label>
              <label className="field full">
                <span>密码</span>
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  placeholder={
                    editingId
                      ? '已保存则留空，输入新密码可覆盖'
                      : '登录密码（会加密保存）'
                  }
                />
              </label>
            </div>
            {error && <div className="form-message error">{error}</div>}
            {testMessage && (
              <div className={'form-message ' + (testMessage.ok ? 'ok' : 'error')}>
                {testMessage.text}
              </div>
            )}
            <div className="form-actions">
              <button className="btn" disabled={busy} onClick={() => void test()}>
                测试连接
              </button>
              <button className="btn primary" disabled={busy} onClick={() => void save()}>
                {editingId ? '保存修改' : '保存连接'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
