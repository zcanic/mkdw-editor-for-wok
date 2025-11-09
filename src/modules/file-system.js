/**
 * 文件系统操作模块
 * 负责自动保存（Electron）和浏览器持久化（localStorage）
 */

import {
  isDev,
  isElectron,
  AUTO_SAVE_DELAY,
  AUTO_SAVE_MIN_INTERVAL,
  BROWSER_AUTO_SAVE_DELAY,
  BROWSER_MAX_PERSISTED_CHAR_COUNT,
  LOCAL_STORAGE_CONTENT_KEY,
  LOCAL_STORAGE_UPDATED_AT_KEY
} from '../core/constants.js'
import {
  getAutoSaveTimer,
  setAutoSaveTimer,
  getLastAutoSaveTimestamp,
  setLastAutoSaveTimestamp,
  getKnownFilePath,
  setKnownFilePath
} from '../core/state.js'
import { showToast } from '../ui/toast.js'

// 浏览器持久化状态
let browserPersistTimer = null
let browserPersistOverflowNotified = false
let isLocalStorageAvailable = null

/**
 * 取消自动保存定时器
 */
export function cancelAutoSave() {
  const timer = getAutoSaveTimer()
  if (timer) {
    window.clearTimeout(timer)
    setAutoSaveTimer(null)
  }
}

/**
 * 调度自动保存任务
 * @param {Function} executeWithEditor - 执行编辑器操作的函数
 * @param {Function} markDirtyState - 标记脏状态的函数
 */
export function scheduleAutoSave(executeWithEditor, markDirtyState) {
  if (!isElectron || !window.electronAPI || !getKnownFilePath()) {
    return
  }

  const now = Date.now()
  const elapsed = now - getLastAutoSaveTimestamp()
  const minimumDelay = elapsed >= AUTO_SAVE_MIN_INTERVAL
    ? AUTO_SAVE_DELAY
    : Math.max(AUTO_SAVE_MIN_INTERVAL - elapsed, AUTO_SAVE_DELAY)

  cancelAutoSave()

  const timer = window.setTimeout(() => {
    setAutoSaveTimer(null)
    executeWithEditor(
      async (editorInstance) => {
        const content = editorInstance.getValue()
        const result = await window.electronAPI.saveFile(content)
        if (result?.success) {
          setKnownFilePath(result.filePath || getKnownFilePath())
          setLastAutoSaveTimestamp(Date.now())
          markDirtyState(false)
          if (isDev) {
            console.info('Auto-saved file:', getKnownFilePath())
          }
        } else if (result && !result.canceled && result.error) {
          showToast(`自动保存失败: ${result.error}`)
        }
      },
      (error) => {
        if (isDev) {
          console.error('自动保存时发生错误:', error)
        }
        showToast(`自动保存失败: ${error?.message || '未知错误'}`)
      }
    )
  }, minimumDelay)
  setAutoSaveTimer(timer)
}

/**
 * 调度浏览器持久化任务
 * @param {Function} executeWithEditor - 执行编辑器操作的函数
 */
export function scheduleBrowserPersist(executeWithEditor) {
  if (isElectron || !isBrowserStorageAvailable()) {
    return
  }

  cancelBrowserPersist()
  browserPersistTimer = window.setTimeout(() => {
    browserPersistTimer = null
    executeWithEditor((editorInstance) => {
      const content = editorInstance.getValue()
      persistContentToLocalStorage(content)
    })
  }, BROWSER_AUTO_SAVE_DELAY)
}

/**
 * 取消浏览器持久化定时器
 */
export function cancelBrowserPersist() {
  if (browserPersistTimer) {
    window.clearTimeout(browserPersistTimer)
    browserPersistTimer = null
  }
}

/**
 * 检查 localStorage 是否可用
 * @returns {boolean}
 */
export function isBrowserStorageAvailable() {
  if (isElectron || typeof window === 'undefined') {
    return false
  }

  if (isLocalStorageAvailable !== null) {
    return isLocalStorageAvailable
  }

  try {
    const storage = window.localStorage
    if (!storage) {
      isLocalStorageAvailable = false
      return false
    }

    const probeKey = '__wok_editor_probe__'
    storage.setItem(probeKey, '1')
    storage.removeItem(probeKey)
    isLocalStorageAvailable = true
  } catch (error) {
    if (isDev) {
      console.warn('localStorage is not available:', error)
    }
    isLocalStorageAvailable = false
  }

  return isLocalStorageAvailable
}

/**
 * 从 localStorage 读取持久化内容
 * @returns {string | null}
 */
export function readPersistedBrowserContent() {
  if (!isBrowserStorageAvailable()) {
    return null
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_CONTENT_KEY)
    if (typeof raw !== 'string' || raw.length === 0) {
      return null
    }
    if (raw.length > BROWSER_MAX_PERSISTED_CHAR_COUNT) {
      window.localStorage.removeItem(LOCAL_STORAGE_CONTENT_KEY)
      window.localStorage.removeItem(LOCAL_STORAGE_UPDATED_AT_KEY)
      return null
    }
    return raw
  } catch (error) {
    if (isDev) {
      console.warn('读取本地缓存内容失败:', error)
    }
    return null
  }
}

/**
 * 将内容持久化到 localStorage
 * @param {string} content - 要保存的内容
 */
export function persistContentToLocalStorage(content) {
  if (!isBrowserStorageAvailable() || typeof content !== 'string') {
    return
  }

  if (content.length === 0) {
    clearPersistedBrowserContent()
    return
  }

  if (content.length > BROWSER_MAX_PERSISTED_CHAR_COUNT) {
    if (!browserPersistOverflowNotified) {
      showToast('内容超过浏览器本地缓存上限，已停止自动保存')
      browserPersistOverflowNotified = true
    }
    return
  }

  browserPersistOverflowNotified = false

  try {
    window.localStorage.setItem(LOCAL_STORAGE_CONTENT_KEY, content)
    window.localStorage.setItem(LOCAL_STORAGE_UPDATED_AT_KEY, String(Date.now()))
  } catch (error) {
    if (isDev) {
      console.warn('保存内容到本地缓存失败:', error)
    }
  }
}

/**
 * 清除 localStorage 中的持久化内容
 */
export function clearPersistedBrowserContent() {
  if (!isBrowserStorageAvailable()) {
    return
  }
  try {
    window.localStorage.removeItem(LOCAL_STORAGE_CONTENT_KEY)
    window.localStorage.removeItem(LOCAL_STORAGE_UPDATED_AT_KEY)
    browserPersistOverflowNotified = false
  } catch (error) {
    if (isDev) {
      console.warn('清理本地缓存失败:', error)
    }
  }
}
