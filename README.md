# WOK Editor 桌面版

基于 Vditor + Electron 的 Markdown 编辑器。

## 特性

- 极简、便携：无需安装器，解压即用。
- Vditor IR 模式编辑与预览切换。
- 预览按钮无提示栏：已禁用"预览/preview"按钮的 tooltip，避免遮挡或残留。
- CSP 安全加固：实现内容安全策略，防止内联脚本执行。
- 本地资源打包：Vditor 资源完全本地化，无需外部网络请求。


## 开发

```bash
npm install
npm run dev
```

## 打包与运行（便携版）

```powershell
# 安装依赖
npm install

# 构建（Vite + Electron 便携版）
npm run electron:dist

# 运行（无需安装）
Start-Process -FilePath "release/win-unpacked/WOK Editor.exe"
```

- Windows 构建现在只生成便携目录：`release/win-unpacked/`。
- 直接运行其中的 `WOK Editor.exe` 即可，无需安装器。
- 若需创建桌面或开始菜单快捷方式，可手动创建指向该 EXE 的快捷方式。

更多项目背景见 `项目策划案：Project WOK (Words to Knowledge).md`。
