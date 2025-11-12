/**
 * 版本历史模块
 * 提供版本历史的加载、显示、恢复等功能
 */

import { showToast } from '../ui/toast.js'

let versionHistoryModal = null
let versionHistoryFiles = []
let currentSelectedVersion = null

/**
 * 加载版本历史文件列表
 * @returns {Promise<Array>} 版本历史文件数组
 */
export async function loadVersionHistoryFiles() {
  try {
    const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI)
    
    if (!isElectron || !window.electronAPI) {
      showToast('版本历史功能仅在 Electron 应用中可用')
      return []
    }

    const result = await window.electronAPI.listAutoSaveFiles()
    if (result.success) {
      return result.files || []
    } else {
      console.error('获取版本历史失败:', result.error)
      showToast('获取版本历史失败: ' + (result.error?.message || '未知错误'))
      return []
    }
  } catch (error) {
    console.error('获取版本历史失败:', error)
    showToast('获取版本历史失败: ' + error.message)
    return []
  }
}

/**
 * 格式化文件时间戳
 * @param {number|string} timestamp 时间戳
 * @returns {string} 格式化后的时间字符串
 */
export function formatFileTime(timestamp) {
  try {
    const date = new Date(timestamp)
    // 验证日期是否有效（安全性：防止XSS攻击）
    if (isNaN(date.getTime())) {
      return '无效日期'
    }
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch (error) {
    // 安全性：不返回原始输入，防止XSS攻击
    return '无效日期'
  }
}

/**
 * 创建版本历史模态框
 * @returns {HTMLElement} 模态框元素
 */
export function createVersionHistoryModal() {
  const modal = document.createElement('div')
  modal.className = 'version-history-modal'
  modal.style.display = 'none'

  modal.innerHTML = `
    <div class="version-history-content">
      <div class="version-history-header">
        <h2 class="version-history-title">版本历史</h2>
        <button class="version-history-close" id="version-history-close-btn">×</button>
      </div>
      <div class="version-history-body">
        <div class="version-history-list" id="version-history-list">
          <div class="version-history-loading">
            <div class="version-history-loading-spinner"></div>
            <div>正在加载版本历史...</div>
          </div>
        </div>
        <div class="version-history-preview" id="version-history-preview">
          <div class="version-history-empty">
            <div class="version-history-empty-icon">📝</div>
            <div class="version-history-empty-text">选择一个版本查看内容</div>
            <div class="version-history-empty-subtext">点击左侧列表中的版本记录</div>
          </div>
        </div>
      </div>
    </div>
  `

  // 点击背景关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeVersionHistory()
    }
  })

  // 点击关闭按钮
  const closeBtn = modal.querySelector('#version-history-close-btn')
  closeBtn.addEventListener('click', closeVersionHistory)

  document.body.appendChild(modal)
  return modal
}

/**
 * 显示版本历史
 */
export async function showVersionHistory() {
  if (!versionHistoryModal) {
    versionHistoryModal = createVersionHistoryModal()
  }

  versionHistoryModal.style.display = 'flex'

  // 加载版本历史文件
  const files = await loadVersionHistoryFiles()
  versionHistoryFiles = files

  const listContainer = document.getElementById('version-history-list')

  if (files.length === 0) {
    listContainer.innerHTML = `
      <div class="version-history-empty">
        <div class="version-history-empty-icon">📁</div>
        <div class="version-history-empty-text">暂无版本历史</div>
        <div class="version-history-empty-subtext">自动保存的版本将显示在这里</div>
      </div>
    `
  } else {
    // 安全性：转义所有用户数据，防止XSS攻击
    listContainer.innerHTML = files.map((file, index) => `
      <div class="version-history-item" data-index="${index}">
        <div class="version-history-item-time">${escapeHtml(formatFileTime(file.timestamp))}</div>
        <div class="version-history-item-name">${escapeHtml(file.fileName)}</div>
        <div class="version-history-item-size">${file.size} KB</div>
      </div>
    `).join('')

    // 使用事件委托绑定点击事件
    listContainer.addEventListener('click', (e) => {
      const item = e.target.closest('.version-history-item')
      if (item) {
        const index = parseInt(item.dataset.index, 10)
        selectVersion(index)
      }
    })
  }
}

/**
 * 关闭版本历史
 */
export function closeVersionHistory() {
  if (versionHistoryModal) {
    versionHistoryModal.style.display = 'none'
    currentSelectedVersion = null
  }
}

/**
 * HTML 转义
 * @param {string} text 需要转义的文本
 * @returns {string} 转义后的文本
 */
export function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

/**
 * 选择版本
 * @param {number} index 版本索引
 */
export function selectVersion(index) {
  const files = versionHistoryFiles
  if (!files || !files[index]) return

  currentSelectedVersion = files[index]

  // 更新选中状态
  document.querySelectorAll('.version-history-item').forEach((item, i) => {
    item.classList.toggle('active', i === index)
  })

  // 显示预览
  const previewContainer = document.getElementById('version-history-preview')
  const version = files[index]

  // 安全性：转义所有用户数据，防止XSS攻击
  previewContainer.innerHTML = `
    <div class="version-history-preview-header">
      <div class="version-history-preview-title">${escapeHtml(version.fileName)}</div>
      <div class="version-history-actions">
        <button class="version-history-btn-restore" data-index="${index}">恢复此版本</button>
        <button class="version-history-btn-delete" data-index="${index}">删除</button>
      </div>
    </div>
    <div class="version-history-content-preview">${escapeHtml(version.contentPreview || '')}</div>
  `

  // 使用事件委托绑定按钮事件
  const restoreBtn = previewContainer.querySelector('.version-history-btn-restore')
  const deleteBtn = previewContainer.querySelector('.version-history-btn-delete')

  if (restoreBtn) {
    restoreBtn.addEventListener('click', () => restoreVersion(index))
  }
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => deleteVersion(index))
  }
}

/**
 * 恢复版本
 * @param {number} index 版本索引
 */
export async function restoreVersion(index) {
  const version = versionHistoryFiles[index]
  if (!version) return

  try {
    // 创建安全的对话框文本（转义文件名）
    const safeFileName = escapeHtml(version.fileName)
    // 注意：confirm() 会自动转义HTML，但为了一致性仍使用 textContent
    const confirmDiv = document.createElement('div')
    confirmDiv.textContent = `确定要恢复版本 "${version.fileName}" 吗？当前内容将被替换。`
    
    if (confirm(confirmDiv.textContent)) {
      // 性能优化：content 字段不再存在，总是从文件读取
      const result = await window.electronAPI.readAutoSaveFile(version.filePath)
      if (!result.success) {
        showToast('读取版本内容失败: ' + (result.error?.message || '未知错误'))
        return
      }
      
      const content = result.content

      // 恢复内容到编辑器
      // 需要从外部传入 editorReadyPromise
      if (window.vditorEditorReady) {
        const editorInstance = await window.vditorEditorReady
        if (editorInstance) {
          editorInstance.setValue(content)
          showToast('版本已恢复: ' + version.fileName)
          closeVersionHistory()
        }
      } else {
        showToast('编辑器未就绪')
      }
    }
  } catch (error) {
    console.error('恢复版本失败:', error)
    showToast('恢复版本失败: ' + error.message)
  }
}

/**
 * 删除版本
 * @param {number} index 版本索引
 */
export async function deleteVersion(index) {
  const version = versionHistoryFiles[index]
  if (!version) return

  try {
    // 创建安全的对话框文本（转义文件名）
    const confirmDiv = document.createElement('div')
    confirmDiv.textContent = `确定要删除版本 "${version.fileName}" 吗？此操作无法撤销。`
    
    if (confirm(confirmDiv.textContent)) {
      // TODO: 实现删除功能（需要添加 IPC 处理器）
      showToast('删除功能开发中...')
    }
  } catch (error) {
    console.error('删除版本失败:', error)
    showToast('删除版本失败: ' + error.message)
  }
}

/**
 * 初始化版本历史功能
 * @param {Promise} editorReadyPromise 编辑器就绪 Promise
 */
export function initVersionHistory(editorReadyPromise) {
  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI)
  
  // 将 editorReadyPromise 暴露给全局，供恢复功能使用
  window.vditorEditorReady = editorReadyPromise

  // 监听版本历史菜单事件
  if (isElectron && window.electronAPI) {
    window.electronAPI.onVersionHistory(() => {
      showVersionHistory()
    })
  }

  // 添加版本历史按钮到页面
  const versionHistoryBtn = document.createElement('button')
  versionHistoryBtn.className = 'version-history-btn'
  versionHistoryBtn.innerHTML = '⚡ 版本历史'
  versionHistoryBtn.title = '查看自动保存的版本历史'
  versionHistoryBtn.addEventListener('click', showVersionHistory)

  // 将按钮添加到页面
  document.body.appendChild(versionHistoryBtn)
}
