# CSP 安全策略说明

## 当前 CSP 配置

```
default-src 'self';
img-src 'self' data: https:;
style-src 'self' 'unsafe-inline';
script-src 'self';
font-src 'self' data:;
connect-src 'self' ws: wss:;
worker-src 'self' blob:;
object-src 'self' data:;
```

## 功能权衡

### ✅ 已启用的功能
- ✅ 所有基础 Markdown 语法
- ✅ 代码高亮（本地）
- ✅ 图片嵌入（本地 + Base64）
- ✅ 表格、引用、列表
- ✅ 目录（TOC）
- ✅ 脚注
- ✅ 代码块复制

### ❌ 已禁用的功能（为满足严格 CSP）

#### 1. **数学公式渲染** 
- **原因**: Vditor 使用 `addScriptSync` 动态加载 MathJax
- **技术细节**: 该函数通过 XMLHttpRequest 获取脚本内容，然后使用 `scriptElement.text = xhrObj.responseText` 注入，这违反了 `script-src 'self'` 策略
- **影响**: 无法渲染 LaTeX 数学公式
- **替代方案**: 
  - 使用图片形式的公式
  - 使用纯文本表示
  - 如果必需，可以考虑预加载 MathJax（需要修改构建流程）

#### 2. **PlantUML 图表**
- **原因**: 依赖远程服务 `https://www.plantuml.com`
- **影响**: 无法渲染 UML 图表
- **替代方案**: 使用 Mermaid 图表（本地渲染）

#### 3. **ECharts 可视化**
- **原因**: 使用 `new Function()` 或 `eval()`，违反 CSP
- **影响**: 无法渲染动态图表
- **替代方案**: 使用静态图片或简化的 SVG 图表

#### 4. **Graphviz 图表**
- **原因**: 使用 Worker + blob: URL，可能受限
- **影响**: 图形渲染受限
- **替代方案**: 使用 Mermaid 或其他本地图表库

## 如果需要启用数学公式

### 方案 A: 放宽 CSP（不推荐）
修改 `index.html` 中的 CSP：
```html
script-src 'self' 'unsafe-inline';
```
**风险**: 允许所有内联脚本，降低安全性

### 方案 B: 预加载 MathJax（推荐）
1. 将 MathJax 添加到本地资源
2. 在 HTML 中静态引入：
```html
<script src="./vditor/dist/js/mathjax/tex-svg-full.js"></script>
```
3. 修改 Vditor 配置，指向本地路径

### 方案 C: 使用 KaTeX（最佳方案）
KaTeX 不需要动态脚本加载，可以：
1. 预加载 KaTeX 库
2. 修改 Vditor 配置使用 KaTeX
3. 保持严格的 CSP

## 浏览器扩展警告

某些浏览器扩展可能注入外部资源，导致 CSP 警告：
```
Refused to load the font 'https://r2cdn.perplexity.ai/fonts/...'
```

这些警告来自：
- Perplexity AI 扩展
- Grammarly
- 其他修改页面的扩展

**解决方法**: 在无扩展模式下测试，或将扩展添加到白名单

## 开发建议

### 开发环境
如果 CSP 严重影响开发体验，可以：
1. 创建 `index.dev.html` 使用宽松的 CSP
2. 使用环境变量控制 CSP 策略
3. 在 Electron 环境中通过代码设置 CSP

### 生产环境
保持当前的严格 CSP 策略，确保：
- 防止 XSS 攻击
- 阻止未授权的脚本执行
- 保护用户数据安全

## 参考
- [MDN: Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [Vditor 文档](https://github.com/Vanessa219/vditor)
- [CSP Evaluator](https://csp-evaluator.withgoogle.com/)
