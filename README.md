# LiteMark

> 一个轻量、简约的**本地** Markdown 编辑器 —— 打开就能写，写完能排版。

左边文件树，中间编辑区，底下状态栏。所有文档都留在你自己的磁盘上：不联网、不建账号、不上传内容（除非你自己开了图床）。

## ⚠️ 关于 AI 的参与（请先读这一段）

**本项目绝大部分代码由 AI 编写，人类负责提需求、拍板方案和验收。**

| 分工 | 谁做的 |
| --- | --- |
| 全部代码 | AI（在 [WorkBuddy](https://www.workbuddy.cn) 的 SeniorDeveloper 专家模式下逐轮生成） |
| 需求与优先级 | 人类 |
| 技术选型与关键决策 | 人类拍板（例如：不做 MarkText fork、放弃 Tauri 改 Neutralino、PDF 引擎用 Typst 而不集成、欢迎页保持 Markdown 文档形态） |
| 问题发现与反馈 | 人类（截图报错、真机试用、指出现象） |
| 真机验证与验收 | 人类 + AI（AI 跑构建与脚本验证，人类跑 GUI 与安装程序） |

具体到这个仓库：从窗口壳、编辑器集成、文件树、快捷键系统、Pandoc 导出、Typst 一键安装、代码高亮，到 Inno Setup 打包脚本，**没有一行是手写的**。人类做的是不断提出「这里不对 / 我要这个」，以及在真机上确认结果。

所以：**发现 bug 很正常，多半是 AI 写的锅**，欢迎开 issue。

## 功能

**编辑**
- 即时渲染（所见即所得），不用背 Markdown 语法；需要时按 `Ctrl + /` 切到源码模式
- 表格悬停出「行操作 / 列操作」把手，增删行列不用手打竖线
- 代码块浅灰底 + 语言标记（悬停右上角选语言）+ 16 种语言高亮
  （JavaScript / TypeScript / Python / JSON / HTML / CSS / Bash / Markdown / YAML / SQL / Java / C / C++ / C# / Go / Rust）
- 全部命令的快捷键可改绑，也能一键恢复默认

**文件**
- 文件树懒加载，多标签页，未保存标记
- 启动时恢复上次的文件夹、标签页、界面状态、设置面板位置（可逐项关掉）

**图片**
- 粘贴截图自动落盘并引用；本地图片 / 网络图片各有快捷键
- 鼠标悬停图片可改链接；配了 PicGo 就能一键上传图床，失败自动回退本地路径

**导出与导入（依赖 Pandoc）**
- 导出：Word / PDF / HTML / EPUB / PowerPoint / OpenDocument / RTF / 纯文本
- 导入：Word / HTML / ODT / RTF / EPUB / DocBook / LaTeX，图片自动抽到 `原文件名.assets`
- Word 支持参考模板（`ref.docx`）套样式；PDF 引擎推荐 Typst，设置里可一键安装

**外观**
- 跟随系统 / 亮色 / 暗色，正文字号可调
- 自绘无边框标题栏

## 下载安装

到 [Releases](../../releases) 下载 `LiteMark-Setup-x.y.z.exe`。

- 系统要求：Windows 10/11 x64（依赖 Edge WebView2 运行时，新系统自带）
- 安装程序默认给当前用户装（不需要管理员）；向导首页可以切「为所有用户安装」
- 卸载不会删配置（`%APPDATA%\LiteMark\settings.json`）

## 从源码构建

```bash
npm install
npx neu update      # 下载 Neutralino 运行时二进制到 bin/（国内建议挂代理）
```

```bash
npm run dev         # 浏览器里预览（原生功能会降级）
npm run app         # 构建 + 启动桌面窗口
```

## 打包 Windows 安装程序

```bash
npm run release     # vite build + neu build --release → release/litemark/
npm run installer   # 生成图标 + 调 ISCC 编译 → release/installer/LiteMark-Setup-x.y.z.exe
```

打包需要 [Inno Setup 6](https://jrsoftware.org/isdl.php)：

```powershell
winget install -e --id JRSoftware.InnoSetup --scope user
```

## 技术栈

| 层 | 用的什么 |
| --- | --- |
| 桌面壳 | [Neutralino](https://neutralino.js.org) v6.9.0（Windows 上跑在 WebView2 里，二进制约 2.4MB） |
| 前端 | Vue 3 + TypeScript + Vite 6 |
| 编辑器 | [Milkdown](https://milkdown.dev)（ProseMirror） |
| 高亮 | refractor（Prism 的 ESM 封装），走 ProseMirror Decoration，只改视图不改文档 |
| 样式 | 手写 CSS 变量，无 UI 框架 |
| 打包 | neu CLI + Inno Setup |

## 项目结构

```
src/
  App.vue            主界面、标签页状态机、设置面板、右键菜单
  components/        TitleBar / FileTree / TabsBar / EditorPane / StatusBar / ImageBar
                     TableHandles / CodeLang / ContextMenu
  bridge.ts          Neutralino 原生能力封装（文件、对话框、窗口）
  store.ts           配置落盘（%APPDATA%\LiteMark\settings.json）
  startup.ts         启动恢复
  shortcuts.ts       可改绑快捷键系统
  highlight.ts       代码高亮语言表与着色
  pandoc.ts          Pandoc 导出 / 导入配置
  pdfEngines.ts      PDF 引擎扫描
  typstInstall.ts    Typst 一键安装
installer/           Inno Setup 脚本与打包入口
scripts/app.js       开发模式启动壳
public/icon.png      运行时的窗口图标
icon.png             打包时的图标源（neu 按项目根路径读它）
```

## 已知限制

- 文件树只列 `.md` / `.markdown` / `.txt`
- 导出 PDF 需要额外引擎（Typst 或 LaTeX/wkhtmltopdf），安装包不附带
- 图片以绝对路径写进文档，不随文档一起复制/移动
- 代码只做了 Windows 安装包；源码本身跨平台（Neutralino 支持 Linux/macOS）
- 装到 `Program Files` 时程序写不了自己的日志文件，属正常现象（配置在 `%APPDATA%`，不受影响）

## 许可证

[MIT](LICENSE)
