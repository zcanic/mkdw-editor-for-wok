/**
 * 应用状态管理模块
 * 集中管理编辑器的全局状态，包括脏状态、文件路径、自动保存等
 */

import { isDev, isElectron, DEFAULT_DOCUMENT_TITLE } from './constants.js'

// 状态变量
let isEditorDirty = false
let suppressDirtyTracking = false
let knownFilePath = null
let autoSaveTimer = null
let lastAutoSaveTimestamp = 0

/**
 * 获取当前脏状态
 * @returns {boolean}
 */
export function getEditorDirty() {
  return isEditorDirty
}

/**
 * 设置编辑器脏状态（直接设置，不触发副作用）
 * @param {boolean} value
 */
export function setEditorDirty(value) {
  isEditorDirty = Boolean(value)
}

/**
 * 获取抑制脏状态跟踪标志
 * @returns {boolean}
 */
export function getSuppressDirtyTracking() {
  return suppressDirtyTracking
}

/**
 * 设置抑制脏状态跟踪标志
 * @param {boolean} value
 */
export function setSuppressDirtyTracking(value) {
  suppressDirtyTracking = Boolean(value)
}

/**
 * 获取已知文件路径
 * @returns {string | null}
 */
export function getKnownFilePath() {
  return knownFilePath
}

/**
 * 设置已知文件路径
 * @param {string | null} path
 */
export function setKnownFilePath(path) {
  knownFilePath = typeof path === 'string' && path.length > 0 ? path : null
}

/**
 * 获取自动保存定时器
 * @returns {number | null}
 */
export function getAutoSaveTimer() {
  return autoSaveTimer
}

/**
 * 设置自动保存定时器
 * @param {number | null} timer
 */
export function setAutoSaveTimer(timer) {
  autoSaveTimer = timer
}

/**
 * 获取上次自动保存时间戳
 * @returns {number}
 */
export function getLastAutoSaveTimestamp() {
  return lastAutoSaveTimestamp
}

/**
 * 设置上次自动保存时间戳
 * @param {number} timestamp
 */
export function setLastAutoSaveTimestamp(timestamp) {
  lastAutoSaveTimestamp = timestamp
}

/**
 * 标记编辑器脏状态
 * @param {boolean} nextDirty - 新的脏状态
 * @param {Object} callbacks - 可选的回调函数
 * @param {Function} callbacks.onDirty - 当状态变为 dirty 时调用
 * @param {Function} callbacks.onClean - 当状态变为 clean 时调用
 */
export function markDirtyState(nextDirty, callbacks = {}) {
  const normalized = Boolean(nextDirty)
  const changed = isEditorDirty !== normalized
  
  if (changed) {
    isEditorDirty = normalized

    // 在浏览器环境更新标题
    if (!isElectron && typeof document !== 'undefined') {
      document.title = normalized ? `* ${DEFAULT_DOCUMENT_TITLE}` : DEFAULT_DOCUMENT_TITLE
    }

    // 通知 Electron 主进程
    if (window.electronAPI && typeof window.electronAPI.setDirty === 'function') {
      try {
        window.electronAPI.setDirty(normalized)
      } catch (error) {
        if (isDev) {
          console.warn('Failed to update dirty state via Electron bridge:', error)
        }
      }
    }

    // 触发回调
    if (normalized && typeof callbacks.onDirty === 'function') {
      callbacks.onDirty()
    } else if (!normalized && typeof callbacks.onClean === 'function') {
      callbacks.onClean()
    }
  }
}

/**
 * 重置所有状态到初始值
 */
export function resetState() {
  isEditorDirty = false
  suppressDirtyTracking = false
  knownFilePath = null
  autoSaveTimer = null
  lastAutoSaveTimestamp = 0
}
