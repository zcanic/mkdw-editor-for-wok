/**
 * 应用常量配置
 * 集中管理所有魔法数字和配置字符串
 */

// 环境与运行时
export const isDev = import.meta.env.DEV
export const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI)
export const DEFAULT_DOCUMENT_TITLE = typeof document !== 'undefined' ? document.title : 'WOK Editor'

// 图片上传配置
export const MAX_INLINE_IMAGE_SIZE_MB = 1
export const MAX_INLINE_IMAGE_SIZE = MAX_INLINE_IMAGE_SIZE_MB * 1024 * 1024
export const MAX_CONCURRENT_FILE_READS = 3
export const MAX_ALT_TEXT_LENGTH = 100

// UI 交互配置
export const TOAST_DISPLAY_DURATION = 2000
export const TOAST_TRANSITION_DURATION = 300
export const OUTLINE_MIN_WIDTH = 200
export const OUTLINE_MAX_WIDTH = 600
export const PREVIEW_RENDER_DELAY = 150

// 自动保存配置
export const AUTO_SAVE_DELAY = 3000
export const AUTO_SAVE_MIN_INTERVAL = 10000

// 浏览器本地存储配置
export const LOCAL_STORAGE_CONTENT_KEY = 'wok-editor:last-content'
export const LOCAL_STORAGE_UPDATED_AT_KEY = 'wok-editor:last-updated'
export const BROWSER_AUTO_SAVE_DELAY = 1500
export const BROWSER_MAX_PERSISTED_CHAR_COUNT = 700000
