/**
 * 常量定义模块
 * 包含应用中使用的所有常量配置
 */

// 环境相关
export const isDev = import.meta.env.DEV
export const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI)

// 文档相关
export const DEFAULT_DOCUMENT_TITLE = typeof document !== 'undefined' ? document.title : 'WOK Editor'

// 图片相关
export const MAX_INLINE_IMAGE_SIZE_MB = 1
export const MAX_INLINE_IMAGE_SIZE = MAX_INLINE_IMAGE_SIZE_MB * 1024 * 1024
export const MAX_ALT_TEXT_LENGTH = 100
export const MAX_CONCURRENT_FILE_READS = 3

// UI 相关
export const TOAST_DISPLAY_DURATION = 2000
export const TOAST_TRANSITION_DURATION = 300
export const OUTLINE_MIN_WIDTH = 200
export const OUTLINE_MAX_WIDTH = 600
export const PREVIEW_RENDER_DELAY = 150

// 自动保存相关
export const AUTO_SAVE_DELAY = 3000
export const AUTO_SAVE_MIN_INTERVAL = 10000
export const LOCAL_STORAGE_CONTENT_KEY = 'wok-editor:last-content'
export const LOCAL_STORAGE_UPDATED_AT_KEY = 'wok-editor:last-updated'

// 浏览器存储相关
export const BROWSER_AUTO_SAVE_DELAY = 1500
export const BROWSER_MAX_PERSISTED_CHAR_COUNT = 700000

// Vditor 相关
export const vditorLocale = typeof window !== 'undefined' && window.VditorI18n ? window.VditorI18n : undefined

// 初始化 Vditor 国际化
if (typeof window !== 'undefined' && vditorLocale) {
  window.VditorI18n = vditorLocale
}
