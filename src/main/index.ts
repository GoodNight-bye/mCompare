import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { SshManager } from './ssh'
import { RecentStore } from './recent'
import { registerIpc } from './ipc'
import type { LaunchRequest } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let launchRequest: LaunchRequest = { kind: 'none', paths: [] }
let ssh: SshManager | null = null
let rendererReady = false
let allowClose = false
const queuedLaunches: LaunchRequest[] = []

function parseLaunch(argv: string[]): LaunchRequest {
  const candidates: string[] = []
  const appPath = path.resolve(app.getAppPath())

  for (const raw of argv.slice(1)) {
    if (!raw || raw.startsWith('-')) continue
    let resolved: string
    try {
      resolved = path.resolve(raw)
    } catch {
      continue
    }
    if (resolved === appPath) continue
    if (resolved === path.resolve(process.execPath)) continue
    try {
      const st = fs.statSync(resolved)
      if (st.isFile() || st.isDirectory()) candidates.push(resolved)
    } catch {
      /* not a real path (dev flags etc.) */
    }
  }

  const unique = candidates.slice(0, 2)
  if (unique.length === 0) return { kind: 'none', paths: [] }
  if (unique.length === 1) {
    try {
      return {
        kind: fs.statSync(unique[0]).isDirectory() ? 'folder' : 'file',
        paths: unique
      }
    } catch {
      return { kind: 'none', paths: [] }
    }
  }
  try {
    const leftDir = fs.statSync(unique[0]).isDirectory()
    const rightDir = fs.statSync(unique[1]).isDirectory()
    if (leftDir !== rightDir) return { kind: 'none', paths: unique }
    return { kind: leftDir ? 'folder' : 'file', paths: unique }
  } catch {
    return { kind: 'none', paths: [] }
  }
}

function createWindow(): void {
  rendererReady = false
  allowClose = false
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 980,
    minHeight: 620,
    show: false,
    backgroundColor: '#111318',
    title: 'mCompare',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', (event) => {
    if (allowClose || !rendererReady) return
    if (!mainWindow || mainWindow.webContents.isDestroyed()) return
    event.preventDefault()
    mainWindow.webContents.send('app:close-request')
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())

  // A crashed/hung renderer must not leave an unclosable window.
  mainWindow.webContents.on('render-process-gone', () => {
    rendererReady = false
    allowClose = true
  })
  mainWindow.webContents.on('unresponsive', () => {
    allowClose = true
  })
  mainWindow.on('responsive', () => {
    if (rendererReady) allowClose = false
  })

  // Native edit menu for path/filter inputs. Monaco manages its own context menu.
  mainWindow.webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable || !mainWindow) return
    const win = mainWindow
    void win.webContents
      .executeJavaScript(
        `(() => {
          const el = document.elementFromPoint(${params.x}, ${params.y});
          return Boolean(el && el.closest('.monaco-editor'));
        })()`
      )
      .then((isMonaco: boolean) => {
        if (isMonaco || win.isDestroyed()) return
        const flags = params.editFlags
        const template: MenuItemConstructorOptions[] = [
          { label: '撤销', role: 'undo', enabled: flags.canUndo },
          { label: '重做', role: 'redo', enabled: flags.canRedo },
          { type: 'separator' },
          { label: '剪切', role: 'cut', enabled: flags.canCut },
          { label: '复制', role: 'copy', enabled: flags.canCopy },
          { label: '粘贴', role: 'paste', enabled: flags.canPaste },
          { type: 'separator' },
          { label: '全选', role: 'selectAll' }
        ]
        Menu.buildFromTemplate(template).popup({ window: win })
      })
      .catch(() => undefined)
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const request = parseLaunch(argv)
    if (request.kind !== 'none') {
      if (mainWindow && rendererReady) {
        mainWindow.webContents.send('app:launch', request)
      } else {
        queuedLaunches.push(request)
      }
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    launchRequest = parseLaunch(process.argv)
    ssh = new SshManager()
    const recent = new RecentStore()
    registerIpc({
      ssh,
      recent,
      getWindow: () => mainWindow,
      getLaunchRequest: () => launchRequest
    })

    ipcMain.on('app:renderer-ready', () => {
      rendererReady = true
      if (!mainWindow) return
      if (mainWindow.webContents.isDestroyed()) return
      const pending = queuedLaunches.splice(0)
      for (const request of pending) {
        mainWindow.webContents.send('app:launch', request)
      }
    })

    ipcMain.on('app:close-window', () => {
      allowClose = true
      mainWindow?.close()
    })

    Menu.setApplicationMenu(null)
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', () => {
    ssh?.disconnectAll()
  })
}
