import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { BinaryData, Location } from '../../../shared/types'
import { basename, formatSize } from '../utils'

interface HexSide {
  location: Location
  data: BinaryData
}

interface Props {
  left: HexSide
  right: HexSide
  active: boolean
}

const ROW_HEIGHT = 22
const COLS = 16

function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function asciiOf(byte: number | undefined): string {
  if (byte === undefined) return ''
  return byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.'
}

function hexOf(byte: number | undefined): string {
  if (byte === undefined) return '  '
  return byte.toString(16).padStart(2, '0')
}

export default function HexCompare({ left, right, active }: Props): JSX.Element {
  const leftBytes = useMemo(() => decodeBase64(left.data.base64), [left.data.base64])
  const rightBytes = useMemo(() => decodeBase64(right.data.base64), [right.data.base64])

  const { rowCount, diffRows, diffBytes } = useMemo(() => {
    const max = Math.max(leftBytes.length, rightBytes.length)
    const rows = Math.ceil(max / COLS)
    const indices: number[] = []
    let count = 0
    let lastRow = -1
    for (let offset = 0; offset < max; offset++) {
      const a = offset < leftBytes.length ? leftBytes[offset] : -1
      const b = offset < rightBytes.length ? rightBytes[offset] : -1
      if (a !== b) {
        count++
        const row = offset >> 4
        if (row !== lastRow) {
          indices.push(row)
          lastRow = row
        }
      }
    }
    return { rowCount: rows, diffRows: indices, diffBytes: count }
  }, [leftBytes, rightBytes])

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  const [diffIndex, setDiffIndex] = useState(-1)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight))
    observer.observe(el)
    setViewportHeight(el.clientHeight)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setDiffIndex(-1)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [left.data.base64, right.data.base64])

  const goDiff = (direction: 1 | -1): void => {
    if (diffRows.length === 0) return
    let next = diffIndex
    if (next < 0) next = direction === 1 ? 0 : diffRows.length - 1
    else next = (next + direction + diffRows.length) % diffRows.length
    setDiffIndex(next)
    const top = Math.max(0, (diffRows[next] + 1) * ROW_HEIGHT - ROW_HEIGHT * 3)
    scrollRef.current?.scrollTo({ top, behavior: 'smooth' })
  }

  useEffect(() => {
    if (!active) return
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'F7') {
        event.preventDefault()
        goDiff(event.shiftKey ? -1 : 1)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, diffIndex, diffRows])

  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 6)
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + 12
  const lastRow = Math.min(rowCount - 1, firstRow + visibleCount)
  const rows: JSX.Element[] = []
  for (let row = firstRow; row <= lastRow; row++) {
    rows.push(renderRow(row, leftBytes, rightBytes))
  }

  const truncated = left.data.truncated || right.data.truncated

  return (
    <div className="hex-compare">
      <div className="pane-toolbar">
        <div className="hex-summary">
          差异字节 <b>{diffBytes}</b>
          <span className="sep">·</span>
          差异行 <b>{diffRows.length}</b>
          <span className="sep">·</span>
          左侧 {formatSize(left.data.size)} / 右侧 {formatSize(right.data.size)}
        </div>
        <div className="toolbar-spacer" />
        <button className="btn tiny" onClick={() => goDiff(-1)} title="上一处 (Shift+F7)">
          上一处
        </button>
        <button className="btn tiny" onClick={() => goDiff(1)} title="下一处 (F7)">
          下一处
        </button>
      </div>
      {truncated && (
        <div className="notice">
          文件较大，十六进制视图仅加载前 4MB（左右各自）。文件级差异请使用文件夹对比的内容模式。
        </div>
      )}
      <div
        className="hex-scroll"
        ref={scrollRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div
          className="hex-canvas"
          style={{ height: (rowCount + 1) * ROW_HEIGHT }}
        >
          <div className="hex-row hex-head-row">
            <span className="hex-addr">地址</span>
            <span className="hex-bytes-head">
              左侧 · {basename(left.location.path)}
            </span>
            <span className="hex-ascii-head">ASCII</span>
            <span className="hex-gap" />
            <span className="hex-bytes-head">
              右侧 · {basename(right.location.path)}
            </span>
            <span className="hex-ascii-head">ASCII</span>
          </div>
          {rows}
        </div>
      </div>
    </div>
  )
}

function renderRow(row: number, left: Uint8Array, right: Uint8Array): JSX.Element {
  const offset = row * 16
  const leftBytes: JSX.Element[] = []
  const rightBytes: JSX.Element[] = []
  const leftAscii: JSX.Element[] = []
  const rightAscii: JSX.Element[] = []

  for (let i = 0; i < 16; i++) {
    const index = offset + i
    const a = index < left.length ? left[index] : undefined
    const b = index < right.length ? right[index] : undefined
    const changed = a !== b
    const cls = 'hex-byte' + (changed ? ' diff' : '') + (a === undefined ? ' empty' : '')
    const clsR = 'hex-byte' + (changed ? ' diff' : '') + (b === undefined ? ' empty' : '')
    leftBytes.push(
      <span key={`l${i}`} className={cls}>
        {hexOf(a)}
      </span>
    )
    rightBytes.push(
      <span key={`r${i}`} className={clsR}>
        {hexOf(b)}
      </span>
    )
    leftAscii.push(
      <span key={`la${i}`} className={'hex-char' + (changed ? ' diff' : '')}>
        {asciiOf(a) || ' '}
      </span>
    )
    rightAscii.push(
      <span key={`ra${i}`} className={'hex-char' + (changed ? ' diff' : '')}>
        {asciiOf(b) || ' '}
      </span>
    )
  }

  return (
    <div
      key={row}
      className="hex-row hex-body-row"
      style={{ top: (row + 1) * ROW_HEIGHT }}
    >
      <span className="hex-addr">{offset.toString(16).toUpperCase().padStart(8, '0')}</span>
      <span className="hex-bytes">{leftBytes}</span>
      <span className="hex-ascii">{leftAscii}</span>
      <span className="hex-gap">│</span>
      <span className="hex-bytes">{rightBytes}</span>
      <span className="hex-ascii">{rightAscii}</span>
    </div>
  )
}
