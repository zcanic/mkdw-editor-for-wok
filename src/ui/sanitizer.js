/**
 * DOM 安全处理模块
 * 负责清理和净化 Vditor 生成的 HTML，确保符合 CSP 策略
 */

import { MAX_ALT_TEXT_LENGTH } from '../core/constants.js'

let inlineEventGuardInstalled = false

/**
 * 安装 innerHTML 安全守卫
 * 拦截并清理所有通过 innerHTML 注入的内联事件处理器
 */
export function installInlineEventAttributeGuard() {
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

/**
 * 清理 DOM 中的内联事件处理器
 * 移除 onclick、onmouseover 等属性，并附加安全的事件监听器
 * @param {Element} root - 要清理的根元素（默认为 document）
 */
export function sanitizeInlineHandlers(root = document) {
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

/**
 * 观察 DOM 变化并自动清理新添加的内联处理器
 * 使用 MutationObserver 监听 DOM 树的变化
 */
export function observeAndSanitizeInlineHandlers() {
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

/**
 * 清理图片 alt 文本，移除不安全字符
 * @param {string} rawName - 原始文件名
 * @returns {string} 清理后的 alt 文本
 */
export function sanitizeAltText(rawName) {
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
