'use strict'

const { app, BrowserWindow, dialog, Menu, ipcMain, shell, globalShortcut } = require('electron')
const path = require('path')
const fsPromises = require('fs/promises')
const fs = require('fs')
const process = require('process')

const isMac = process.platform === 'darwin'
const isDev = process.env.NODE_ENV === 'development'
const APP_NAME = 'WOK Editor'

// 文件大小限制 (10MB)
const MAX_RENDERER_FILE_SIZE = 10 * 1024 * 1024

// 当前状态
let mainWindow = null
let currentFilePath = null
let hasUnsavedChanges = false
let isAppQuitting = false
let pendingQuitAfterSave = false
let ipcHandlersRegistered = false

const fileFilters = [
  { name: 'Markdown 文件', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mkdn'] },
  { name: '文本文件', extensions: ['txt'] },
  { name: '所有文件', extensions: ['*'] }
]

function translateFileSystemError(error) {
  if (error.code === 'ENOENT') {
    return '文件不存在'
  } else if (error.code === 'EACCES') {
    return '权限不足，无法访问文件'
  } else if (error.code === 'EISDIR') {
    return '无法打开文件夹作为文件'
  } else if (error.code === 'EMFILE' || error.code === 'ENFILE') {
    return '系统文件描述符不足'
  } else if (error.code === 'ENOSPC') {
    return '磁盘空间不足'
  } else if (error.code === 'FILE_TOO_LARGE') {
    const sizeInMb = (error.size / (1024 * 1024)).toFixed(1)
    return `文件大小为 ${sizeInMb} MB，超过 ${MAX_RENDERER_FILE_SIZE / (1024 * 1024)} MB 限制`
  }
  return error.message || '未知错误'
}

function buildErrorResponse(error) {
  const message = translateFileSystemError(error)
  return {
    success: false,
    error: {
      code: error.code || 'UNKNOWN_ERROR',
      message: message,
      details: isDev ? error.stack : undefined
    }
  }
}

function assertSafeFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw Object.assign(new Error('无效的文件路径'), { code: 'INVALID_PATH' })
  }

  const normalizedPath = path.resolve(filePath)

  // 禁止访问某些系统目录（使用路径前缀匹配，而非 includes）
  const forbiddenDirs = [
    '/System',
    '/private',
    '/Library',
    '/Applications',
    '/usr',
    '/bin',
    '/sbin',
    '/etc',
    '/var',
    '/tmp',
    '/System Volume Information',
    '$Recycle.Bin',
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'C:\\ProgramData'
  ]

  for (const forbiddenDir of forbiddenDirs) {
    // 规范化禁止目录路径
    const normalizedForbidden = path.normalize(forbiddenDir)
    const lowerPath = normalizedPath.toLowerCase()
    const lowerForbidden = normalizedForbidden.toLowerCase()
    
    // 检查规范化后的路径是否以禁止目录开头（使用路径分隔符确保完整匹配）
    if (lowerPath === lowerForbidden || 
        lowerPath.startsWith(lowerForbidden + path.sep) ||
        (path.sep === '\\' && lowerPath.startsWith(lowerForbidden + '/'))) {
      throw Object.assign(new Error(`禁止访问系统目录: ${forbiddenDir}`), { code: 'FORBIDDEN_PATH' })
    }
  }

  return normalizedPath
}

async function readRendererFile(filePath, options = {}) {
  const normalizedPath = options.skipValidation ? path.resolve(filePath) : assertSafeFilePath(filePath)

  // 检查文件大小
  const stats = await fsPromises.stat(normalizedPath)
  if (stats.size > MAX_RENDERER_FILE_SIZE) {
    const error = new Error('文件过大')
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

async function handleSaveFile(content) {
  if (currentFilePath) {
    try {
      const normalizedPath = assertSafeFilePath(currentFilePath)
      await fsPromises.writeFile(normalizedPath, content, 'utf8')
      hasUnsavedChanges = false
      updateWindowTitle()
      return { success: true, filePath: normalizedPath }
    } catch (error) {
      return buildErrorResponse(error)
    }
  } else {
    return handleSaveAsFile(content)
  }
}

async function handleSaveAsFile(content) {
  if (!mainWindow) return { success: false, error: { message: '窗口未初始化' } }

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    filters: fileFilters
  })

  if (canceled || !filePath) {
    return { success: false, canceled: true }
  }

  try {
    const normalizedPath = assertSafeFilePath(filePath)
    await fsPromises.writeFile(normalizedPath, content, 'utf8')
    currentFilePath = normalizedPath
    hasUnsavedChanges = false
    updateWindowTitle()
    return { success: true, filePath: normalizedPath }
  } catch (error) {
    return buildErrorResponse(error)
  }
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }
}

function buildMenuTemplate() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '新建',
          accelerator: 'CmdOrCtrl+N',
          click: handleNewFile
        },
        {
          label: '打开',
          accelerator: 'CmdOrCtrl+O',
          click: handleOpenFileDialog
        },
        {
          label: '保存',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            sendToRenderer('menu:save-file')
          }
        },
        {
          label: '另存为',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            sendToRenderer('menu:save-as-file')
          }
        },
        { type: 'separator' },
        {
          label: '版本历史',
          accelerator: 'CmdOrCtrl+H',
          click: () => {
            sendToRenderer('menu:version-history')
          }
        },
        { type: 'separator' },
        isMac ? { label: '关闭', accelerator: 'Cmd+W', role: 'close' } : { label: '退出', accelerator: 'Ctrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectall' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '重载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '强制重载', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '全屏', accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11', role: 'togglefullscreen' },
        { label: '最小化', accelerator: 'CmdOrCtrl+M', role: 'minimize' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于 WOK Editor',
              message: 'WOK Editor',
              detail: '一个简单的 Markdown 编辑器'
            })
          }
        }
      ]
    }
  ]

  return template
}

function registerIpcHandlers() {
  if (ipcHandlersRegistered) {
    return
  }
  ipcHandlersRegistered = true

  ipcMain.handle('file:save', async (_event, content) => {
    return handleSaveFile(content)
  })

  ipcMain.handle('file:save-as', async (_event, content) => {
    return handleSaveAsFile(content)
  })

  ipcMain.on('file:set-dirty', (_event, isDirty) => {
    hasUnsavedChanges = Boolean(isDirty)
    updateWindowTitle()
  })

  // 自动保存到autosave文件夹
  ipcMain.handle('file:auto-save', async (_event, content) => {
    try {
      // 创建autosave文件夹
      const appPath = app.getAppPath()
      const autosaveDir = path.join(path.dirname(appPath), 'autosave')

      // 确保autosave文件夹存在
      try {
        await fsPromises.access(autosaveDir)
      } catch {
        await fsPromises.mkdir(autosaveDir, { recursive: true })
      }

      // 生成自动保存文件名（基于时间戳）
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const fileName = `autosave-${timestamp}.md`
      const filePath = path.join(autosaveDir, fileName)

      // 写入文件
      await fsPromises.writeFile(filePath, content, 'utf8')

      if (isDev) {
        console.info('自动保存到:', filePath)
      }

      return { success: true, filePath }
    } catch (error) {
      console.error('自动保存失败:', error)
      return buildErrorResponse(error)
    }
  })

  // 获取自动保存文件列表
  ipcMain.handle('file:list-autosave', async () => {
    try {
      const appPath = app.getAppPath()
      const autosaveDir = path.join(path.dirname(appPath), 'autosave')

      try {
        await fsPromises.access(autosaveDir)
      } catch {
        return { success: true, files: [] }
      }

      const files = await fsPromises.readdir(autosaveDir)
      const autosaveFiles = []

      for (const file of files) {
        if (file.startsWith('autosave-') && file.endsWith('.md')) {
          const filePath = path.join(autosaveDir, file)
          try {
            const stats = await fsPromises.stat(filePath)
            const sizeInKB = Math.round(stats.size / 1024)

            // 仅读取前200字节用于预览（性能优化：避免加载大文件到内存）
            const previewBuffer = Buffer.alloc(200)
            const fd = await fsPromises.open(filePath, 'r')
            let contentPreview = ''
            try {
              const { bytesRead } = await fd.read(previewBuffer, 0, 200, 0)
              contentPreview = previewBuffer.toString('utf8', 0, bytesRead)
              if (stats.size > bytesRead) {
                contentPreview += '...'
              }
            } finally {
              await fd.close()
            }

            // 从文件名提取时间戳
            const timestampMatch = file.match(/autosave-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3})/)
            const timestamp = timestampMatch ? timestampMatch[1].replace(/-/g, ':') : stats.mtime.toISOString()

            autosaveFiles.push({
              fileName: file,
              filePath: filePath,
              timestamp: timestamp,
              size: sizeInKB,
              contentPreview: contentPreview
              // 不再包含完整 content 字段（性能优化）
              // 如需完整内容，使用 file:read-autosave 单独读取
            })
          } catch (error) {
            console.warn(`读取自动保存文件失败: ${file}`, error)
          }
        }
      }

      // 按时间戳降序排列（最新的在前）
      autosaveFiles.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))

      return { success: true, files: autosaveFiles }
    } catch (error) {
      console.error('获取自动保存文件列表失败:', error)
      return buildErrorResponse(error)
    }
  })

  // 读取自动保存文件内容
  ipcMain.handle('file:read-autosave', async (_event, filePath) => {
    try {
      const normalizedPath = assertSafeFilePath(filePath)
      const content = await fsPromises.readFile(normalizedPath, 'utf8')
      return { success: true, content }
    } catch (error) {
      console.error('读取自动保存文件失败:', error)
      return buildErrorResponse(error)
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

function toggleDevTools(window) {
  if (!window || window.isDestroyed()) return
  if (window.webContents.isDevToolsOpened()) {
    window.webContents.closeDevTools()
  } else {
    window.webContents.openDevTools()
  }
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus()
    return
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      worldSafeExecuteJavaScript: true,
      disableBlinkFeatures: '',
      safeDialogs: true,
      safeDialogsMessage: '该对话框已被WOK Editor安全功能阻止',
      navigateOnDragDrop: false,
      autoplayPolicy: 'user-gesture-required',
      // 禁用不需要的功能
      spellcheck: false,
      backgroundThrottling: true
    },
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    show: false,
    backgroundColor: '#ffffff'
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    if (isDev) {
      mainWindow.webContents.openDevTools()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 处理窗口关闭事件
  mainWindow.on('close', (event) => {
    if (isAppQuitting || !hasUnsavedChanges) {
      return
    }

    event.preventDefault()

    // 通知渲染进程保存
    sendToRenderer('menu:save-file')
    pendingQuitAfterSave = true
  })

  // 加载应用
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl)
    if (parsedUrl.origin !== (isDev ? 'http://localhost:5173' : 'file://')) {
      event.preventDefault()
      shell.openExternal(navigationUrl)
    }
  })

  mainWindow.webContents.on('new-window', (event, navigationUrl) => {
    event.preventDefault()
    shell.openExternal(navigationUrl)
  })

  // 监听渲染进程的保存完成事件
  ipcMain.on('file:saved', () => {
    if (pendingQuitAfterSave) {
      pendingQuitAfterSave = false
      isAppQuitting = true
      app.quit()
    }
  })

  ipcMain.on('file:save-canceled', () => {
    pendingQuitAfterSave = false
  })
}

process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error)
})