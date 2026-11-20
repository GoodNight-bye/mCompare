import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { Location, TextFileResult } from '../../../shared/types'
import type { Notify } from '../tabs'
import { languageForPath, monaco, monacoTheme } from '../monaco'
import { useSetting } from '../settings'
import { errText, formatSize, locKey } from '../utils'
import OverviewStrip, { type DiffBlock } from './OverviewStrip'

export interface TextSideRef {
  location: Location
  data: TextFileResult
}

interface Props {
  left: TextSideRef
  right: TextSideRef
  active: boolean
  theme: 'dark' | 'light'
  reloadToken: number
  onDirtyChange: (dirty: boolean) => void
  registerSave: (fn: (() => Promise<void>) | null) => void
  onReload: () => void
  notify: Notify
}

function getLines(model: monaco.editor.ITextModel, start: number, end: number): string[] {
  const out: string[] = []
  if (start <= 0 || end < start) return out
  const last = Math.min(end, model.getLineCount())
  for (let line = start; line <= last; line++) out.push(model.getLineContent(line))
  return out
}

function lineSignatures(lines: string[], language: string): string[] {
  if (lines.length === 0) return []
  let tokenized: monaco.Token[][] = []
  try {
    tokenized = monaco.editor.tokenize(lines.join('\n'), language)
  } catch {
    tokenized = []
  }
  return lines.map((line, index) => {
    const tokens = tokenized[index] || []
    if (tokens.length === 0) {
      return line.trim().replace(/\s+/g, ' ')
    }
    const hasType = tokens.some((token) => Boolean(token.type))
    if (!hasType) {
      return line.trim().replace(/\s+/g, ' ')
    }
    let signature = ''
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]
      const end = i + 1 < tokens.length ? tokens[i + 1].offset : line.length
      const type = token.type || ''
      if (type.includes('comment') || type.includes('white')) continue
      const text = line.slice(token.offset, end).trim()
      if (text) signature += text + '\u0001'
    }
    return signature
  })
}

export default function TextDiff(props: Props): JSX.Element {
  const { left, right, active, theme, onDirtyChange, registerSave, onReload, notify, reloadToken } =
    props
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const needsCollapseRef = useRef(false)
  const actionsRef = useRef<{
    save: (which: 'left' | 'right' | 'both') => Promise<void>
    copyTo: (target: 'left' | 'right') => Promise<void>
    next: () => void
    prev: () => void
    jump: (line: number) => void
  } | null>(null)
  const savedRef = useRef({ left: left.data.text, right: right.data.text })
  const leftLocKey = locKey(left.location)
  const rightLocKey = locKey(right.location)
  const callbacksRef = useRef({ onDirtyChange, registerSave, notify })
  callbacksRef.current = { onDirtyChange, registerSave, notify }

  const [dirtyLeft, setDirtyLeft] = useState(false)
  const [dirtyRight, setDirtyRight] = useState(false)
  const [showWhitespace, setShowWhitespace] = useSetting('text.showWhitespace', false)
  const [sideBySide, setSideBySide] = useSetting('text.sideBySide', true)
  const [showLineNumbers, setShowLineNumbers] = useSetting('text.showLineNumbers', true)
  const [diffOnly, setDiffOnly] = useSetting('text.diffOnly', false)
  const [contextLines, setContextLines] = useSetting('text.contextLines', 3)
  const effectiveContext = [0, 1, 2, 3, 5, 10].includes(contextLines) ? contextLines : 3
  const [hasLineDiffs, setHasLineDiffs] = useState(true)
  const [blocks, setBlocks] = useState<DiffBlock[]>([])
  const [totalLines, setTotalLines] = useState(1)

  const eolLeft = left.data.text.includes('\r\n') ? 'CRLF' : 'LF'
  const eolRight = right.data.text.includes('\r\n') ? 'CRLF' : 'LF'
  const eolDiff = eolLeft !== eolRight
  const encodingDiff = left.data.encoding !== right.data.encoding
  const sizeDiff = left.data.size !== right.data.size
  const byteLevelDiff = eolDiff || encodingDiff || sizeDiff

  const pushDirty = useCallback((dirtyL: boolean, dirtyR: boolean) => {
    setDirtyLeft(dirtyL)
    setDirtyRight(dirtyR)
    callbacksRef.current.onDirtyChange(dirtyL || dirtyR)
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const langLeft = languageForPath(left.location.path)
    const langRight = languageForPath(right.location.path)
    const original = monaco.editor.createModel(left.data.text, langLeft)
    const modified = monaco.editor.createModel(right.data.text, langRight)
    savedRef.current = { left: left.data.text, right: right.data.text }

    const editor = monaco.editor.createDiffEditor(host, {
      theme: monacoTheme(theme),
      automaticLayout: true,
      originalEditable: true,
      renderWhitespace: showWhitespace ? 'all' : 'selection',
      renderSideBySide: sideBySide,
      lineNumbers: showLineNumbers ? 'on' : 'off',
      hideUnchangedRegions: diffOnly
        ? {
            enabled: true,
            contextLineCount: effectiveContext,
            minimumLineCount: effectiveContext + 2,
            revealLineCount: effectiveContext + 2
          }
        : { enabled: false },
      renderOverviewRuler: false,
      renderIndicators: false,
      ignoreTrimWhitespace: false,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      glyphMargin: true,
      lineNumbersMinChars: 4,
      fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 21,
      smoothScrolling: true,
      diffAlgorithm: 'advanced',
      wordWrap: 'off',
      fixedOverflowWidgets: true,
      scrollbar: { verticalScrollbarSize: 12, horizontalScrollbarSize: 12 }
    })
    editor.setModel({ original, modified })
    editorRef.current = editor

    const origEditor = editor.getOriginalEditor()
    const modEditor = editor.getModifiedEditor()
    const lineNumbers = showLineNumbers ? 'on' : 'off'
    origEditor.updateOptions({ lineNumbers })
    modEditor.updateOptions({ lineNumbers })
    const origDecorations = origEditor.createDecorationsCollection([])
    const modDecorations = modEditor.createDecorationsCollection([])

    const applyDecorations = (): void => {
      const changes = editor.getLineChanges() || []
      const origDecos: monaco.editor.IModelDeltaDecoration[] = []
      const modDecos: monaco.editor.IModelDeltaDecoration[] = []
      const nextBlocks: DiffBlock[] = []

      for (const change of changes) {
        const oStart = change.originalStartLineNumber
        const oEnd = change.originalEndLineNumber
        const mStart = change.modifiedStartLineNumber
        const mEnd = change.modifiedEndLineNumber
        const origLines = getLines(original, oStart, oEnd)
        const modLines = getLines(modified, mStart, mEnd)
        const origSigs = lineSignatures(origLines, langLeft)
        const modSigs = lineSignatures(modLines, langRight)
        // 0 = unchanged, 1 = comment/formatting only (blue), 2 = code change (red)
        const origFlags = new Array<LineMark>(origLines.length).fill(0)
        const modFlags = new Array<LineMark>(modLines.length).fill(0)
        const paired = Math.min(origLines.length, modLines.length)
        for (let i = 0; i < paired; i++) {
          if (origLines[i] === modLines[i]) continue
          const important = origSigs[i] !== modSigs[i]
          const mark: LineMark = important ? 2 : 1
          origFlags[i] = mark
          modFlags[i] = mark
        }
        for (let i = paired; i < origLines.length; i++) {
          origFlags[i] = origSigs[i].length > 0 ? 2 : 1
        }
        for (let i = paired; i < modLines.length; i++) {
          modFlags[i] = modSigs[i].length > 0 ? 2 : 1
        }

        addRangeDecorations(origDecos, oStart, origFlags)
        addRangeDecorations(modDecos, mStart, modFlags)

        const blockStart = mStart > 0 ? mStart : oStart
        const blockEnd = mEnd > 0 ? mEnd : oEnd
        if (blockStart > 0) {
          nextBlocks.push({
            start: blockStart,
            end: Math.max(blockStart, blockEnd),
            important: [...origFlags, ...modFlags].some((mark) => mark === 2)
          })
        }
      }

      origDecorations.set(origDecos)
      modDecorations.set(modDecos)
      setBlocks(nextBlocks)
      setHasLineDiffs(changes.length > 0)
      setTotalLines(Math.max(original.getLineCount(), modified.getLineCount(), 1))
    }

    const lastDirty = { left: false, right: false }
    let decorationTimer = 0
    const syncDirty = (): void => {
      const dl = original.getValue() !== savedRef.current.left
      const dr = modified.getValue() !== savedRef.current.right
      if (dl !== lastDirty.left || dr !== lastDirty.right) {
        lastDirty.left = dl
        lastDirty.right = dr
        pushDirty(dl, dr)
      }
    }
    const scheduleDecorations = (): void => {
      window.clearTimeout(decorationTimer)
      decorationTimer = window.setTimeout(applyDecorations, 180)
    }
    const onContentChanged = (): void => {
      syncDirty()
      scheduleDecorations()
    }

    const saveSide = async (which: 'left' | 'right' | 'both'): Promise<void> => {
      const l = original.getValue()
      const r = modified.getValue()
      const saveLeft = which !== 'right' && l !== savedRef.current.left
      const saveRight = which !== 'left' && r !== savedRef.current.right
      if (!saveLeft && !saveRight) return
      const remoteTargets: string[] = []
      if (saveLeft && left.location.kind === 'remote') remoteTargets.push(left.location.path)
      if (saveRight && right.location.kind === 'remote') remoteTargets.push(right.location.path)
      if (remoteTargets.length > 0) {
        const confirmed = await window.api.confirm({
          title: '写入远端文件',
          message: '将修改保存回远端服务器？',
          detail: remoteTargets.join('\n'),
          confirmLabel: '覆盖写入',
          danger: true
        })
        if (!confirmed) throw new Error('SAVE_CANCELLED')
      }
      const jobs: Promise<void>[] = []
      if (saveLeft) {
        jobs.push(window.api.writeTextFile(left.location, l, left.data.encoding, left.data.bom))
      }
      if (saveRight) {
        jobs.push(window.api.writeTextFile(right.location, r, right.data.encoding, right.data.bom))
      }
      const results = await Promise.allSettled(jobs)
      const failed = results.find((result) => result.status === 'rejected')
      if (saveLeft && results[0]?.status === 'fulfilled') savedRef.current.left = l
      if (saveRight) {
        const index = saveLeft ? 1 : 0
        if (results[index]?.status === 'fulfilled') savedRef.current.right = r
      }
      syncDirty()
      if (failed && failed.status === 'rejected') throw failed.reason
      callbacksRef.current.notify('文件已保存', 'success')
    }

    const copyTo = async (target: 'left' | 'right'): Promise<void> => {
      const from = target === 'right' ? original : modified
      const to = target === 'right' ? modified : original
      const text = from.getValue()
      if (text === to.getValue()) {
        callbacksRef.current.notify('两侧内容已经相同', 'info')
        return
      }
      to.pushEditOperations(
        [],
        [{ range: to.getFullModelRange(), text }],
        () => null
      )
      ;(target === 'right' ? modEditor : origEditor).focus()
      callbacksRef.current.notify('已复制，保存后写入目标文件', 'success')
    }

    const jump = (line: number): void => {
      const model = modified
      const target = Math.max(1, Math.min(line, model.getLineCount()))
      modEditor.revealLineInCenter(target)
      modEditor.setPosition({ lineNumber: target, column: 1 })
      modEditor.focus()
    }

    actionsRef.current = {
      save: saveSide,
      copyTo,
      next: () => editor.goToDiff('next'),
      prev: () => editor.goToDiff('previous'),
      jump
    }

    const saveAll = (): Promise<void> => saveSide('both')
    callbacksRef.current.registerSave(saveAll)

    const diffListener = editor.onDidUpdateDiff(() => {
      applyDecorations()
      if (needsCollapseRef.current) {
        needsCollapseRef.current = false
        try {
          ;(editor as unknown as { collapseAllUnchangedRegions?: () => void }).collapseAllUnchangedRegions?.()
        } catch {
          /* ignore Monaco internal API failures */
        }
      }
    })
    const origContent = original.onDidChangeContent(onContentChanged)
    const modContent = modified.onDidChangeContent(onContentChanged)
    const initialTimer = window.setTimeout(applyDecorations, 220)

    lastDirty.left = false
    lastDirty.right = false
    pushDirty(false, false)

    return () => {
      window.clearTimeout(decorationTimer)
      window.clearTimeout(initialTimer)
      callbacksRef.current.registerSave(null)
      actionsRef.current = null
      diffListener.dispose()
      origContent.dispose()
      modContent.dispose()
      origDecorations.clear()
      modDecorations.clear()
      editor.dispose()
      original.dispose()
      modified.dispose()
      editorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftLocKey, rightLocKey, reloadToken])

  useEffect(() => {
    editorRef.current?.updateOptions({
      renderWhitespace: showWhitespace ? 'all' : 'selection',
      renderSideBySide: sideBySide
    })
  }, [showWhitespace, sideBySide])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (!diffOnly) {
      needsCollapseRef.current = false
      editor.updateOptions({ hideUnchangedRegions: { enabled: false } })
      return
    }
    needsCollapseRef.current = true
    editor.updateOptions({
      hideUnchangedRegions: {
        enabled: true,
        contextLineCount: effectiveContext,
        minimumLineCount: effectiveContext + 2,
        revealLineCount: effectiveContext + 2
      }
    })
    // Monaco keeps manually-revealed regions when the context count shrinks.
    // Collapse them after the new diff has been computed so both directions work.
    const timer = window.setTimeout(() => {
      if (!needsCollapseRef.current) return
      needsCollapseRef.current = false
      try {
        ;(editor as unknown as { collapseAllUnchangedRegions?: () => void }).collapseAllUnchangedRegions?.()
      } catch {
        /* ignore Monaco internal API failures */
      }
    }, 350)
    return () => window.clearTimeout(timer)
  }, [diffOnly, effectiveContext])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const lineNumbers = showLineNumbers ? 'on' : 'off'
    editor.getOriginalEditor().updateOptions({ lineNumbers })
    editor.getModifiedEditor().updateOptions({ lineNumbers })
  }, [showLineNumbers])

  useEffect(() => {
    monaco.editor.setTheme(monacoTheme(theme))
  }, [theme])

  useEffect(() => {
    if (!active) return
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'F7') {
        event.preventDefault()
        if (event.shiftKey) actionsRef.current?.prev()
        else actionsRef.current?.next()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [active])

  const doCopy = (target: 'left' | 'right'): void => {
    actionsRef.current?.copyTo(target).catch((err) => {
      callbacksRef.current.notify('复制失败: ' + errText(err), 'error')
    })
  }

  const doSave = (which: 'left' | 'right' | 'both'): void => {
    actionsRef.current?.save(which).catch((err) => {
      if (errText(err) === 'SAVE_CANCELLED') return
      callbacksRef.current.notify('保存失败: ' + errText(err), 'error')
    })
  }

  return (
    <div className="text-compare">
      <div className="pane-toolbar">
        <div className="legend">
          <span className="legend-dot important" />
          代码差异
          <span className="legend-dot unimportant" />
          注释/排版差异
        </div>
        {eolDiff && (
          <span className="tag warn" title={`行尾符不同：左 ${eolLeft} / 右 ${eolRight}`}>
            EOL {eolLeft}/{eolRight}
          </span>
        )}
        {encodingDiff && (
          <span className="tag warn" title="两侧编码不同，字节层面可能不同">
            编码 {left.data.encoding.toUpperCase()}/{right.data.encoding.toUpperCase()}
          </span>
        )}
        <div className="toolbar-spacer" />
        <div className="segmented">
          <button
            type="button"
            className={!diffOnly ? 'active' : ''}
            onClick={() => setDiffOnly(false)}
            title="显示完整文件内容"
          >
            全部
          </button>
          <button
            type="button"
            className={diffOnly ? 'active' : ''}
            onClick={() => setDiffOnly(true)}
            title="隐藏未修改区域，只保留差异及其上下文"
          >
            仅差异
          </button>
        </div>
        {diffOnly && (
          <label className="check context-select">
            上下文
            <select
              value={effectiveContext}
              onChange={(event) => setContextLines(Number(event.target.value))}
            >
              {[0, 1, 2, 3, 5, 10].map((value) => (
                <option key={value} value={value}>
                  {value} 行
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={showLineNumbers}
            onChange={(event) => setShowLineNumbers(event.target.checked)}
          />
          行号
        </label>
        <button className="btn tiny" onClick={() => actionsRef.current?.prev()} title="上一处 (Shift+F7)">
          上一处
        </button>
        <button className="btn tiny" onClick={() => actionsRef.current?.next()} title="下一处 (F7)">
          下一处
        </button>
        <label className="check">
          <input
            type="checkbox"
            checked={showWhitespace}
            onChange={(event) => setShowWhitespace(event.target.checked)}
          />
          显示空白
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={sideBySide}
            onChange={(event) => setSideBySide(event.target.checked)}
          />
          并排
        </label>
        <button className="btn tiny" onClick={onReload}>
          重新加载
        </button>
        <button
          className="btn tiny"
          onClick={() => doCopy('right')}
          title="把左侧内容复制到右侧编辑器（保存后写入右侧文件）"
        >
          左 → 右
        </button>
        <button
          className="btn tiny"
          onClick={() => doCopy('left')}
          title="把右侧内容复制到左侧编辑器（保存后写入左侧文件）"
        >
          右 → 左
        </button>
        <button className="btn tiny" disabled={!dirtyLeft} onClick={() => doSave('left')}>
          保存左侧
        </button>
        <button className="btn tiny" disabled={!dirtyRight} onClick={() => doSave('right')}>
          保存右侧
        </button>
        <button
          className="btn tiny primary"
          disabled={!dirtyLeft && !dirtyRight}
          onClick={() => doSave('both')}
        >
          全部保存
        </button>
      </div>
      {!hasLineDiffs && (
        <div className={'diff-notice ' + (byteLevelDiff ? 'warn' : 'ok')}>
          {byteLevelDiff ? (
            <>
              按文本比较未发现行差异，但字节层面可能不同：左侧 {formatSize(left.data.size)}（
              {left.data.encoding.toUpperCase()}，{eolLeft}） / 右侧 {formatSize(right.data.size)}（
              {right.data.encoding.toUpperCase()}，{eolRight}）。可切换到“十六进制”查看字节差异。
            </>
          ) : (
            <>文本内容一致。</>
          )}
        </div>
      )}
      <div className="editor-wrap">
        <div className="editor-host" ref={hostRef} />
        <OverviewStrip
          blocks={blocks}
          totalLines={totalLines}
          onJump={(line) => actionsRef.current?.jump(line)}
        />
      </div>
    </div>
  )
}

type LineMark = 0 | 1 | 2

function addRangeDecorations(
  out: monaco.editor.IModelDeltaDecoration[],
  startLine: number,
  flags: LineMark[]
): void {
  if (startLine <= 0 || flags.length === 0) return
  let index = 0
  while (index < flags.length) {
    const mark = flags[index]
    let end = index + 1
    while (end < flags.length && flags[end] === mark) end++
    if (mark !== 0) {
      const important = mark === 2
      out.push({
        range: new monaco.Range(startLine + index, 1, startLine + end - 1, 1),
        options: {
          isWholeLine: true,
          className: important ? 'mc-line-important' : 'mc-line-unimportant',
          linesDecorationsClassName: important ? 'mc-gutter-important' : 'mc-gutter-unimportant'
        }
      })
    }
    index = end
  }
}
