import Vditor from 'vditor'
import 'vditor/dist/index.css'

const isDev = import.meta.env.DEV
const MAX_INLINE_IMAGE_SIZE_MB = 5
const MAX_INLINE_IMAGE_SIZE = MAX_INLINE_IMAGE_SIZE_MB * 1024 * 1024
const TOAST_DISPLAY_DURATION = 2000
const TOAST_TRANSITION_DURATION = 300
const OUTLINE_MIN_WIDTH = 200
const OUTLINE_MAX_WIDTH = 600
const PREVIEW_RENDER_DELAY = 500

let vditor = null
let activeToast = null
let toastHideTimer = null
let toastRemoveTimer = null
let teardownElectronHandlers = null
let electronBeforeUnloadHandler = null

window.addEventListener('error', (event) => {
  // Surface renderer-side errors in the devtools console for easier Electron debugging
  // eslint-disable-next-line no-console
  console.error('Global error captured:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error
  })
})

// 默认内容
const defaultContent = `# 欢迎使用 WOK Editor

这是一个基于 Vditor 的极简 Markdown 编辑器，专注于纯粹的写作体验。

## 特性

- **简洁界面** - 无干扰的写作环境
- **完整 Markdown 支持** - 完整的 Markdown 语法
- **实时渲染** - 提供即时反馈的写作体验
- **多种模式** - 支持编辑与预览模式
- **快捷键支持** - 提高写作效率

## 开始写作

只需开始输入... 你的想法将在这里绽放。

---

> 专注于内容，让工具隐于无形

\`\`\`javascript
function hello() {
  return 'Hello, WOK Editor!'
}
\`\`\`

**加粗文本** *斜体文本* ~~删除线文本~~

- 无序列表项 1
- 无序列表项 2
- 无序列表项 3

1. 有序列表项 1
2. 有序列表项 2
3. 有序列表项 3

[链接示例](https://github.com/Vanessa219/vditor)

| 表格 | 示例 |
|------|------|
| 列1  | 数据1 |
| 列2  | 数据2 |
`
;

// 初始化编辑器
function initEditor() {
  if (vditor && typeof vditor.destroy === 'function') {
    vditor.destroy()
    vditor = null
  }

  try {
    vditor = new Vditor('vditor', {
      height: '100%',
      mode: 'ir',
      placeholder: '开始写作...',
      value: defaultContent,
      cache: {
        enable: false
      },
      upload: {
        accept: 'image/*',
        handler: (files) => {
          if (!vditor) return

          const fileArray = Array.isArray(files) ? files : Array.from(files || [])

          if (fileArray.length === 0) {
            showToast('请选择要插入的图片')
            return
          }

          let processedCount = 0
          let successCount = 0
          const oversized = []
          const failed = []

          const finalize = () => {
            processedCount += 1
            if (processedCount !== fileArray.length) return

            if (successCount > 0) {
              showToast(`已插入${successCount}张图片`)
            }

            if (oversized.length > 0) {
              showToast(`以下图片超过 ${MAX_INLINE_IMAGE_SIZE_MB}MB 未插入：${oversized.join('、')}`)
            }

            if (failed.length > 0) {
              showToast(`以下图片读取失败：${failed.join('、')}`)
            }
          }

          fileArray.forEach((file) => {
            const isFile = typeof File !== 'undefined' && file instanceof File
            if (!isFile || typeof file.size !== 'number') {
              const displayName = file && typeof file.name === 'string' ? file.name : '未知文件'
              failed.push(displayName)
              finalize()
              return
            }

            if (file.size > MAX_INLINE_IMAGE_SIZE) {
              oversized.push(file.name)
              finalize()
              return
            }

            const reader = new FileReader()

            reader.onload = () => {
              const result = reader.result
              if (typeof result === 'string') {
                const altText = file.name.replace(/[\[\]]/g, '')
                vditor.insertValue(`![${altText}](${result})\n`)
                successCount += 1
              } else {
                failed.push(file.name)
              }
              finalize()
            }

            reader.onerror = () => {
              failed.push(file.name)
              finalize()
            }

            reader.readAsDataURL(file)
          })
        },
      },
      toolbar: [
        'headings',
        'bold',
        'italic',
        'strike',
        'link',
        '|',
        'list',
        'ordered-list',
        'check',
        'outdent',
        'indent',
        '|',
        'quote',
        'line',
        'code',
        'inline-code',
        'insert-before',
        'insert-after',
        '|',
        'table',
        '|',
        'preview',
        'both',
        'export',
        'outline',
      ],
      toolbarConfig: {
        pin: true,
      },
      counter: {
        enable: false,
        type: 'markdown',
      },
      resize: {
        enable: false,
      },
      outline: {
        enable: true,
        position: 'left',
      },
      preview: {
        delay: PREVIEW_RENDER_DELAY,
        hljs: {
          enable: true,
          style: 'github',
          lineNumber: true
        },
        markdown: {
          toc: true,
          mark: true,
          footnotes: true,
          autoSpace: true,
        },
        math: {
          engine: 'KaTeX',
        },
      },
      after: () => {
        // 编辑器初始化完成后的回调
        initOutlineResizer()
        fixPreviewTooltipBehavior()
      },
    })

    return vditor
  } catch (error) {
    console.error('编辑器初始化失败:', error)
    renderInitError(error)
  }

  return null
}

function renderInitError(error) {
  const editorElement = document.getElementById('vditor')
  if (!editorElement) return

  editorElement.innerHTML = ''

  const container = document.createElement('div')
  container.style.padding = '40px'
  container.style.textAlign = 'center'
  container.style.color = '#666'

  const title = document.createElement('h3')
  title.textContent = '编辑器初始化失败'
  container.appendChild(title)

  const message = document.createElement('p')
  message.textContent = '请检查控制台查看详细错误信息'
  container.appendChild(message)

  if (error) {
    const details = document.createElement('pre')
    details.style.background = '#f5f5f5'
    details.style.padding = '10px'
    details.style.borderRadius = '4px'
    details.style.marginTop = '20px'
    details.style.textAlign = 'left'
    details.textContent = error instanceof Error ? error.message : String(error)
    container.appendChild(details)
  }

  const retryButton = document.createElement('button')
  retryButton.type = 'button'
  retryButton.textContent = '重试加载编辑器'
  retryButton.style.marginTop = '24px'
  retryButton.style.padding = '10px 24px'
  retryButton.style.border = 'none'
  retryButton.style.borderRadius = '6px'
  retryButton.style.background = '#5c6bc0'
  retryButton.style.color = '#fff'
  retryButton.style.cursor = 'pointer'
  retryButton.addEventListener('click', () => {
    editorElement.innerHTML = ''
    initEditor()
  })
  container.appendChild(retryButton)

  editorElement.appendChild(container)
}

// 修复预览按钮提示框点击后不消失的问题：点击后主动移除聚焦与悬浮态
function fixPreviewTooltipBehavior() {
  const toolbar = document.querySelector('.vditor-toolbar')
  if (!toolbar) return

  const isPreviewBtn = (el) => {
    if (!el) return false
    const label = (el.getAttribute && el.getAttribute('aria-label')) || ''
    return /预览|preview/i.test(label)
  }

  const hideTooltip = (btn) => {
    if (!btn) return
    btn.classList && btn.classList.remove('vditor-tooltipped--hover')
    if (typeof btn.blur === 'function') {
      // 延迟到 Vditor 内部状态切换完成后再移除 focus
      setTimeout(() => btn.blur(), 0)
    }
  }

  toolbar.addEventListener('click', (e) => {
    const target = e.target && e.target.closest ? e.target.closest('.vditor-toolbar__item') : null
    if (isPreviewBtn(target)) {
      hideTooltip(target)
    }
  })

  // 彻底移除预览按钮的提示（避免浏览器原生 title 或 aria 提示）
  const disablePreviewTooltip = () => {
    const items = toolbar.querySelectorAll('.vditor-toolbar__item')
    items.forEach((el) => {
      if (!isPreviewBtn(el)) return
      el.removeAttribute('aria-label')
      el.removeAttribute('title')
      el.classList && el.classList.remove('vditor-tooltipped')
    })
  }

  // 初始化时执行一次
  disablePreviewTooltip()
}

// 可拖动边界功能
function initOutlineResizer() {
  const editorElement = document.getElementById('vditor')
  if (!editorElement) return

  const ensureResizer = (outlineElement) => {
    if (!outlineElement) return

    let resizer = outlineElement.querySelector('.outline-resizer')
    if (!resizer) {
      resizer = document.createElement('div')
      resizer.className = 'outline-resizer'
      outlineElement.appendChild(resizer)
    }

    if (resizer.dataset.bound === 'true') return
    resizer.dataset.bound = 'true'

    let isResizing = false
    let startX = 0
    let startWidth = outlineElement.offsetWidth || OUTLINE_MIN_WIDTH

    const stopResizing = () => {
      if (!isResizing) return
      isResizing = false
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', stopResizing)
      window.removeEventListener('blur', stopResizing)
    }

    const handleMouseMove = (event) => {
      if (!isResizing) return
      const deltaX = event.clientX - startX
      let newWidth = startWidth + deltaX

      if (newWidth < OUTLINE_MIN_WIDTH) newWidth = OUTLINE_MIN_WIDTH
      if (newWidth > OUTLINE_MAX_WIDTH) newWidth = OUTLINE_MAX_WIDTH

      outlineElement.style.width = `${newWidth}px`
      if (vditor) {
        vditor.resize()
      }
    }

    resizer.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return
      isResizing = true
      startX = event.clientX
      const computedWidth = parseInt(window.getComputedStyle(outlineElement).width, 10)
      startWidth = Number.isNaN(computedWidth)
        ? outlineElement.offsetWidth || OUTLINE_MIN_WIDTH
        : computedWidth

      event.preventDefault()
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', stopResizing)
      window.addEventListener('blur', stopResizing)
    })
  }

  const observer = new MutationObserver((mutationsList) => {
    for (const mutation of mutationsList) {
      if (mutation.type !== 'childList') continue
      const outlines = editorElement.querySelectorAll('.vditor-outline')
      outlines.forEach(ensureResizer)
    }
  })

  observer.observe(editorElement, { childList: true, subtree: true })

  const initialOutline = editorElement.querySelector('.vditor-outline')
  if (initialOutline) {
    ensureResizer(initialOutline)
  }
}


// 显示提示消息
function showToast(message) {
  if (!message) return

  if (activeToast && activeToast.parentElement) {
    activeToast.parentElement.removeChild(activeToast)
  }

  window.clearTimeout(toastHideTimer)
  window.clearTimeout(toastRemoveTimer)
  toastHideTimer = null
  toastRemoveTimer = null

  const toast = document.createElement('div')
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #333;
    color: #fff;
    padding: 12px 20px;
    border-radius: 6px;
    font-size: 14px;
    z-index: 1000;
    opacity: 0;
    transform: translateY(-10px);
    transition: opacity 0.3s ease, transform 0.3s ease;
  `
  toast.textContent = message
  document.body.appendChild(toast)

  // 使用 requestAnimationFrame 确保元素已插入后再执行动画
  requestAnimationFrame(() => {
    toast.style.opacity = '1'
    toast.style.transform = 'translateY(0)'
  })

  toastHideTimer = window.setTimeout(() => {
  toast.style.opacity = '0'
  toast.style.transform = 'translateY(-10px)'
  toastRemoveTimer = window.setTimeout(() => {
      if (toast.parentElement) {
        toast.parentElement.removeChild(toast)
      }
      if (activeToast === toast) {
        activeToast = null
      }
    }, TOAST_TRANSITION_DURATION)
  }, TOAST_DISPLAY_DURATION)

  activeToast = toast
}

// Electron 文件操作功能
function setupElectronHandlers() {
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

  register(
    window.electronAPI.onNewFile(() => {
      if (vditor) {
        vditor.setValue('')
        showToast('已创建新文件')
      }
    })
  )

  register(
    window.electronAPI.onOpenFile((_event, data) => {
      if (vditor && data?.content) {
        vditor.setValue(data.content)
        if (data.filePath) {
          showToast(`已打开文件: ${data.filePath}`)
        } else {
          showToast('文件内容已加载')
        }
      }
    })
  )

  register(
    window.electronAPI.onSaveFile(async () => {
      if (!vditor) return
      const content = vditor.getValue()
      const result = await window.electronAPI.saveFile(content)
      if (result?.success) {
        showToast(`文件已保存: ${result.filePath}`)
      } else if (result && !result.canceled && result.error) {
        showToast(`保存失败: ${result.error}`)
      }
    })
  )

  register(
    window.electronAPI.onSaveAsFile(async () => {
      if (!vditor) return
      const content = vditor.getValue()
      const result = await window.electronAPI.saveFileAs(content)
      if (result?.success) {
        showToast(`文件已另存为: ${result.filePath}`)
      } else if (result && !result.canceled && result.error) {
        showToast(`另存为失败: ${result.error}`)
      }
    })
  )

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

// 页面加载完成后初始化编辑器
document.addEventListener('DOMContentLoaded', () => {
  if (isDev) {
    console.info('Renderer DOMContentLoaded: initializing editor')
  }
  initEditor()
  setupElectronHandlers()
})