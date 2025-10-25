# 打包产物存放说明

Electron Builder 的打包产物按照平台存放在 `release/` 目录下：

- **macOS**：产出文件（`dmg`、`zip`、`mac-*` 解包目录等）会生成在 `release/mac/`。
- **Windows**：产出文件（`exe`、`nsis` 安装包、`win-*` 解包目录等）会生成在 `release/windows/`。

运行以下命令可以分别触发构建：

```bash
# macOS / 本机构建
npm run electron:dist

# Windows（需要在 Windows 环境或配置了对应交叉编译工具链的环境中）
npm run electron:dist -- --win
```

> ⚠️ 目录下的实际二进制产物已被 `.gitignore` 排除，请在需要发布时再生成。