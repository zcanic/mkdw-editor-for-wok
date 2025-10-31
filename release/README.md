# 打包产物与安装说明

构建后的产物统一存放在 `release/` 目录下：

- macOS：`release/mac/`（dmg、zip、解包目录等）
- Windows（便携版）：`release/win-unpacked/`（直接运行 `WOK Editor.exe`）

## 如何构建

```bash
# 本机构建（会先执行 Vite 构建，再调用 electron-builder）
npm run electron:dist
```

> **注意事项**：
> - 当前构建仅生成 Windows 便携版（dir 目标），不再产出 NSIS 安装器
> - 构建前确保 Vditor 资源已正确复制到 `public/vditor` 目录（包含完整的包结构，非仅 dist 目录）
> - 首次构建或 Vditor 版本更新后，需重新复制资源

## 便携运行（无需安装）

`release/win-unpacked/` 下包含已解包的应用，可直接运行其中的 `WOK Editor.exe` 进行便携式使用（适合调试与快速验证）。

## 技术说明

### CSP 安全策略
- 实施严格的内容安全策略（Content Security Policy）
- 禁用内联脚本执行，防止 XSS 攻击
- 实现了多层 CSP 防护机制：innerHTML 拦截、事件处理器清理、动态内容监控

### 资源本地化
- Vditor 编辑器资源完全本地打包，无外部 CDN 依赖
- 确保离线环境下的完整功能支持
- 资源路径：`public/vditor`（构建后位于 `dist/vditor`）

---

⚠️ **发布提醒**：二进制产物通常被 `.gitignore` 排除，发布前请在本地或 CI 环境执行构建再产出安装包。