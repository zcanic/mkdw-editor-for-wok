/**
 * Outline 侧边栏拖拽调整宽度功能
 * 负责为 .vditor-outline 元素添加可拖拽的 resizer 手柄
 */

import { OUTLINE_MIN_WIDTH, OUTLINE_MAX_WIDTH } from '../core/constants.js'

/**
 * 初始化 outline resizer 功能
 * @param {HTMLElement} editorElement - Vditor 编辑器根元素
 * @param {Object} vditorInstance - Vditor 实例，用于调用 resize()
 */
export function initOutlineResizer(editorElement, vditorInstance) {
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
      if (vditorInstance) {
        vditorInstance.resize()
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
