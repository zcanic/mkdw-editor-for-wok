# main.js 拆分与重构计划

## 1. 目标与动机

当前的 `src/main.js` 文件已超过1000行，成为了一个巨大的单体（God Object）。它混合了UI交互、状态管理、文件IO、编辑器配置、Electron IPC通信等多种职责，导致了以下问题：

- **难以维护**：任何小修改都可能影响到不相关的功能。
- **无法测试**：功能紧密耦合，无法进行单元测试。
- **可读性差**：新开发者难以快速理解代码结构和逻辑。
- **性能瓶颈**：所有代码无论是否需要都会被立即加载和解析。

本次重构的核心目标是遵循**单一职责原则 (SRP)**，将 `main.js` 拆分为多个高内聚、低耦合的模块。

## 2. 拆分原则

- **渐进式重构**：每一步都是一个小的、可验证的修改，确保在整个过程中应用功能正常。
- **明确模块边界**：每个模块应有清晰的职责和接口。
- **无环依赖**：避免模块间的循环依赖。
- **状态集中管理**：将分散的全局状态（如 `isEditorDirty`, `knownFilePath`）集中管理。

## 3. 目标目录结构

建议在 `src` 目录下创建以下结构来组织代码：

```
src/
├── main.js               # 新的入口文件，仅用于模块编排和初始化
|
├── core/
│   ├── editor.js         # 负责 Vditor 实例的初始化、配置和生命周期管理
│   ├── constants.js      # 存放所有魔法数字、字符串和常量
│   └── state.js          # 全局应用状态管理（如 isDirty, filePath）
|
├── modules/
│   ├── ipc-handlers.js   # 注册和处理所有 Electron IPC 事件
│   ├── file-system.js    # 封装文件操作逻辑（自动保存、读写）
│   ├── uploader.js       # 处理文件（图片）上传逻辑
│   └── browser-support.js# 浏览器环境下的兼容/回退逻辑（如 localStorage）
|
└── ui/
    ├── toast.js          # Toast 提示组件
    ├── resizer.js        # Outline 侧边栏拖拽功能
    ├── sanitizer.js      # DOM 清理与安全处理
    └── dom-helpers.js    # DOM 操作的辅助函数
```

## 4. 详细拆分路径与步骤

### 第一阶段：准备工作与低风险模块提取

1.  **创建目录结构**：按照上述 `目标目录结构` 创建文件夹和空的 `.js` 文件。
2.  **提取常量**：
    - **动作**：创建 `src/core/constants.js`。将 `main.js` 文件顶部所有独立的常量（如 `MAX_INLINE_IMAGE_SIZE`, `LOCAL_STORAGE_KEYS` 等）剪切到此文件中。
    - **导出/导入**：在 `constants.js` 中使用 `export` 导出，并在 `main.js` 和其他需要的文件中导入。
3.  **提取UI模块 - Toast**：
    - **动作**：创建 `src/ui/toast.js`。将 `showToast` 函数及其相关变量 (`activeToast`, `toastHideTimer` 等) 移动到此文件。
    - **接口**：导出一个 `showToast` 函数。

### 第二阶段：核心逻辑拆分

4.  **提取UI模块 - Resizer & Sanitizer**：
    - **动作**：将 `initOutlineResizer` 逻辑移入 `src/ui/resizer.js`，导出 `init` 函数。
    - **动作**：将 `sanitizeInlineHandlers`, `observeAndSanitizeInlineHandlers` 等相关函数移入 `src/ui/sanitizer.js`。
5.  **提取状态管理**：
    - **动作**：创建 `src/core/state.js`。用于管理 `isEditorDirty`, `knownFilePath`, `suppressDirtyTracking` 等全局状态。
    - **接口**：提供 `getState`, `setDirty`, `setFilePath` 等原子化操作函数，并实现一个简单的发布/订阅模式，以便状态变更时通知其他模块。
6.  **提取IPC处理器**：
    - **动作**：创建 `src/modules/ipc-handlers.js`。将 `setupElectronHandlers` 函数的全部内容移入此文件。
    - **依赖**：该模块会依赖 `state.js` 来更新状态，并依赖 `editor.js` 的接口来操作编辑器。
7.  **提取文件上传逻辑**：
    - **动作**：创建 `src/modules/uploader.js`。将 Vditor 配置中的 `upload.handler` 的复杂逻辑提取出来，放到此文件中。
    - **接口**：导出一个 `handleFileUpload(files, vditorInstance)` 函数。

### 第三阶段：编辑器与主入口重构

8.  **重构编辑器核心**：
    - **动作**：创建 `src/core/editor.js`。将 `initEditor` 函数和所有与 Vditor 实例相关的逻辑（如 `getInitialEditorContent`, `renderInitError`）移入此文件。
    - **接口**：导出一个 `init(initialContent)` 函数和一个 `getInstance()` 函数来获取 Vditor 实例。
9.  **提取文件系统与浏览器支持**：
    - **动作**：创建 `src/modules/file-system.js`。将 `scheduleAutoSave`, `cancelAutoSave` 等逻辑移入。
    - **动作**：创建 `src/modules/browser-support.js`。将 `setupBrowserFallbacks`, `persistContentToLocalStorage` 等非 Electron 环境的逻辑移入。
10. **重写主入口 `main.js`**：
    - **动作**：此时的 `main.js` 应非常简洁。它负责按顺序导入并调用各模块的初始化函数。
    - **示例代码**：
      ```javascript
      import { init as initEditor } from './core/editor.js';
      import { setupIpc } from './modules/ipc-handlers.js';
      import { setupBrowserFallbacks } from './modules/browser-support.js';
      import { isElectron } from './core/constants.js';

      document.addEventListener('DOMContentLoaded', () => {
        initEditor();
        if (isElectron) {
          setupIpc();
        } else {
          setupBrowserFallbacks();
        }
      });
      ```

## 5. 后续工作

拆分完成后，代码结构将变得清晰，这为以下改进铺平了道路：

- **单元测试**：可以为 `state.js`, `uploader.js`, `sanitizer.js` 等独立模块编写 Vitest 或 Jest 测试。
- **功能扩展**：在独立的模块中添加新功能（如新的UI组件、新的IPC事件）将变得更加容易和安全。
- **代码质量工具**：引入 ESLint 和 Prettier，并对新模块强制执行代码规范。
