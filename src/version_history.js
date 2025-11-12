// 版本历史功能 - 使函数全局可用
window.versionHistoryModal = null
window.versionHistoryFiles = []
window.currentSelectedVersion = null

window.loadVersionHistoryFiles = async function() {
  try {
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

window.formatFileTime = function(timestamp) {
  try {
    const date = new Date(timestamp)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch (error) {
    return timestamp
  }
}

window.createVersionHistoryModal = function() {
  const modal = document.createElement('div')
  modal.className = 'version-history-modal'
  modal.style.display = 'none'

  modal.innerHTML = `
    <div class="version-history-content">
      <div class="version-history-header">
        <h2 class="version-history-title">版本历史</h2>
        <button class="version-history-close" onclick="window.closeVersionHistory()">×</button>
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

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      window.closeVersionHistory()
    }
  })

  document.body.appendChild(modal)
  return modal
}

window.showVersionHistory = async function() {
  if (!window.versionHistoryModal) {
    window.versionHistoryModal = window.createVersionHistoryModal()
  }

  window.versionHistoryModal.style.display = 'flex'

  // 加载版本历史文件
  const files = await window.loadVersionHistoryFiles()
  window.versionHistoryFiles = files

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
    listContainer.innerHTML = files.map((file, index) => `
      <div class="version-history-item" onclick="window.selectVersion(${index})" data-index="${index}">
        <div class="version-history-item-time">${window.formatFileTime(file.timestamp)}</div>
        <div class="version-history-item-name">${file.fileName}</div>
        <div class="version-history-item-size">${file.size} KB</div>
      </div>
    `).join('')
  }
}

window.closeVersionHistory = function() {
  if (window.versionHistoryModal) {
    window.versionHistoryModal.style.display = 'none'
    window.currentSelectedVersion = null
  }
}

window.selectVersion = function(index) {
  const files = window.versionHistoryFiles
  if (!files || !files[index]) return

  window.currentSelectedVersion = files[index]

  // 更新选中状态
  document.querySelectorAll('.version-history-item').forEach((item, i) => {
    item.classList.toggle('active', i === index)
  })

  // 显示预览
  const previewContainer = document.getElementById('version-history-preview')
  const version = files[index]

  previewContainer.innerHTML = `
    <div class="version-history-preview-header">
      <div class="version-history-preview-title">${version.fileName}</div>
      <div class="version-history-actions">
        <button class="version-history-btn-restore" onclick="window.restoreVersion(${index})">恢复此版本</button>
        <button class="version-history-btn-delete" onclick="window.deleteVersion(${index})">删除</button>
      </div>
    </div>
    <div class="version-history-content-preview">${window.escapeHtml(version.contentPreview || version.content)}</div>
  `
}

window.escapeHtml = function(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

window.restoreVersion = async function(index) {
  const version = window.versionHistoryFiles[index]
  if (!version) return

  try {
    if (confirm(`确定要恢复版本 "${version.fileName}" 吗？当前内容将被替换。`)) {
      // 获取完整内容
      let content = version.content
      if (!content) {
        const result = await window.electronAPI.readAutoSaveFile(version.filePath)
        if (result.success) {
          content = result.content
        } else {
          showToast('读取版本内容失败: ' + (result.error?.message || '未知错误'))
          return
        }
      }

      // 恢复内容到编辑器
      const editorInstance = await editorReadyPromise
      if (editorInstance) {
        editorInstance.setValue(content)
        showToast('版本已恢复: ' + version.fileName)
        window.closeVersionHistory()
      }
    }
  } catch (error) {
    console.error('恢复版本失败:', error)
    showToast('恢复版本失败: ' + error.message)
  }
}

window.deleteVersion = async function(index) {
  const version = window.versionHistoryFiles[index]
  if (!version) return

  try {
    if (confirm(`确定要删除版本 "${version.fileName}" 吗？此操作无法撤销。`)) {
      // TODO: 实现删除功能（需要添加 IPC 处理器）
      showToast('删除功能开发中...')
    }
  } catch (error) {
    console.error('删除版本失败:', error)
    showToast('删除版本失败: ' + error.message)
  }
}

// 监听版本历史菜单事件
if (isElectron && window.electronAPI) {
  window.electronAPI.onVersionHistory(() => {
    window.showVersionHistory()
  })
}

// 添加版本历史按钮到页面
document.addEventListener('DOMContentLoaded', () => {
  const versionHistoryBtn = document.createElement('button')
  versionHistoryBtn.className = 'version-history-btn'
  versionHistoryBtn.innerHTML = '⚡ 版本历史'
  versionHistoryBtn.title = '查看自动保存的版本历史'
  versionHistoryBtn.onclick = window.showVersionHistory

  // 将按钮添加到页面
  document.body.appendChild(versionHistoryBtn)
})