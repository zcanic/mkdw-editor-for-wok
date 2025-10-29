# 打包产物与安装说明

构建后的产物统一存放在 `release/` 目录下：

- macOS：`release/mac/`（dmg、zip、解包目录等）。
- Windows（便携版）：`release/win-unpacked/`（直接运行 `WOK Editor.exe`）。

## 如何构建

```bash
# 本机构建（会先执行 Vite 构建，再调用 electron-builder）
npm run electron:dist
```

> 注：当前构建仅生成 Windows 便携版（dir 目标），不再产出 NSIS 安装器。

## 便携运行（无需安装）

`release/win-unpacked/` 下包含已解包的应用，可直接运行其中的 `WOK Editor.exe` 进行便携式使用（适合调试与快速验证）。

---


I'm coming!
⚠️ 二进制产物通常被 `.gitignore` 排除，发布前请在本地或 CI 环境执行构建再产出安装包。