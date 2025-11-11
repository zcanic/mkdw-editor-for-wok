/**
 * Electron IPC 处理器模块
 * 负责注册和管理所有 Electron 主进程通信事件
 */

import { isDev } from '../core/constants.js'
import {
  setKnownFilePath,
  getKnownFilePath,
  setLastAutoSaveTimestamp
} from '../core/state.js'
import { showToast } from '../ui/toast.js'
import { cancelAutoSave } from './file-system.js'

let teardownElectronHandlers = null
let electronBeforeUnloadHandler = null

/**
 * 设置 Electron IPC 事件处理器
 * @param {Function} executeWithEditor - 执行编辑器操作的函数
 * @param {Function} markDirtyState - 标记脏状态的函数
 * @param {Function} withDirtyTrackingSuppressed - 临时禁用脏状态跟踪的函数
 * @returns {Function} 清理函数
 */
export function setupElectronHandlers(executeWithEditor, markDirtyState, withDirtyTrackingSuppressed) {
  if (!window.electronAPI) {
    if (isDev) {
      console.info('Electron API bridge is not available on window, skipping IPC handlers')
    }
    return
  }

  if (typeof teardownElectronHandlers === 'function') {
    teardownElectronHandlers()
  }

  const unsubscribes = []
  const register = (unsubscribe) => {
    if (typeof unsubscribe === 'function') {
      unsubscribes.push(unsubscribe)
    }
  }

  // 新建文件
  register(
    window.electronAPI.onNewFile(() =>
      executeWithEditor((editorInstance) => {
        setKnownFilePath(null)
        cancelAutoSave()
        withDirtyTrackingSuppressed(() => {
          editorInstance.setValue('')
        })
        markDirtyState(false)
        showToast('已创建新文件')
      })
    )
  )

  // 打开文件
  register(
    window.electronAPI.onOpenFile((_event, data) =>
      executeWithEditor((editorInstance) => {
        if (!data?.content) {
          return
        }
        setKnownFilePath(data.filePath)
        cancelAutoSave()
        withDirtyTrackingSuppressed(() => {
          editorInstance.setValue(data.content)
        })
        markDirtyState(false)
        if (data.filePath) {
          showToast(`已打开文件: ${data.filePath}`)
        } else {
          showToast('文件内容已加载')
        }
      })
    )
  )

  // 保存文件
  register(
    window.electronAPI.onSaveFile(() =>
      executeWithEditor(
        async (editorInstance) => {
          const content = editorInstance.getValue()
          const result = await window.electronAPI.saveFile(content)
          if (result?.success) {
            setKnownFilePath(result.filePath || getKnownFilePath())
            setLastAutoSaveTimestamp(Date.now())
            markDirtyState(false)
            showToast(`文件已保存: ${result.filePath}`)
          } else if (result && !result.canceled && result.error) {
            showToast(`保存失败: ${result.error}`)
          }
        },
        (error) => {
          if (isDev) {
            console.error('保存文件时发生错误:', error)
          }
          showToast(`保存失败: ${error?.message || '未知错误'}`)
        }
      )
    )
  )

  // 另存为文件
  register(
    window.electronAPI.onSaveAsFile(() =>
      executeWithEditor(
        async (editorInstance) => {
          const content = editorInstance.getValue()
          const result = await window.electronAPI.saveFileAs(content)
          if (result?.success) {
            setKnownFilePath(result.filePath || getKnownFilePath())
            setLastAutoSaveTimestamp(Date.now())
            markDirtyState(false)
            showToast(`文件已另存为: ${result.filePath}`)
          } else if (result && !result.canceled && result.error) {
            showToast(`另存为失败: ${result.error}`)
          }
        },
        (error) => {
          if (isDev) {
            console.error('另存为时发生错误:', error)
          }
          showToast(`另存为失败: ${error?.message || '未知错误'}`)
        }
      )
    )
  )

  // 清理函数
  const cleanup = () => {
    while (unsubscribes.length > 0) {
      const unsubscribe = unsubscribes.pop()
      try {
        unsubscribe()
      } catch (cleanupError) {
        if (isDev) {
          console.warn('清理 Electron 监听器失败:', cleanupError)
        }
      }
    }

    if (electronBeforeUnloadHandler) {
      window.removeEventListener('beforeunload', electronBeforeUnloadHandler)
      electronBeforeUnloadHandler = null
    }
  }

  teardownElectronHandlers = cleanup
  electronBeforeUnloadHandler = () => cleanup()
  window.addEventListener('beforeunload', electronBeforeUnloadHandler)

  return cleanup
}
