import Vditor from 'vditor'
import 'vditor/dist/index.css'

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
- **实时预览** - 所见即所得的编辑体验
- **多种模式** - 支持编辑、预览、实时渲染模式
- **快捷键支持** - 提高写作效率

## 开始写作

只需开始输入... 你的想法将在这里绽放。

---

> 专注于内容，让工具隐于无形

\`\`\`javascript
// 代码块示例
function hello() {
  // console.log("Hello, WOK Editor!");
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
| 列2  | 数据2 |`

// Vditor 实例
let vditor = null


// 初始化编辑器
function initEditor() {
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

          const MAX_INLINE_IMAGE_SIZE = 5 * 1024 * 1024
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
              showToast(`以下图片超过 5MB 未插入：${oversized.join('、')}`)
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
        'edit-mode',
        'both',
        'export',
        'outline',
      ],
      toolbarConfig: {
        pin: true,
      },
      customWysiwygToolbar: () => {
        // 空函数避免Vditor内部错误
        return []
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
        delay: 500,
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
      },
    })

    return vditor
  } catch (error) {
    console.error('编辑器初始化失败:', error)
    // 显示错误信息
    const editorElement = document.getElementById('vditor')
    if (editorElement) {
      editorElement.innerHTML = `
        <div style="padding: 40px; text-align: center; color: #666;">
          <h3>编辑器初始化失败</h3>
          <p>请检查控制台查看详细错误信息</p>
          <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px; margin-top: 20px; text-align: left;">${error.message}</pre>
        </div>
      `
    }
  }

  return null
}

// 可拖动边界功能
function initOutlineResizer() {
  const editorElement = document.getElementById('vditor')
  if (!editorElement) return

  const MIN_WIDTH = 200
  const MAX_WIDTH = 600

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
    let startWidth = outlineElement.offsetWidth || MIN_WIDTH

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

      if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH
      if (newWidth > MAX_WIDTH) newWidth = MAX_WIDTH

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
        ? outlineElement.offsetWidth || MIN_WIDTH
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
  const toast = document.createElement('div')
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #333;
    color: white;
    padding: 12px 20px;
    border-radius: 6px;
    font-size: 14px;
    z-index: 1000;
    opacity: 0;
    transform: translateY(-10px);
    transition: all 0.3s ease;
  `
  toast.textContent = message
  document.body.appendChild(toast)

  // 显示动画
  setTimeout(() => {
    toast.style.opacity = '1'
    toast.style.transform = 'translateY(0)'
  }, 10)

  // 隐藏动画
  setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transform = 'translateY(-10px)'
    setTimeout(() => {
      document.body.removeChild(toast)
    }, 300)
  }, 2000)
}

// Electron 文件操作功能
function setupElectronHandlers() {
  if (window.electronAPI) {
    // 新建文件
    window.electronAPI.onNewFile(() => {
      if (vditor) {
        vditor.setValue('')
        showToast('已创建新文件')
      }
    })

    // 打开文件
    window.electronAPI.onOpenFile((event, data) => {
      if (vditor && data.content) {
        vditor.setValue(data.content)
        showToast(`已打开文件: ${data.filePath}`)
      }
    })

    // 保存文件
    window.electronAPI.onSaveFile(async () => {
      if (vditor) {
        const content = vditor.getValue()
        const result = await window.electronAPI.saveFile(content)
        if (result.success) {
          showToast(`文件已保存: ${result.filePath}`)
        }
      }
    })

    // 另存为
    window.electronAPI.onSaveAsFile(async () => {
      if (vditor) {
        const content = vditor.getValue()
        const result = await window.electronAPI.saveFileAs(content)
        if (result.success) {
          showToast(`文件已另存为: ${result.filePath}`)
        }
      }
    })
  }
}

// 页面加载完成后初始化编辑器
document.addEventListener('DOMContentLoaded', () => {
  console.info('Renderer DOMContentLoaded: initializing editor')
  initEditor()
  setupElectronHandlers()
})