'use strict'

const { app, BrowserWindow, Menu, dialog, ipcMain, globalShortcut } = require('electron')
const path = require('path')
const fs = require('fs')
const fsPromises = require('fs/promises')

let mainWindow = null
let currentFilePath = null
let ipcHandlersRegistered = false
let hasUnsavedChanges = false
let pendingQuitAfterSave = false
let isAppQuitting = false

const APP_NAME = 'WOK Editor'
const isMac = process.platform === 'darwin'
const isDev = !app.isPackaged
const MAX_RENDERER_FILE_SIZE = 10 * 1024 * 1024

const fileFilters = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'txt'] },
  { name: 'All Files', extensions: ['*'] }
]

const forbiddenPathPrefixes = (isMac
  ? ['/System/', '/private/', '/etc/']
  : ['C:/Windows', 'C:/Program Files', 'C:/Program Files (x86)', 'C:/Windows/System32']
)
  .map((prefix) => path.normalize(prefix).toLowerCase())

function assertSafeFilePath(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') {
    const error = new Error('无效的文件路径')
    error.code = 'INVALID_PATH'
    throw error
  }

  const normalized = path.resolve(targetPath)
  const lowerCased = normalized.toLowerCase()

  for (const forbiddenPrefix of forbiddenPathPrefixes) {
    if (lowerCased.startsWith(forbiddenPrefix)) {
      const error = new Error('出于安全考虑，禁止访问系统目录中的文件')
      error.code = 'FORBIDDEN_PATH'
      error.path = normalized
      throw error
    }
  }

  return normalized
}

function translateFileSystemError(error) {
  if (!error || typeof error !== 'object') {
    return '未知错误，请重试'
  }

  switch (error.code) {
    case 'ENOENT':
      return '文件不存在或已被移动'
    case 'EACCES':
    case 'EPERM':
      return '没有访问权限，请检查文件权限'
    case 'EISDIR':
      return '目标是文件夹，请选择 Markdown 文件'
    case 'EMFILE':
      return '打开文件过多，请稍后重试'
    case 'FORBIDDEN_PATH':
      return '出于安全考虑，禁止直接打开系统目录中的文件'
    case 'INVALID_PATH':
      return '无效的文件路径'
    case 'FILE_TOO_LARGE':
      return '文件大小超过允许的上限'
    default:
      return error.message || '未知错误，请重试'
  }
}

function buildErrorResponse(error) {
  const message = translateFileSystemError(error)
  const code = error && typeof error.code === 'string' ? error.code : 'UNKNOWN'
  return {
    success: false,
    error: message,
    code,
    stack: isDev && error && typeof error.stack === 'string' ? error.stack : undefined
  }
}

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
      sandbox: false // 预加载脚本依赖 Node 模块构建 contextBridge，迁移到纯 sandbox 方案后再开启
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
    currentFilePath = null
  })
  mainWindow.on('focus', updateWindowTitle)
  mainWindow.on('close', (event) => {
    if (isAppQuitting || !hasUnsavedChanges) {
      return
    }

    event.preventDefault()
    pendingQuitAfterSave = false

    dialog
      .showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['保存并退出', '放弃更改', '取消'],
        defaultId: 0,
        cancelId: 2,
        title: '未保存的更改',
        message: '当前文档包含未保存的更改。',
        detail: '选择“保存并退出”可在关闭前保存，或选择“放弃更改”直接关闭并丢弃修改。'
      })
      .then(({ response }) => {
        if (!mainWindow || mainWindow.isDestroyed()) {
          return
        }

        if (response === 0) {
          pendingQuitAfterSave = true
          sendToRenderer('menu:save-file', { reason: 'before-close' })
        } else if (response === 1) {
          hasUnsavedChanges = false
          pendingQuitAfterSave = false
          isAppQuitting = true
          mainWindow.close()
        }
      })
      .catch((error) => {
        console.error('关闭窗口确认对话框失败:', error)
      })
  })

  registerWindowDiagnostics(mainWindow)
}

function toggleDevTools(windowInstance) {
  if (!windowInstance || windowInstance.isDestroyed()) {
    return
  }

  const { webContents } = windowInstance
  if (!webContents) {
    return
  }

  if (webContents.isDevToolsOpened()) {
    webContents.closeDevTools()
  } else {
    webContents.openDevTools({ mode: 'detach' })
  }
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channel, payload)
}

async function ensureWindowReady() {
  if (!app.isReady()) {
    try {
      await app.whenReady()
    } catch (error) {
      console.error('等待应用就绪时失败:', error)
      return null
    }
  }

  if (mainWindow === null) {
    createWindow()
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    return null
  }

  const { webContents } = mainWindow
  if (webContents && webContents.isLoading()) {
    await new Promise((resolve) => {
      const resolveOnce = () => {
        webContents.removeListener('destroyed', resolveOnce)
        resolve()
      }
      webContents.once('did-finish-load', resolveOnce)
      webContents.once('destroyed', resolveOnce)
    })
  }

  return mainWindow
}

async function readRendererFile(filePath, { skipValidation = false } = {}) {
  const normalizedPath = skipValidation ? path.resolve(filePath) : assertSafeFilePath(filePath)
  const stats = await fsPromises.stat(normalizedPath)
  if (stats.size > MAX_RENDERER_FILE_SIZE) {
    const error = new Error('文件大小超过允许的上限')
    error.code = 'FILE_TOO_LARGE'
    error.size = stats.size
    throw error
  }
  return fsPromises.readFile(normalizedPath, 'utf8')
}

function updateWindowTitle() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const suffix = currentFilePath ? ` - ${path.basename(currentFilePath)}` : ''
  const dirtyPrefix = hasUnsavedChanges ? '* ' : ''
  mainWindow.setTitle(`${dirtyPrefix}${APP_NAME}${suffix}`)
  if (isMac) {
    mainWindow.setRepresentedFilename(currentFilePath || '')
    mainWindow.setDocumentEdited(Boolean(hasUnsavedChanges))
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
    const normalizedPath = assertSafeFilePath(filePath)
  const content = await readRendererFile(normalizedPath, { skipValidation: true })
    currentFilePath = normalizedPath
    hasUnsavedChanges = false
    pendingQuitAfterSave = false
    updateWindowTitle()
    sendToRenderer('menu:open-file', { filePath: normalizedPath, content })
  } catch (error) {
    if (error.code === 'FILE_TOO_LARGE') {
      const sizeInMb = (error.size / (1024 * 1024)).toFixed(1)
      dialog.showErrorBox('打开文件失败', `文件大小为 ${sizeInMb} MB，超过 ${MAX_RENDERER_FILE_SIZE / (1024 * 1024)} MB 限制。`)
    } else {
      dialog.showErrorBox('打开文件失败', translateFileSystemError(error))
    }
  }
}

function handleNewFile() {
  currentFilePath = null
  hasUnsavedChanges = false
  pendingQuitAfterSave = false
  updateWindowTitle()
  sendToRenderer('menu:new-file')
}

async function writeContentToFile(targetPath, content) {
  const normalizedPath = assertSafeFilePath(targetPath)
  await fsPromises.mkdir(path.dirname(normalizedPath), { recursive: true })
  await fsPromises.writeFile(normalizedPath, content, 'utf8')
  return normalizedPath
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
  if (ipcHandlersRegistered) {
    return
  }
  ipcHandlersRegistered = true

  ipcMain.handle('file:save', async (_event, content) => {
    try {
      let targetPath = currentFilePath
      if (!targetPath) {
        targetPath = await ensureSavePath(currentFilePath || undefined)
        if (!targetPath) {
          return { success: false, canceled: true }
        }
      }

      const normalizedPath = await writeContentToFile(targetPath, content)
      currentFilePath = normalizedPath
      hasUnsavedChanges = false
      pendingQuitAfterSave = false
      updateWindowTitle()
      return { success: true, filePath: normalizedPath }
    } catch (error) {
      console.error('保存文件失败:', error)
      return buildErrorResponse(error)
    }
  })

  ipcMain.handle('file:save-as', async (_event, content) => {
    try {
      const targetPath = await ensureSavePath(currentFilePath || undefined)
      if (!targetPath) {
        return { success: false, canceled: true }
      }

      const normalizedPath = await writeContentToFile(targetPath, content)
      currentFilePath = normalizedPath
      hasUnsavedChanges = false
      pendingQuitAfterSave = false
      updateWindowTitle()
      return { success: true, filePath: normalizedPath }
    } catch (error) {
      console.error('另存为失败:', error)
      return buildErrorResponse(error)
    }
  })

  ipcMain.on('file:set-dirty', (_event, isDirty) => {
    hasUnsavedChanges = Boolean(isDirty)
    updateWindowTitle()

    if (!hasUnsavedChanges && pendingQuitAfterSave) {
      pendingQuitAfterSave = false
      if (mainWindow && !mainWindow.isDestroyed()) {
        isAppQuitting = true
        setImmediate(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.close()
          }
        })
      }
    }
  })
}

app.whenReady().then(() => {
  createWindow()
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate()))
  registerIpcHandlers()

  const registerDevToolsShortcuts = () => {
    const shortcuts = new Set()
    shortcuts.add('F12')
    shortcuts.add(isMac ? 'CommandOrControl+Option+I' : 'Control+Shift+I')

    shortcuts.forEach((accelerator) => {
      try {
        const success = globalShortcut.register(accelerator, () => toggleDevTools(mainWindow))
        if (!success && isDev) {
          console.warn(`Failed to register global shortcut: ${accelerator}`)
        }
      } catch (error) {
        console.error(`注册快捷键 ${accelerator} 失败:`, error)
      }
    })
  }

  registerDevToolsShortcuts()

  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow()
    }
    registerIpcHandlers()
  })
})

app.on('before-quit', () => {
  isAppQuitting = true
  pendingQuitAfterSave = false
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (!isMac) {
    app.quit()
  }
})

app.on('open-file', (_event, filePath) => {
  if (!filePath) return
  ;(async () => {
    try {
      const windowRef = await ensureWindowReady()
      if (!windowRef || windowRef.isDestroyed()) {
        return
      }

      const normalizedPath = assertSafeFilePath(filePath)
  const content = await readRendererFile(normalizedPath, { skipValidation: true })
      currentFilePath = normalizedPath
      hasUnsavedChanges = false
      pendingQuitAfterSave = false
      updateWindowTitle()
      sendToRenderer('menu:open-file', { filePath: normalizedPath, content })
    } catch (error) {
      if (error.code === 'FILE_TOO_LARGE') {
        const sizeInMb = (error.size / (1024 * 1024)).toFixed(1)
        dialog.showErrorBox('打开文件失败', `文件大小为 ${sizeInMb} MB，超过 ${MAX_RENDERER_FILE_SIZE / (1024 * 1024)} MB 限制。`)
      } else {
        dialog.showErrorBox('打开文件失败', translateFileSystemError(error))
      }
    }
  })()
})

process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error)
})
