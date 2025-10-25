import Vditor from 'vditor'
import 'vditor/dist/index.css'

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
      // 性能优化配置
      performance: {
        // 禁用不必要的动画效果
        enableAnimation: false,
        // 减少渲染延迟
        renderDelay: 0,
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
