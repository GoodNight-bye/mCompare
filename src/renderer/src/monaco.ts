import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

;(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker(_id: string, label: string): Worker {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  }
}

const COMMENT_DARK = '6ea8ff'
const COMMENT_LIGHT = '1d4ed8'
const WHITESPACE_DARK = '4d7fd6'
const WHITESPACE_LIGHT = '7aa7f0'

function tokenRules(comment: string): monaco.editor.ITokenThemeRule[] {
  return [
    { token: 'comment', foreground: comment, fontStyle: 'italic' },
    { token: 'comment.line', foreground: comment, fontStyle: 'italic' },
    { token: 'comment.block', foreground: comment, fontStyle: 'italic' },
    { token: 'comment.doc', foreground: comment, fontStyle: 'italic' },
    { token: 'comment.block.documentation', foreground: comment, fontStyle: 'italic' }
  ]
}

const transparentDiff = {
  'diffEditor.insertedTextBackground': '#00000000',
  'diffEditor.removedTextBackground': '#00000000',
  'diffEditor.insertedLineBackground': '#00000000',
  'diffEditor.removedLineBackground': '#00000000',
  'diffEditor.insertedTextBorder': '#00000000',
  'diffEditor.removedTextBorder': '#00000000',
  'diffEditor.diagonalFill': '#00000000',
  'diffEditorGutter.insertedLineBackground': '#00000000',
  'diffEditorGutter.removedLineBackground': '#00000000',
  'editorOverviewRuler.border': '#00000000'
} as const

monaco.editor.defineTheme('mcompare-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: tokenRules(COMMENT_DARK),
  colors: {
    'editor.background': '#14171d',
    'editor.foreground': '#d7dae0',
    'editorLineNumber.foreground': '#4d5666',
    'editorLineNumber.activeForeground': '#9aa4b5',
    'editor.lineHighlightBackground': '#1a1f28',
    'editor.selectionBackground': '#2b3d5c',
    'editorCursor.foreground': '#7cb0ff',
    'editorWhitespace.foreground': WHITESPACE_DARK,
    'editorGutter.background': '#14171d',
    ...transparentDiff
  }
})

monaco.editor.defineTheme('mcompare-light', {
  base: 'vs',
  inherit: true,
  rules: tokenRules(COMMENT_LIGHT),
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#1f2937',
    'editorLineNumber.foreground': '#9aa3b2',
    'editorLineNumber.activeForeground': '#374151',
    'editor.lineHighlightBackground': '#f5f7fa',
    'editor.selectionBackground': '#cfe3ff',
    'editorCursor.foreground': '#2563eb',
    'editorWhitespace.foreground': WHITESPACE_LIGHT,
    'editorGutter.background': '#ffffff',
    ...transparentDiff
  }
})

export function monacoTheme(theme: 'dark' | 'light'): string {
  return theme === 'dark' ? 'mcompare-dark' : 'mcompare-light'
}

export function setMonacoTheme(theme: 'dark' | 'light'): void {
  monaco.editor.setTheme(monacoTheme(theme))
}

let languageCache: { ext: string; id: string }[] | null = null

export function languageForPath(filePath: string): string {
  if (!languageCache) {
    languageCache = []
    for (const lang of monaco.languages.getLanguages()) {
      for (const extension of lang.extensions || []) {
        languageCache.push({ ext: extension.toLowerCase(), id: lang.id })
      }
    }
  }
  const name = (filePath.split(/[\\/]/).pop() || '').toLowerCase()
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot) : ''
  const found = languageCache.find((item) => item.ext === ext)
  return found?.id || 'plaintext'
}

export { monaco }
