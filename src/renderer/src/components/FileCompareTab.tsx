import { useEffect, useRef, useState, type JSX } from 'react'
import type {
  BinaryData,
  ConnectionView,
  Location,
  ReadFileResult
} from '../../../shared/types'
import type { FileTabModel, Notify, Theme } from '../tabs'
import { errText, formatSize, locKey, sameLocation } from '../utils'
import HexCompare from './HexCompare'
import LocationBar from './LocationBar'
import PickSideModal from './PickSideModal'
import TextDiff from './TextDiff'

const HEX_LIMIT = 4 * 1024 * 1024

interface Props {
  tab: FileTabModel
  active: boolean
  theme: Theme
  connections: ConnectionView[]
  onChange: (patch: Partial<FileTabModel>) => void
  onManageConnections: () => void
  onDirtyChange: (dirty: boolean) => void
  registerSave: (fn: (() => Promise<void>) | null) => void
  onRemember: (left: Location, right: Location) => void
  notify: Notify
}

interface HexData {
  left: BinaryData
  right: BinaryData
}

function dataInfo(data: ReadFileResult | null): string {
  if (!data) return ''
  if (data.kind === 'text') {
    return `${data.encoding.toUpperCase()}${data.bom ? ' BOM' : ''} · ${formatSize(data.size)}`
  }
  return `二进制 · ${formatSize(data.size)}`
}

export default function FileCompareTab({
  tab,
  active,
  theme,
  connections,
  onChange,
  onManageConnections,
  onDirtyChange,
  registerSave,
  onRemember,
  notify
}: Props): JSX.Element {
  const [leftData, setLeftData] = useState<ReadFileResult | null>(null)
  const [rightData, setRightData] = useState<ReadFileResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [viewOverride, setViewOverride] = useState<'text' | 'hex' | null>(null)
  const [hexData, setHexData] = useState<HexData | null>(null)
  const [hexLoading, setHexLoading] = useState(false)
  const [hexError, setHexError] = useState('')
  const [pickerSide, setPickerSide] = useState<'left' | 'right' | null>(null)
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  dirtyRef.current = dirty
  const rememberRef = useRef(onRemember)
  rememberRef.current = onRemember

  const leftKey = locKey(tab.left)
  const rightKey = locKey(tab.right)

  useEffect(() => {
    setViewOverride(null)
    setDirty(false)
    dirtyRef.current = false
    onDirtyChange(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftKey, rightKey])

  useEffect(() => {
    if (!tab.left || !tab.right) {
      setLeftData(null)
      setRightData(null)
      setError('')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    setLeftData(null)
    setRightData(null)
    Promise.all([window.api.readFile(tab.left), window.api.readFile(tab.right)])
      .then(([left, right]) => {
        if (cancelled) return
        setLeftData(left)
        setRightData(right)
        setLoading(false)
        rememberRef.current(tab.left!, tab.right!)
      })
      .catch((err) => {
        if (cancelled) return
        setError(errText(err))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftKey, rightKey, reloadToken])

  const bothText = leftData?.kind === 'text' && rightData?.kind === 'text'
  const autoHex = leftData?.kind === 'binary' || rightData?.kind === 'binary'
  const effectiveView = viewOverride === 'hex' || autoHex ? 'hex' : 'text'

  useEffect(() => {
    if (effectiveView !== 'hex' || !tab.left || !tab.right) {
      setHexData(null)
      setHexError('')
      return
    }
    let cancelled = false
    setHexLoading(true)
    setHexError('')
    Promise.all([
      window.api.readBinary(tab.left, HEX_LIMIT),
      window.api.readBinary(tab.right, HEX_LIMIT)
    ])
      .then(([left, right]) => {
        if (cancelled) return
        setHexData({ left, right })
        setHexLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setHexError(errText(err))
        setHexLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveView, leftKey, rightKey, reloadToken])

  const handleDirty = (value: boolean): void => {
    setDirty(value)
    onDirtyChange(value)
  }

  const applySide = async (side: 'left' | 'right', location: Location): Promise<boolean> => {
    const current = side === 'left' ? tab.left : tab.right
    if (sameLocation(location, current)) {
      setPickerSide(null)
      return true
    }
    if (dirtyRef.current) {
      const ok = await window.api.confirm({
        title: '放弃修改',
        message: '当前文件有未保存的修改，切换文件会丢失这些修改。',
        detail: '继续吗？',
        confirmLabel: '放弃并切换',
        danger: true
      })
      if (!ok) return false
    }
    setDirty(false)
    dirtyRef.current = false
    onDirtyChange(false)
    onChange(side === 'left' ? { left: location } : { right: location })
    setPickerSide(null)
    return true
  }

  const handleReload = async (): Promise<void> => {
    if (dirtyRef.current) {
      const ok = await window.api.confirm({
        title: '重新加载',
        message: '重新加载会丢弃未保存的修改。',
        confirmLabel: '重新加载',
        danger: true
      })
      if (!ok) return
    }
    setDirty(false)
    dirtyRef.current = false
    onDirtyChange(false)
    setReloadToken((value) => value + 1)
  }

  const picker = pickerSide && (
    <PickSideModal
      mode="file"
      title={pickerSide === 'left' ? '选择左侧文件' : '选择右侧文件'}
      initial={pickerSide === 'left' ? tab.left : tab.right}
      connections={connections}
      onClose={() => setPickerSide(null)}
      onConfirm={(location) => {
        void applySide(pickerSide, location)
      }}
      onManageConnections={onManageConnections}
    />
  )

  return (
    <div className="file-compare">
      <LocationBar
        left={tab.left}
        right={tab.right}
        connections={connections}
        itemLabel="文件"
        leftInfo={dataInfo(leftData)}
        rightInfo={dataInfo(rightData)}
        onPick={setPickerSide}
        onApply={applySide}
        notify={notify}
      />

      <div className="pane-toolbar file-toolbar">
        <div className="segmented">
          <button
            type="button"
            className={effectiveView === 'text' ? 'active' : ''}
            disabled={!bothText}
            onClick={() => setViewOverride('text')}
            title="文本差异（可编辑）"
          >
            文本
          </button>
          <button
            type="button"
            className={effectiveView === 'hex' ? 'active' : ''}
            onClick={() => setViewOverride('hex')}
            title="十六进制字节对比"
          >
            十六进制
          </button>
        </div>
        {autoHex && <span className="tag">检测到二进制文件</span>}
        {!autoHex && leftData?.kind === 'text' && (
          <span className="tag subtle">{leftData.encoding.toUpperCase()}</span>
        )}
        <div className="toolbar-spacer" />
        {dirty && <span className="dirty-dot">未保存</span>}
      </div>

      <div className="file-body">
        {!tab.left || !tab.right ? (
          <div className="center-empty">
            <div className="empty-icon">⇄</div>
            <h2>选择两个文件开始比较</h2>
            <p>支持本地文件和 SSH 远端文件，代码文件自动按文本打开，二进制自动使用十六进制视图。</p>
            <div className="empty-actions">
              <button className="btn primary" onClick={() => setPickerSide('left')}>
                选择左侧文件
              </button>
              <button className="btn" onClick={() => setPickerSide('right')}>
                选择右侧文件
              </button>
            </div>
          </div>
        ) : loading ? (
          <div className="center-state">
            <div className="spinner" />
            正在读取文件…
          </div>
        ) : error && effectiveView !== 'hex' ? (
          <div className="center-state error">
            <div>读取失败：{error}</div>
            <button className="btn" onClick={() => setReloadToken((value) => value + 1)}>
              重试
            </button>
            <button className="btn" onClick={() => setViewOverride('hex')}>
              改用十六进制查看前 4MB
            </button>
          </div>
        ) : (
          <>
            {bothText && leftData?.kind === 'text' && rightData?.kind === 'text' && (
              <div
                className="text-host"
                style={{ display: effectiveView === 'text' ? 'flex' : 'none' }}
              >
                <TextDiff
                  left={{ location: tab.left, data: leftData }}
                  right={{ location: tab.right, data: rightData }}
                  active={active && effectiveView === 'text'}
                  theme={theme}
                  reloadToken={reloadToken}
                  onDirtyChange={handleDirty}
                  registerSave={registerSave}
                  onReload={() => void handleReload()}
                  notify={notify}
                />
              </div>
            )}
            {effectiveView === 'hex' && (
              <div className="hex-host">
                {hexLoading ? (
                  <div className="center-state">
                    <div className="spinner" />
                    正在读取二进制数据…
                  </div>
                ) : hexError ? (
                  <div className="center-state error">
                    <div>读取失败：{hexError}</div>
                    <button className="btn" onClick={() => setReloadToken((value) => value + 1)}>
                      重试
                    </button>
                  </div>
                ) : hexData ? (
                  <HexCompare
                    left={{ location: tab.left, data: hexData.left }}
                    right={{ location: tab.right, data: hexData.right }}
                    active={active && effectiveView === 'hex'}
                  />
                ) : null}
              </div>
            )}
          </>
        )}
      </div>
      {picker}
    </div>
  )
}
