# WOK Editor 桌面版

基于 Vditor + Electron 的 Markdown 编辑器。

## 开发

```bash
npm install
npm run dev
```

## 桌面应用打包

| 平台 | 命令 | 产物目录 |
| --- | --- | --- |
| macOS | `npm run electron:dist` | `release/mac/` |
| Windows | `npm run electron:dist -- --win` | `release/windows/` |

> - Windows 打包需要在 Windows 环境执行，或在 macOS 上配置好对应的交叉编译环境。
> - 产物目录中包含 `.gitkeep` 以保留路径，实际文件已被忽略，需在发布时重新构建。

更多项目背景见 `项目策划案：Project WOK (Words to Knowledge).md`。
