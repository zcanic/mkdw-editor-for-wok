/**
 * Toast 提示组件
 * 提供简单的消息提示功能
 */

import { TOAST_DISPLAY_DURATION, TOAST_TRANSITION_DURATION } from '../core/constants.js'

let activeToast = null
let toastHideTimer = null
let toastRemoveTimer = null

/**
 * 显示 Toast 提示消息
 * @param {string} message - 要显示的消息内容
 */
export function showToast(message) {
  if (!message) return

  // 清除已存在的 Toast
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
