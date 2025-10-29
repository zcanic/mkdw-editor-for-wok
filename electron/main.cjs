'use strict'

const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const fsPromises = require('fs/promises')

let mainWindow = null
let currentFilePath = null

const APP_NAME = 'WOK Editor'
const isMac = process.platform === 'darwin'
const isDev = !app.isPackaged

const fileFilters = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
  { name: 'All Files', extensions: ['*'] }
]

function resolvePreloadPath() {
  const defaultPath = path.join(__dirname, 'preload.cjs')
  if (!app || !app.isPackaged) {
    return defaultPath
  }

  const packagedPath = path.join(app.getAppPath(), 'electron', 'preload.cjs')
  return fs.existsSync(packagedPath) ? packagedPath : defaultPath
}

function resolveIndexHtml() {
  const candidates = []

  if (app && app.isPackaged) {
    candidates.push(path.join(app.getAppPath(), 'dist', 'index.html'))
    candidates.push(path.join(process.resourcesPath, 'dist', 'index.html'))
  }

  candidates.push(path.join(__dirname, '../dist/index.html'))

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }

  return candidates[candidates.length - 1]
}

function registerWindowDiagnostics(windowInstance) {
  if (!windowInstance) return

  windowInstance.webContents.on('did-finish-load', () => {
    if (isDev) {
      console.info('[main] Renderer finished load:', windowInstance.webContents.getURL())
    }
  })

  windowInstance.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      console.error('[main] Renderer failed to load', {
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame
      })
    }
  )

  windowInstance.webContents.on('render-process-gone', (_event, details) => {
    console.error('[main] Renderer process gone:', details)
  })

  windowInstance.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const levelMap = {
      0: 'log',
      1: 'warn',
      2: 'error'
    }
    const method = levelMap[level] || 'log'
    if (!isDev && method === 'log') {
      return
    }

    console[method](`(renderer) ${message} (${sourceId}:${line})`)
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#ffffff',
    title: APP_NAME,
    webPreferences: {
      preload: resolvePreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  })

  // 开发环境使用 Vite Dev Server，发行包加载打包后的 HTML
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    const indexHtmlPath = resolveIndexHtml()
    if (isDev) {
      console.info('[main] Loading renderer from:', indexHtmlPath)
    }
    mainWindow.loadFile(indexHtmlPath)
  }

  if (isDev && mainWindow?.webContents) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }
  updateWindowTitle()
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  registerWindowDiagnostics(mainWindow)
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channel, payload)
}

function updateWindowTitle() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const suffix = currentFilePath ? ` - ${path.basename(currentFilePath)}` : ''
  mainWindow.setTitle(`${APP_NAME}${suffix}`)
  if (isMac) {
    mainWindow.setRepresentedFilename(currentFilePath || '')
    mainWindow.setDocumentEdited(false)
  }
}

async function handleOpenFileDialog() {
  if (!mainWindow) return
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: fileFilters
  })

  if (canceled || filePaths.length === 0) {
    return
  }

  const filePath = filePaths[0]
  try {
    const content = await fsPromises.readFile(filePath, 'utf8')
    currentFilePath = filePath
    updateWindowTitle()
    sendToRenderer('menu:open-file', { filePath, content })
  } catch (error) {
    dialog.showErrorBox('打开文件失败', error.message)
  }
}

function handleNewFile() {
  currentFilePath = null
  updateWindowTitle()
  sendToRenderer('menu:new-file')
}

async function writeContentToFile(targetPath, content) {
  await fsPromises.mkdir(path.dirname(targetPath), { recursive: true })
  await fsPromises.writeFile(targetPath, content, 'utf8')
}

async function ensureSavePath(defaultPath) {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath,
    filters: fileFilters
  })

  if (canceled || !filePath) {
    return null
  }

  return filePath
}

function buildMenuTemplate() {
  const fileSubmenu = [
    {
      label: '新建文件',
      accelerator: 'CmdOrCtrl+N',
      click: handleNewFile
    },
    {
      label: '打开…',
      accelerator: 'CmdOrCtrl+O',
      click: () => {
        handleOpenFileDialog()
      }
    },
    { type: 'separator' },
    {
      label: '保存',
      accelerator: 'CmdOrCtrl+S',
      click: () => {
        sendToRenderer('menu:save-file')
      }
    },
    {
      label: '另存为…',
      accelerator: 'Shift+CmdOrCtrl+S',
      click: () => {
        sendToRenderer('menu:save-as-file')
      }
    },
    { type: 'separator' },
    isMac ? { role: 'close' } : { role: 'quit' }
  ]

  const template = [
    ...(isMac
      ? [{
        role: 'appMenu',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      }]
      : []),
    { label: '文件', submenu: fileSubmenu },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]

  return template
}

function registerIpcHandlers() {
  ipcMain.handle('file:save', async (_event, content) => {
    try {
      let targetPath = currentFilePath
      if (!targetPath) {
        targetPath = await ensureSavePath(currentFilePath || undefined)
        if (!targetPath) {
          return { success: false, canceled: true }
        }
      }

      await writeContentToFile(targetPath, content)
      currentFilePath = targetPath
      updateWindowTitle()
      return { success: true, filePath: targetPath }
    } catch (error) {
      console.error('保存文件失败:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle('file:save-as', async (_event, content) => {
    try {
      const targetPath = await ensureSavePath(currentFilePath || undefined)
      if (!targetPath) {
        return { success: false, canceled: true }
      }

      await writeContentToFile(targetPath, content)
      currentFilePath = targetPath
      updateWindowTitle()
      return { success: true, filePath: targetPath }
    } catch (error) {
      console.error('另存为失败:', error)
      return { success: false, error: error.message }
    }
  })

  ipcMain.on('file:set-dirty', (_event, isDirty) => {
    if (isMac && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setDocumentEdited(Boolean(isDirty))
    }
  })
}

app.whenReady().then(() => {
  createWindow()
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate()))
  registerIpcHandlers()

  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit()
  }
})

app.on('open-file', (_event, filePath) => {
  if (!filePath) return
  if (mainWindow === null) {
    createWindow()
  }
  setTimeout(async () => {
    try {
      const content = await fsPromises.readFile(filePath, 'utf8')
      currentFilePath = filePath
      updateWindowTitle()
      sendToRenderer('menu:open-file', { filePath, content })
    } catch (error) {
      dialog.showErrorBox('打开文件失败', error.message)
    }
  }, 100)
})

process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error)
})
