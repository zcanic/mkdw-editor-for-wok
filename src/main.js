import Vditor from 'vditor'
import 'vditor/dist/index.css'
import 'vditor/dist/js/i18n/zh_CN'
import 'vditor/dist/js/lute/lute.min.js'

const isDev = import.meta.env.DEV
const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI)
const DEFAULT_DOCUMENT_TITLE = typeof document !== 'undefined' ? document.title : 'WOK Editor'
const MAX_INLINE_IMAGE_SIZE_MB = 1
const MAX_INLINE_IMAGE_SIZE = MAX_INLINE_IMAGE_SIZE_MB * 1024 * 1024
const TOAST_DISPLAY_DURATION = 2000
const TOAST_TRANSITION_DURATION = 300
const OUTLINE_MIN_WIDTH = 200
const OUTLINE_MAX_WIDTH = 600
const PREVIEW_RENDER_DELAY = 150
const MAX_CONCURRENT_FILE_READS = 3
const MAX_ALT_TEXT_LENGTH = 100
const AUTO_SAVE_DELAY = 3000
const AUTO_SAVE_MIN_INTERVAL = 10000
const LOCAL_STORAGE_CONTENT_KEY = 'wok-editor:last-content'
const LOCAL_STORAGE_UPDATED_AT_KEY = 'wok-editor:last-updated'
const BROWSER_AUTO_SAVE_DELAY = 1500
const BROWSER_MAX_PERSISTED_CHAR_COUNT = 700000

let vditor = null
let activeToast = null
let toastHideTimer = null
let toastRemoveTimer = null
let teardownElectronHandlers = null
let electronBeforeUnloadHandler = null
let resolveEditorReady = () => {}
let editorReadyPromise = Promise.resolve()
let isEditorDirty = false
let suppressDirtyTracking = false
let knownFilePath = null
let autoSaveTimer = null
let lastAutoSaveTimestamp = 0
let browserPersistTimer = null
let browserPersistOverflowNotified = false
let isLocalStorageAvailable = null
const vditorLocale = typeof window !== 'undefined' && window.VditorI18n ? window.VditorI18n : undefined
let inlineEventGuardInstalled = false

if (typeof window !== 'undefined' && vditorLocale) {
  window.VditorI18n = vditorLocale
}

function installInlineEventAttributeGuard() {
  if (inlineEventGuardInstalled) {
    return
  }

  if (typeof Element === 'undefined') {
    return
  }

  // Acquire descriptor from Element.prototype first, fallback to HTMLElement.prototype for older engines.
  const descriptorInfo = (() => {
    const elementDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')
    if (elementDescriptor) {
      return { descriptor: elementDescriptor, target: Element.prototype }
    }
    if (typeof HTMLElement !== 'undefined') {
      const htmlDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerHTML')
      if (htmlDescriptor) {
        return { descriptor: htmlDescriptor, target: HTMLElement.prototype }
      }
    }
    return null
  })()

  if (!descriptorInfo || typeof descriptorInfo.descriptor.set !== 'function') {
    return
  }

  const { descriptor, target } = descriptorInfo
  const originalSetter = descriptor.set
  const originalGetter = descriptor.get

  try {
    Object.defineProperty(target, 'innerHTML', {
      configurable: descriptor.configurable,
      enumerable: descriptor.enumerable,
      get: originalGetter,
      set(value) {
        let nextValue = value

        if (typeof nextValue === 'string' && nextValue.includes('vditor') && /\son[a-z]+\s*=\s*/i.test(nextValue)) {
          // Strip all inline event attributes to comply with strict CSP.
          nextValue = nextValue
            .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, ' ')
            .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, ' ')
            .replace(/\s{2,}/g, ' ')
        }

        return originalSetter.call(this, nextValue)
      }
    })

    inlineEventGuardInstalled = true
  } catch (_err) {
    // Ignore descriptor redefinition failures (older browsers), fallback to runtime sanitization instead.
  }
}

function resetEditorReadyPromise() {
  editorReadyPromise = new Promise((resolve) => {
    resolveEditorReady = resolve
  })
}

resetEditorReadyPromise()

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

function getInitialEditorContent() {
  const restored = !isElectron ? readPersistedBrowserContent() : null
  if (typeof restored === 'string' && restored.length > 0) {
    return restored
  }
  return defaultContent
}

// 初始化编辑器
function initEditor() {
  resetEditorReadyPromise()

  if (vditor && typeof vditor.destroy === 'function') {
    vditor.destroy()
    vditor = null
  }

  installInlineEventAttributeGuard()

  try {
    const initialValue = getInitialEditorContent()
    vditor = new Vditor('vditor', {
      cdn: './vditor',
      height: '100%',
      mode: 'ir',
      placeholder: '开始写作...',
      value: initialValue,
      lang: 'zh_CN',
  i18n: vditorLocale,
      input: () => {
        if (!suppressDirtyTracking) {
          markDirtyState(true)
        }
      },
      cache: {
        enable: !isElectron
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

          const queue = fileArray.map((file, index) => ({ file, index }))
          const markdownSnippets = new Array(fileArray.length).fill('')
          const oversized = []
          const failed = []
          let processedCount = 0
          let inFlight = 0
          let successCount = 0
          let batchFinalized = false

          const finalizeBatch = () => {
            if (batchFinalized) {
              return
            }
            batchFinalized = true

            const mergedMarkdown = markdownSnippets.filter(Boolean).join('')
            if (mergedMarkdown && vditor) {
              vditor.insertValue(mergedMarkdown)
              markDirtyState(true)
            }

            const messages = []
            if (successCount > 0) {
              messages.push(`已插入${successCount}张图片`)
            }
            if (oversized.length > 0) {
              messages.push(`以下图片超过 ${MAX_INLINE_IMAGE_SIZE_MB}MB 未插入：${oversized.join('、')}`)
            }
            if (failed.length > 0) {
              messages.push(`以下图片读取失败：${failed.join('、')}`)
            }
            if (messages.length > 0) {
              showToast(messages.join('\n'))
            }
          }

          const finalizeSyncItem = () => {
            processedCount += 1
            if (processedCount === fileArray.length) {
              finalizeBatch()
              return true
            }
            return false
          }

          const handleAsyncCompletion = () => {
            inFlight -= 1
            processedCount += 1
            if (processedCount === fileArray.length) {
              finalizeBatch()
            } else {
              pumpQueue()
            }
          }

          const pumpQueue = () => {
            while (inFlight < MAX_CONCURRENT_FILE_READS && queue.length > 0) {
              const { file, index } = queue.shift()
              const isFile = typeof File !== 'undefined' && file instanceof File

              if (!isFile || typeof file.size !== 'number') {
                const displayName = file && typeof file.name === 'string' ? file.name : '未知文件'
                failed.push(displayName)
                if (finalizeSyncItem()) {
                  return
                }
                continue
              }

              if (file.size > MAX_INLINE_IMAGE_SIZE) {
                oversized.push(file.name)
                if (finalizeSyncItem()) {
                  return
                }
                continue
              }

              inFlight += 1
              const reader = new FileReader()

              reader.onload = () => {
                const result = reader.result
                if (typeof result === 'string') {
                  const altText = sanitizeAltText(file.name)
                  markdownSnippets[index] = `![${altText}](${result})\n`
                  successCount += 1
                } else {
                  failed.push(file.name)
                }
                handleAsyncCompletion()
              }

              reader.onerror = () => {
                failed.push(file.name)
                handleAsyncCompletion()
              }

              reader.readAsDataURL(file)
            }

            if (queue.length === 0 && inFlight === 0 && processedCount === fileArray.length) {
              finalizeBatch()
            }
          }

          pumpQueue()
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
          lineNumber: true,
          // Override Vditor's default copy button renderer to avoid inline event handlers
          renderMenu: (codeEl, copyContainer) => {
            try {
              // Ensure the textarea exists as first child (inserted by Vditor prior to renderMenu)
              const textarea = copyContainer.querySelector('textarea')
              // Remove any prebuilt inline-handler span if present
              const oldSpan = copyContainer.querySelector('span')
              if (oldSpan) {
                oldSpan.removeAttribute('onclick')
                oldSpan.removeAttribute('onmouseover')
              }

              // Build a safe copy button
              const btn = document.createElement('span')
              btn.className = 'vditor-tooltipped vditor-tooltipped__w'
              btn.setAttribute('aria-label', '复制')
              // Reuse the icon symbol if available
              const svgNS = 'http://www.w3.org/2000/svg'
              const svg = document.createElementNS(svgNS, 'svg')
              const use = document.createElementNS(svgNS, 'use')
              use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#vditor-icon-copy')
              svg.appendChild(use)
              btn.appendChild(svg)

              // Attach safe listeners
              btn.addEventListener('mouseover', () => {
                btn.setAttribute('aria-label', '复制')
              })
              btn.addEventListener('click', (e) => {
                e.stopPropagation()
                const targetTextarea = textarea || copyContainer.querySelector('textarea')
                if (targetTextarea && typeof targetTextarea.select === 'function') {
                  try { targetTextarea.select() } catch (_) {}
                  try { document.execCommand('copy') } catch (_) {}
                  try {
                    const sel = window.getSelection && window.getSelection()
                    sel && sel.removeAllRanges && sel.removeAllRanges()
                  } catch (_) {}
                  btn.setAttribute('aria-label', '已复制')
                  try { targetTextarea.blur() } catch (_) {}
                }
              })

              // Rebuild container children: textarea + button
              if (textarea && textarea.parentElement === copyContainer) {
                // Remove everything except the textarea, then append button
                Array.from(copyContainer.children).forEach((child) => {
                  if (child !== textarea) copyContainer.removeChild(child)
                })
                copyContainer.appendChild(btn)
              } else {
                copyContainer.innerHTML = ''
                if (textarea) copyContainer.appendChild(textarea)
                copyContainer.appendChild(btn)
              }

              // Mark sanitized to avoid later mutation work
              copyContainer.__wokSanitized = true
            } catch (_e) {
              // no-op
            }
          }
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
        // Sanitize the generated HTML before Vditor runs its renderers, to avoid
        // CSP-unsafe features (remote PlantUML, eval-based ECharts) and keep everything local.
        transform: (html) => {
          try {
            const container = document.createElement('div')
            container.innerHTML = html

            // Disable PlantUML (would embed remote https://www.plantuml.com) under strict CSP
            container.querySelectorAll('pre > code.language-plantuml').forEach((codeEl) => {
              const pre = codeEl.closest('pre') || codeEl.parentElement
              if (!pre) return
              const raw = codeEl.textContent || ''
              const replacement = document.createElement('pre')
              const safe = document.createElement('code')
              safe.className = 'language-text'
              safe.textContent = '[PlantUML 预览已禁用以满足本地/CSP 限制]\n' + raw
              replacement.appendChild(safe)
              pre.replaceWith(replacement)
            })

            // Disable generic ECharts renderer which relies on new Function (unsafe-eval under CSP)
            container.querySelectorAll('pre > code.language-echarts').forEach((codeEl) => {
              const pre = codeEl.closest('pre') || codeEl.parentElement
              if (!pre) return
              const raw = codeEl.textContent || ''
              const replacement = document.createElement('pre')
              const safe = document.createElement('code')
              safe.className = 'language-json'
              safe.textContent = '[ECharts 预览已禁用以满足本地/CSP 限制]\n' + raw
              replacement.appendChild(safe)
              pre.replaceWith(replacement)
            })

            // Disable Graphviz (uses Worker via blob: which may be restricted in some environments)
            container.querySelectorAll('pre > code.language-graphviz').forEach((codeEl) => {
              const pre = codeEl.closest('pre') || codeEl.parentElement
              if (!pre) return
              const raw = codeEl.textContent || ''
              const replacement = document.createElement('pre')
              const safe = document.createElement('code')
              safe.className = 'language-text'
              safe.textContent = '[Graphviz 预览已禁用以满足本地/CSP 限制]\n' + raw
              replacement.appendChild(safe)
              pre.replaceWith(replacement)
            })

            return container.innerHTML
          } catch (_e) {
            return html
          }
        },
      },
      after: () => {
        // 编辑器初始化完成后的回调
        initOutlineResizer()
        fixPreviewTooltipBehavior()
        // Sanitize any inline event handlers Vditor may have injected (e.g., copy buttons)
        sanitizeInlineHandlers()
        observeAndSanitizeInlineHandlers()
        resolveEditorReady(vditor)
        markDirtyState(false)
      },
    })

  } catch (error) {
    console.error('编辑器初始化失败:', error)
    renderInitError(error)
    resolveEditorReady(null)
  }
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

// Remove CSP-unsafe inline event handlers from Vditor UI (e.g., copy buttons),
// and reattach safe listeners.
function sanitizeInlineHandlers(root = document) {
  try {
    const buttons = root.querySelectorAll('.vditor-copy > span')
    buttons.forEach((btn) => {
      if (btn.__wokSanitized) return
      btn.removeAttribute('onclick')
      btn.removeAttribute('onmouseover')
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const textarea = btn.previousElementSibling
        if (textarea && typeof textarea.select === 'function') {
          textarea.select()
          try {
            document.execCommand('copy')
          } catch (_err) { /* noop */ }
          try {
            const sel = window.getSelection && window.getSelection()
            sel && sel.removeAllRanges && sel.removeAllRanges()
          } catch (_err) { /* noop */ }
          btn.setAttribute('aria-label', '已复制')
          if (typeof textarea.blur === 'function') textarea.blur()
        }
      })
      btn.addEventListener('mouseover', () => {
        btn.setAttribute('aria-label', '复制')
      })
      btn.__wokSanitized = true
    })

    // Sanitize image preview overlay injected by Vditor (removes inline onclicks)
    const overlays = root.querySelectorAll('.vditor-img')
    overlays.forEach((overlay) => {
      if (overlay.__wokSanitized) return
      // Close areas with inline handlers
      const closeBtn = overlay.querySelector('.vditor-img__bar > .vditor-img__btn:nth-child(2)')
      const clickArea = overlay.querySelector('.vditor-img__img')
      const doClose = () => {
        try { document.body.style.overflow = '' } catch (_) {}
        if (overlay && overlay.parentElement) {
          overlay.parentElement.removeChild(overlay)
        }
      }
      if (closeBtn) {
        closeBtn.removeAttribute('onclick')
        closeBtn.addEventListener('click', (e) => { e.stopPropagation(); doClose() })
      }
      if (clickArea) {
        clickArea.removeAttribute('onclick')
        clickArea.addEventListener('click', (e) => { e.stopPropagation(); doClose() })
      }
      overlay.__wokSanitized = true
    })
  } catch (_e) {
    // no-op
  }
}

function observeAndSanitizeInlineHandlers() {
  const editor = document.getElementById('vditor')
  const roots = [document.body]
  if (editor) roots.push(editor)

  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === 'childList') {
        m.addedNodes.forEach((node) => {
          if (node && node.querySelectorAll) {
            sanitizeInlineHandlers(node)
          }
        })
      }
    }
  })
  roots.forEach((root) => {
    mo.observe(root, { childList: true, subtree: true })
    sanitizeInlineHandlers(root)
  })
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

  const isDocumentFragment = (node) =>
    typeof DocumentFragment !== 'undefined' && node instanceof DocumentFragment

  const visitOutlineNodes = (root, callback) => {
    if (!root || typeof callback !== 'function') return

    const stack = []
    const pushNode = (node) => {
      if (!node) return
      if (node instanceof HTMLElement) {
        stack.push(node)
      } else if (isDocumentFragment(node)) {
        Array.from(node.childNodes || []).forEach((child) => pushNode(child))
      }
    }

    pushNode(root)

    while (stack.length > 0) {
      const element = stack.pop()
      if (!element) continue

      if (element.classList && element.classList.contains('vditor-outline')) {
        callback(element)
      }

      const children = element.children || []
      for (const child of children) {
        pushNode(child)
      }
    }
  }

  const observer = new MutationObserver((mutationsList) => {
    for (const mutation of mutationsList) {
      if (mutation.type !== 'childList') continue
      for (const node of mutation.addedNodes) {
        visitOutlineNodes(node, ensureResizer)
      }
      if (
        mutation.target instanceof HTMLElement &&
        mutation.target.classList.contains('vditor-outline')
      ) {
        ensureResizer(mutation.target)
      }
    }
  })

  observer.observe(editorElement, { childList: true, subtree: false })

  visitOutlineNodes(editorElement, ensureResizer)
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
    white-space: pre-line;
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
  if (!isElectron || !window.electronAPI) {
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
    window.electronAPI.onNewFile(() =>
      executeWithEditor((editorInstance) => {
        knownFilePath = null
        cancelAutoSave()
        withDirtyTrackingSuppressed(() => {
          editorInstance.setValue('')
        })
        markDirtyState(false)
        showToast('已创建新文件')
      })
    )
  )

  register(
    window.electronAPI.onOpenFile((_event, data) =>
      executeWithEditor((editorInstance) => {
        if (!data?.content) {
          return
        }
        knownFilePath = typeof data.filePath === 'string' && data.filePath.length > 0 ? data.filePath : null
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

  register(
    window.electronAPI.onSaveFile(() =>
      executeWithEditor(
        async (editorInstance) => {
          const content = editorInstance.getValue()
          const result = await window.electronAPI.saveFile(content)
          if (result?.success) {
            knownFilePath = result.filePath || knownFilePath
            lastAutoSaveTimestamp = Date.now()
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

  register(
    window.electronAPI.onSaveAsFile(() =>
      executeWithEditor(
        async (editorInstance) => {
          const content = editorInstance.getValue()
          const result = await window.electronAPI.saveFileAs(content)
          if (result?.success) {
            knownFilePath = result.filePath || knownFilePath
            lastAutoSaveTimestamp = Date.now()
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

function setupBrowserFallbacks() {
  if (isElectron) {
    return
  }

  if (isDev) {
    console.info('Running in browser mode, enabling local storage persistence')
  }

  window.addEventListener('beforeunload', (event) => {
    if (isEditorDirty) {
      event.preventDefault()
      event.returnValue = ''
    }
  })

  if (!isBrowserStorageAvailable()) {
    showToast('当前浏览器无法访问本地存储，请谨慎操作并手动备份内容')
    return
  }

  const lastPersistedAtRaw = window.localStorage.getItem(LOCAL_STORAGE_UPDATED_AT_KEY)
  if (lastPersistedAtRaw) {
    const timestamp = Number(lastPersistedAtRaw)
    if (!Number.isNaN(timestamp) && timestamp > 0) {
      const formatted = new Date(timestamp).toLocaleString()
      showToast(`浏览器模式已启用，上次自动保存于 ${formatted}`)
    } else {
      showToast('浏览器模式已启用，内容会自动保存到本地存储')
    }
  } else {
    showToast('浏览器模式已启用，内容会自动保存到本地存储')
  }

  executeWithEditor((editorInstance) => {
    persistContentToLocalStorage(editorInstance.getValue())
  })
}

// 页面加载完成后初始化编辑器
document.addEventListener('DOMContentLoaded', () => {
  if (isDev) {
    console.info('Renderer DOMContentLoaded: initializing editor')
  }
  initEditor()
  if (isElectron) {
    setupElectronHandlers()
  } else {
    setupBrowserFallbacks()
  }
})

if (!isElectron && typeof document !== 'undefined') {
  document.addEventListener('keydown', (event) => {
    const key = event.key && event.key.toLowerCase()
    if ((event.ctrlKey || event.metaKey) && key === 's') {
      event.preventDefault()
      showToast('请在桌面应用中使用保存功能以确保数据安全')
    }
  })
}

function markDirtyState(nextDirty) {
  const normalized = Boolean(nextDirty)
  if (isEditorDirty !== normalized) {
    isEditorDirty = normalized

    if (!isElectron && typeof document !== 'undefined') {
      document.title = normalized ? `* ${DEFAULT_DOCUMENT_TITLE}` : DEFAULT_DOCUMENT_TITLE
    }

    if (window.electronAPI && typeof window.electronAPI.setDirty === 'function') {
      try {
        window.electronAPI.setDirty(normalized)
      } catch (error) {
        if (isDev) {
          console.warn('Failed to update dirty state via Electron bridge:', error)
        }
      }
    }
  }

  if (normalized) {
    if (isElectron) {
      scheduleAutoSave()
    } else {
      scheduleBrowserPersist()
    }
  } else if (isElectron) {
    cancelAutoSave()
  } else {
    cancelBrowserPersist()
    executeWithEditor((editorInstance) => {
      persistContentToLocalStorage(editorInstance.getValue())
    })
  }
}

function withDirtyTrackingSuppressed(fn) {
  suppressDirtyTracking = true
  try {
    return fn()
  } finally {
    suppressDirtyTracking = false
  }
}

function sanitizeAltText(rawName) {
  if (typeof rawName !== 'string' || rawName.length === 0) {
    return 'image'
  }

  const cleaned = rawName
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\r\n]/g, ' ')
    .replace(/[\[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned.length > 0 ? cleaned.slice(0, MAX_ALT_TEXT_LENGTH) : 'image'
}

function cancelAutoSave() {
  if (autoSaveTimer) {
    window.clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }
}

function scheduleAutoSave() {
  if (!isElectron || !window.electronAPI) {
    return
  }

  const now = Date.now()
  const elapsed = now - lastAutoSaveTimestamp
  const minimumDelay = elapsed >= AUTO_SAVE_MIN_INTERVAL
    ? AUTO_SAVE_DELAY
    : Math.max(AUTO_SAVE_MIN_INTERVAL - elapsed, AUTO_SAVE_DELAY)

  cancelAutoSave()

  autoSaveTimer = window.setTimeout(() => {
    autoSaveTimer = null
    executeWithEditor(
      async (editorInstance) => {
        const content = editorInstance.getValue()

        // 如果有已知文件路径，保存到原文件；否则保存到autosave文件夹
        let result
        if (knownFilePath) {
          result = await window.electronAPI.saveFile(content)
        } else {
          result = await window.electronAPI.autoSaveFile(content)
        }

        if (result?.success) {
          // 只有在保存到原文件时才更新knownFilePath
          if (knownFilePath) {
            knownFilePath = result.filePath || knownFilePath
          }
          lastAutoSaveTimestamp = Date.now()
          markDirtyState(false)
          if (isDev) {
            console.info('Auto-saved file:', result.filePath)
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
}

function scheduleBrowserPersist() {
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

function cancelBrowserPersist() {
  if (browserPersistTimer) {
    window.clearTimeout(browserPersistTimer)
    browserPersistTimer = null
  }
}

function isBrowserStorageAvailable() {
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

function readPersistedBrowserContent() {
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

function persistContentToLocalStorage(content) {
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

function clearPersistedBrowserContent() {
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

async function executeWithEditor(executor, onError) {
  try {
    const editorInstance = await editorReadyPromise
    if (!editorInstance) return
    return await executor(editorInstance)
  } catch (error) {
    if (typeof onError === 'function') {
      onError(error)
    } else if (isDev) {
      console.error('Editor handler execution failed:', error)
    }
    return undefined
  }
}// 版本历史功能
let versionHistoryModal = null
let versionHistoryFiles = []
let currentSelectedVersion = null

async function loadVersionHistoryFiles() {
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

function formatFileTime(timestamp) {
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

function createVersionHistoryModal() {
  const modal = document.createElement('div')
  modal.className = 'version-history-modal'
  modal.style.display = 'none'

  modal.innerHTML = `
    <div class="version-history-content">
      <div class="version-history-header">
        <h2 class="version-history-title">版本历史</h2>
        <button class="version-history-close" onclick="closeVersionHistory()">×</button>
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
      closeVersionHistory()
    }
  })

  document.body.appendChild(modal)
  return modal
}

async function showVersionHistory() {
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
    listContainer.innerHTML = files.map((file, index) => `
      <div class="version-history-item" onclick="selectVersion(${index})" data-index="${index}">
        <div class="version-history-item-time">${formatFileTime(file.timestamp)}</div>
        <div class="version-history-item-name">${file.fileName}</div>
        <div class="version-history-item-size">${file.size} KB</div>
      </div>
    `).join('')
  }
}

function closeVersionHistory() {
  if (versionHistoryModal) {
    versionHistoryModal.style.display = 'none'
    currentSelectedVersion = null
  }
}

function selectVersion(index) {
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

  previewContainer.innerHTML = `
    <div class="version-history-preview-header">
      <div class="version-history-preview-title">${version.fileName}</div>
      <div class="version-history-actions">
        <button class="version-history-btn-restore" onclick="restoreVersion(${index})">恢复此版本</button>
        <button class="version-history-btn-delete" onclick="deleteVersion(${index})">删除</button>
      </div>
    </div>
    <div class="version-history-content-preview">${escapeHtml(version.contentPreview || version.content)}</div>
  `
}

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

async function restoreVersion(index) {
  const version = versionHistoryFiles[index]
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
        closeVersionHistory()
      }
    }
  } catch (error) {
    console.error('恢复版本失败:', error)
    showToast('恢复版本失败: ' + error.message)
  }
}

async function deleteVersion(index) {
  const version = versionHistoryFiles[index]
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
    showVersionHistory()
  })
}

// 添加版本历史按钮到页面
document.addEventListener('DOMContentLoaded', () => {
  const versionHistoryBtn = document.createElement('button')
  versionHistoryBtn.className = 'version-history-btn'
  versionHistoryBtn.innerHTML = '⚡ 版本历史'
  versionHistoryBtn.title = '查看自动保存的版本历史'
  versionHistoryBtn.onclick = showVersionHistory

  // 将按钮添加到页面
  document.body.appendChild(versionHistoryBtn)
})// 版本历史功能 - 使函数全局可用
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