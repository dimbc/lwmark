<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from "vue";
import { MilkdownProvider } from "@milkdown/vue";
import TitleBar from "./components/TitleBar.vue";
import StatusBar from "./components/StatusBar.vue";
import ContextMenu, { type MenuItem } from "./components/ContextMenu.vue";
import EditorPane from "./components/EditorPane.vue";
import FileTree from "./components/FileTree.vue";
import TabsBar, { type Tab } from "./components/TabsBar.vue";
import ResizeHandles from "./components/ResizeHandles.vue";
import {
  inNL,
  openMarkdown,
  saveMarkdown,
  openFolder,
  readDir,
  readFileText,
  writeFileText,
  joinPath,
  pickImage,
  pickImageBrowser,
  fileToBase64,
  picgoUpload,
  picgoPing,
  pandocDetect,
  pickAnyFile,
} from "./bridge";
import {
  SHORTCUTS,
  GROUPS,
  loadBindings,
  saveBindings,
  defaultBindings,
  formatBinding,
  bindingFromEvent,
  matchEvent,
  sameBinding,
  type Binding,
} from "./shortcuts";
import { loadPicgo, savePicgo, DEFAULT_SERVER, type PicgoConf } from "./picgo";
import {
  FORMATS,
  loadPandoc,
  pickedFormats,
  savePandoc,
  type OutMode,
  type PandocConf,
} from "./pandoc";
import { baseName, cleanEngine, engineLabel, isEnginePath } from "./pdfEngines";
import {
  STARTUP_ITEMS,
  SESSION,
  loadOpenTabs,
  loadStartup,
  saveOpenTabs,
  saveStartup,
  type StartupConf,
} from "./startup";
import { maximized, trackWindow, stopWindowTracking } from "./windowState";
import { kvDel, kvGet, kvGetBool, kvSet, kvSetBool } from "./store";
import { exportDoc, importDoc } from "./pandocRun";
import { WINGET_CMDS, TYPST_SHOW_CMD, runTypst, type TypstResult } from "./typstInstall";

const WELCOME = `# 欢迎使用 LiteMark

> 一个轻量、简约的**本地** Markdown 编辑器 —— 打开就能写，写完能排版。

左边是文件树，中间是编辑区，底下是状态栏。所有文档都留在你自己的磁盘上：LiteMark 不联网、不建账号、不上传内容。

## 快速上手

- [ ] 点侧栏的文件夹图标，选一个目录 —— 左侧就长出目录树
- [ ] 打开一篇 .md，随便敲点东西 —— 文件名旁的小圆点表示还没保存
- [ ] 按 \`Ctrl + S\` 落盘，圆点消失

想写纯文本？按 \`Ctrl + /\` 切到**源码模式**，再按一次切回来。当前模式一直显示在左下角。

## 编辑

**所见即所得**，不用背语法：输入 \`# \` 是标题，\`- \` 是列表，\`> \` 是引用，\`---\` 是分割线。

| 想要 | 按 |
| --- | --- |
| 加粗 / 斜体 | \`Ctrl + B\` / \`Ctrl + I\` |
| 删除线 | \`Ctrl + Shift + X\` |
| 行内代码 | \`Ctrl + E\` |
| 标题 1 ~ 6 | \`Ctrl + Shift + 1\` ~ \`6\`（\`0\` 退回正文） |
| 有序 / 无序列表 | \`Ctrl + Shift + 7\` / \`Ctrl + Shift + 8\` |
| 列表缩进 / 提升 | \`Ctrl + ]\` / \`Ctrl + [\` |
| 引用块 | \`Ctrl + Shift + B\` |
| 代码块 | \`Ctrl + Shift + C\` |
| 撤销 / 重做 | \`Ctrl + Z\` / \`Ctrl + Y\` |
| 保存 / 新建 / 打开文件 | \`Ctrl + S\` / \`Ctrl + N\` / \`Ctrl + O\` |
| 打开文件夹 | \`Ctrl + Shift + O\` |
| 下一个 / 上一个标签 | \`Ctrl + Tab\` / \`Ctrl + Shift + Tab\` |

表格和分割线在**右键菜单**里，图片、格式命令也都在那儿。鼠标移到表格上，两侧会冒出「行操作」「列操作」按钮，增删行列不用手打竖线。

## 图片

| 操作 | 怎么做 |
| --- | --- |
| 粘贴截图 | 直接 \`Ctrl + V\`，自动落盘再引用 |
| 插入本地图片 | \`Ctrl + Alt + I\` |
| 插入网络图片 | \`Ctrl + Shift + Alt + I\`，填 URL |
| 换图片地址 | 鼠标移到图片上，下方浮出链接框，回车生效 |
| 传到图床 | 链接框右侧的上传按钮（要先在设置里配好 PicGo） |

## 代码块

代码块是浅灰底，右上角浮出语言标签 —— 点开列表选一门语言，就会照语言上色。

\`\`\`python
def greet(name: str) -> str:
    """颜色跟随主题明暗自动切换。"""
    return f"Hello, {name}!"
\`\`\`

内置 16 种语言：JavaScript、TypeScript、Python、JSON、HTML / XML、CSS、Bash、Markdown、YAML、SQL、Java、C、C++、C#、Go、Rust。别名也认（\`js\`、\`py\`、\`yml\` 之类）。

## 导出与导入（Pandoc）

Pandoc 打开后，侧栏顶部的导出按钮和右键菜单里就会出现入口。

- **导出**：Word、PDF、HTML、EPUB、PowerPoint、OpenDocument、RTF、纯文本
- **导入**：Word、HTML、ODT、RTF、EPUB、DocBook、LaTeX，图片自动抽到 原文件名.assets 目录

三个值得知道的点：

1. **导出位置**可以固定成「源文件同目录 / 每次都问 / 指定目录」
2. **Word 参考模板**：给一份 ref.docx，导出的文档就套它的样式
3. **PDF 引擎**推荐 Typst —— 设置 → Pandoc 里有一键安装，不用拖着一个几百 MB 的 TeX 发行版

## 图床（PicGo）

填上 PicGo 的 Server 地址（默认 \`http://127.0.0.1:36677\`）再打开开关，就能分别决定「粘贴图片时」和「插入本地图片时」是上传图床还是留本地路径。上传失败会自动回退本地路径，只在角落提示一下，不打断写作。

## 设置里有什么

| 分类 | 内容 |
| --- | --- |
| 启动 | 重开时是否恢复上次的文件夹、标签页、界面状态、设置面板位置 |
| 外观 | 主题（跟随系统 / 亮色 / 暗色）、正文字号 |
| 快捷键 | 所有命令可改绑：点按键框，直接按下新组合 |
| 图床 | PicGo 地址与自动上传时机 |
| Pandoc | 路径、导出格式、导出位置、PDF 引擎、参考模板、额外参数 |

顶栏左侧的 **LiteMark** 点一下就是设置（\`Ctrl + ,\`），侧栏折叠是 \`Ctrl + \\\`。

## 数据在哪

界面设置存在 \`%APPDATA%\\LiteMark\\settings.json\`，重启、换端口都不会丢；文档本身永远只在你的磁盘上。

---

**这篇读完了？全选删掉，开始写你自己的东西吧。**
`;

/* ---------- 启动恢复项（设置 → 启动） ---------- */
/** 选项本身的读取必须在下面那几个 ref 之前：源码模式 / 侧栏折叠的初值要看它 */
const startup = ref<StartupConf>(loadStartup());

function setStartup(patch: Partial<StartupConf>) {
  startup.value = { ...startup.value, ...patch };
  saveStartup(startup.value);
}

const tabs = ref<Tab[]>([{ path: null, name: "未命名.md", text: WELCOME, dirty: false }]);
const active = ref(0);
const docToken = ref(0);
/** 源码模式：编辑区换成纯文本 textarea，格式命令改为直接改文本 */
const sourceMode = ref(startup.value.ui && kvGetBool(SESSION.source, false));
const words = ref(0);
const chars = ref(0);

const pane = ref<InstanceType<typeof EditorPane> | null>(null);
const tree = ref<InstanceType<typeof FileTree> | null>(null);
const folderRoot = ref<string | null>(null);
const collapsed = ref(startup.value.ui && kvGetBool(SESSION.collapsed, false));
const sidebarWidth = ref(Number(kvGet("lm-sidebar-w")) || 220);

function onSidebarResize(w: number) {
  sidebarWidth.value = w;
  kvSet("lm-sidebar-w", String(w));
}

/* ---------- 设置 ---------- */
const settingsOpen = ref(false);
type ThemeMode = "system" | "light" | "dark";
const themeMode = ref<ThemeMode>((kvGet("lm-theme") as ThemeMode) || "system");
const editorFont = ref(Number(kvGet("lm-font")) || 15.5);

function applyTheme() {
  if (themeMode.value === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = themeMode.value;
  }
}

function setTheme(m: ThemeMode) {
  themeMode.value = m;
  kvSet("lm-theme", m);
  applyTheme();
}

function setFont(size: number) {
  editorFont.value = size;
  kvSet("lm-font", String(size));
  document.documentElement.style.setProperty("--editor-font", size + "px");
}

function openSettings() {
  settingsOpen.value = true;
  void probeTypst();
}

function closeSettings() {
  stopRecord();
  settingsOpen.value = false;
}

/* ---------- 图床（PicGo） ---------- */
const picgo = ref<PicgoConf>(loadPicgo());
const picgoTesting = ref(false);
const picgoTestMsg = ref("");
const picgoTestBad = ref(false);

function setPicgo(patch: Partial<PicgoConf>) {
  picgo.value = { ...picgo.value, ...patch };
  savePicgo(picgo.value);
}

async function testPicgo() {
  if (picgoTesting.value) return;
  picgoTesting.value = true;
  picgoTestBad.value = false;
  picgoTestMsg.value = "正在连接…";
  const res = await picgoPing(picgo.value.server);
  picgoTesting.value = false;
  picgoTestBad.value = !res.ok;
  picgoTestMsg.value = res.ok ? "服务在线，可以上传" : res.error;
}

/* ---------- Pandoc 导出 / 导入 ---------- */
const pandoc = ref<PandocConf>(loadPandoc());
/** 转换期间挡住重复触发（pandoc 是外部进程，慢操作） */
const pandocBusy = ref(false);
const pandocTestMsg = ref("");
const pandocTestBad = ref(false);

/** 导出位置策略：与源文件同目录 / 每次询问 / 固定目录 */
const OUT_MODES: { id: OutMode; label: string }[] = [
  { id: "source", label: "源文件同目录" },
  { id: "ask", label: "每次询问" },
  { id: "fixed", label: "固定目录" },
];

function setPandoc(patch: Partial<PandocConf>) {
  pandoc.value = { ...pandoc.value, ...patch };
  savePandoc(pandoc.value);
}

/** 默认格式下拉：只列勾选过的格式（外加当前值，免得显示成空白） */
const formatOptions = computed(() =>
  FORMATS.filter(
    (f) => pandoc.value.exports.includes(f.id) || f.id === pandoc.value.format,
  ),
);

/** 勾选「导出按钮里列出哪些格式」；一个都不勾时列表回退成只列默认格式 */
function toggleExportFormat(id: string, on: boolean) {
  const set = new Set(pandoc.value.exports);
  if (on) set.add(id);
  else set.delete(id);
  // 顺序恒按 FORMATS 声明序，勾选顺序不会让列表跳来跳去
  setPandoc({ exports: FORMATS.filter((f) => set.has(f.id)).map((f) => f.id) });
}

async function testPandoc() {
  if (pandocBusy.value) return;
  pandocBusy.value = true;
  pandocTestBad.value = false;
  pandocTestMsg.value = "正在检测…";
  const res = await pandocDetect(pandoc.value.exe);
  pandocBusy.value = false;
  pandocTestBad.value = !res.ok;
  pandocTestMsg.value = res.ok ? `已就绪 · ${res.version}` : res.error;
}

async function choosePandocOutDir() {
  const dir = await openFolder();
  if (dir) setPandoc({ outDir: dir });
}

async function chooseRefDocx() {
  const f = await pickAnyFile("选择 Word 参考模板（.docx）", ["docx"]);
  if (f) setPandoc({ refDocx: f });
}

/* ---------- Typst 引擎（PDF，一键安装） ---------- */
const typstBusy = ref(false);
const typstMsg = ref("");
const typstBad = ref(false);
const typstExe = ref("");
const typstVer = ref("");
const typstLog = ref("");
/** winget 状态一行（版本 · 路径，或「未安装」） */
const typstWinget = ref("");
/** 脚本明确报「没有 winget」时才展开安装命令区 */
const typstNoWinget = ref(false);
/** 脚本扫到的本机 PDF 引擎（顺序同 pdfEngines.ts 的候选表） */
const engineHits = ref<{ id: string; exe: string }[]>([]);
/** 只在用户点开设置后自动探一次，别在启动时就白跑一次 PowerShell */
let typstProbed = false;

function applyTypst(r: TypstResult, install: boolean) {
  typstBad.value = !r.ok;
  typstLog.value = r.log;
  typstWinget.value = r.wingetNote;
  typstNoWinget.value = r.winget === false;
  engineHits.value = r.engines;
  if (!r.ok) {
    typstExe.value = "";
    typstVer.value = "";
    typstMsg.value = r.message || "还没装 Typst";
    return;
  }
  typstExe.value = r.exe;
  typstVer.value = r.version;
  const bits: string[] = [r.version || "已安装"];
  if (install) {
    // 装好就把 PDF 引擎指过去，免得用户还得自己挑一遍
    if (!pandoc.value.pdfEngine || pandoc.value.pdfEngine === "typst") {
      const native = r.exe.replace(/\//g, "\\");
      // 路径带空格时命令行得加引号，而本项目的约定是「参数表里不放引号」，
      // 这种情况退回引擎名 typst，靠刚补好的 PATH（重启 LiteMark 后生效）
      const spaced = /\s/.test(native);
      setPandoc({ pdfEngine: spaced ? "typst" : native });
      bits.push(spaced ? "PDF 引擎已设为 typst（重启 LiteMark 后生效）" : "PDF 引擎已指向它");
    }
    if (r.pathNote) bits.push(r.pathNote);
  }
  typstMsg.value = bits.join(" · ");
}

async function probeTypst(force = false) {
  if (typstBusy.value) return;
  if (typstProbed && !force) return;
  typstProbed = true;
  typstBusy.value = true;
  typstBad.value = false;
  typstMsg.value = "正在查找 Typst…";
  const r = await runTypst("probe");
  typstBusy.value = false;
  applyTypst(r, false);
}

async function installTypst() {
  if (typstBusy.value) return;
  typstBusy.value = true;
  typstBad.value = false;
  typstLog.value = "";
  typstMsg.value = "正在用 winget 安装（要下 21 MB，走代理可能等一两分钟）…";
  toast("正在安装 Typst…");
  const r = await runTypst("install");
  typstBusy.value = false;
  applyTypst(r, true);
  if (r.ok) {
    toast(`Typst 就绪 · ${r.version || "已安装"}`);
  } else {
    toast("Typst 安装失败，详见设置里的提示", true);
  }
}

async function copyText(s: string) {
  try {
    await navigator.clipboard.writeText(s);
    toast("命令已复制");
  } catch {
    toast("复制失败，请手动选中复制", true);
  }
}

async function copyTypstCmd() {
  await copyText(TYPST_SHOW_CMD);
}

/* ---------- PDF 引擎：只列本机真能用的 + 手动添加位置 ---------- */

/** 下拉里「添加引擎位置…」的哨兵值 */
const ENGINE_ADD = "__add__";

/**
 * 下拉内容 = 脚本扫到的引擎（按候选表顺序）+ 自己添加的路径。
 * 存着的值要是现在扫不到了（卸载了 / 路径变了），补一项「未检测到」把它留住，
 * 否则下拉没有匹配项会显示成空白，看着像配置丢了。
 */
const engineOptions = computed(() => {
  const out: { value: string; label: string }[] = [];
  for (const hit of engineHits.value) {
    out.push({ value: hit.id, label: engineLabel(hit.id) });
  }
  for (const p of pandoc.value.engines) {
    out.push({ value: p, label: `自定义 · ${baseName(p)}` });
  }
  const cur = pandoc.value.pdfEngine;
  if (cur && !out.some((o) => o.value === cur)) {
    out.push({ value: cur, label: `${engineLabel(cur)}（未检测到）` });
  }
  out.push({ value: ENGINE_ADD, label: "添加引擎位置…" });
  return out;
});

/** 当前选择在下拉里有对应项；没有（还没选过）时补个占位项给下拉显示 */
const enginePicked = computed(() =>
  engineOptions.value.some((o) => o.value === pandoc.value.pdfEngine),
);

/** 选中项：点「添加」时先弹文件框，再把手改过的 select 值还原回去 */
async function onEnginePick(e: Event) {
  const el = e.target as HTMLSelectElement;
  if (el.value !== ENGINE_ADD) {
    setPandoc({ pdfEngine: el.value });
    return;
  }
  el.value = pandoc.value.pdfEngine;
  await addEngine();
}

/** 挑一个引擎 exe 加进下拉，并直接选中它 */
async function addEngine() {
  const f = await pickAnyFile("选择 PDF 引擎程序", ["exe"]);
  if (!f) return;
  const cleaned = cleanEngine(f);
  if (cleaned === null) {
    toast("这个路径里有命令行特殊字符（& | < > ^ %），换一个", true);
    return;
  }
  // 统一存成原生反斜杠：和资源管理器里看到的路径一致，也是 CreateProcess 的原生形式
  const val = cleaned.replace(/\//g, "\\");
  const list = pandoc.value.engines.includes(val)
    ? pandoc.value.engines
    : [...pandoc.value.engines, val];
  setPandoc({ engines: list, pdfEngine: val });
  toast(`已添加引擎 · ${baseName(val)}`);
}

/** 移除自定义引擎；删的正好是当前选中的那个就把选择清空 */
function removeEngine(p: string) {
  const patch: Partial<PandocConf> = {
    engines: pandoc.value.engines.filter((x) => x !== p),
  };
  if (pandoc.value.pdfEngine === p) patch.pdfEngine = "";
  setPandoc(patch);
}

/** 导出按钮点开的格式列表：由设置 → Pandoc 里的勾选决定 */
const exportChoices = computed(() =>
  pickedFormats(pandoc.value).map((f) => ({ id: f.id, label: f.label })),
);

/** 导出当前文档：格式取按钮里选的，没指定就用设置里的默认格式 */
async function exportCurrent(fmtId?: string) {
  if (pandocBusy.value) return;
  const c = loadPandoc();
  if (!c.on) {
    toast("Pandoc 未启用（设置 → Pandoc）", true);
    return;
  }
  const fmt = FORMATS.find((f) => f.id === (fmtId || c.format)) ?? FORMATS[0];
  pandocBusy.value = true;
  toast(`正在导出 ${fmt.label}…`);
  const r = await exportDoc(
    { text: current.value.text, srcPath: current.value.path, name: current.value.name },
    c,
    fmt.id,
  );
  pandocBusy.value = false;
  toast(r.ok ? `已导出：${r.path}` : `导出失败：${r.message}`, !r.ok);
}

/** 导入外部文档：转成 Markdown 后作为新标签打开 */
async function importDocument() {
  if (pandocBusy.value) return;
  const c = loadPandoc();
  if (!c.on) {
    toast("Pandoc 未启用（设置 → Pandoc）", true);
    return;
  }
  pandocBusy.value = true;
  toast("正在转换文档…");
  const r = await importDoc(c);
  pandocBusy.value = false;
  if (!r.ok) {
    if (r.message !== "已取消") toast(`导入失败：${r.message}`, true);
    return;
  }
  pushTab(null, r.name, r.text);
  toast(`已导入 ${r.name}`);
}

/* ---------- 轻提示（上传是慢操作，失败必须有反馈） ---------- */
const toastMsg = ref("");
const toastBad = ref(false);
let toastTimer = 0;

function toast(msg: string, bad = false) {
  toastMsg.value = msg;
  toastBad.value = bad;
  window.clearTimeout(toastTimer);
  // 导出路径这类长消息给足阅读时间
  toastTimer = window.setTimeout(() => (toastMsg.value = ""), msg.length > 56 ? 8000 : 3600);
}

/** 编辑区 / 图片链接条的上传失败都汇到这里 */
function onNotify(p: { msg: string; bad?: boolean }) {
  toast(p.msg, !!p.bad);
}

/* ---------- 快捷键 ---------- */
const bindings = ref<Record<string, Binding>>(loadBindings());
const recordingId = ref<string | null>(null);
const keyHint = ref("");

function bindingOf(id: string): Binding {
  return bindings.value[id];
}

function commitBindings() {
  saveBindings(bindings.value);
}

function startRecord(id: string) {
  keyHint.value = "";
  recordingId.value = id;
  window.addEventListener("keydown", onRecordKey, true);
}

function stopRecord() {
  recordingId.value = null;
  window.removeEventListener("keydown", onRecordKey, true);
}

function onRecordKey(e: KeyboardEvent) {
  e.preventDefault();
  e.stopPropagation();
  if (e.key === "Escape") {
    stopRecord();
    return;
  }
  const next = bindingFromEvent(e);
  if (!next) {
    keyHint.value = "需要搭配 Ctrl 或 Alt 使用";
    return;
  }
  const clash = SHORTCUTS.find(
    (s) => s.id !== recordingId.value && sameBinding(bindingOf(s.id), next),
  );
  if (clash) {
    keyHint.value = `与「${clash.label}」冲突，换个组合试试`;
    return;
  }
  const id = recordingId.value;
  if (!id) return;
  bindings.value = { ...bindings.value, [id]: next };
  commitBindings();
  stopRecord();
}

function resetBinding(id: string) {
  keyHint.value = "";
  bindings.value = { ...bindings.value, [id]: { ...defaultBindings()[id] } };
  commitBindings();
}

function resetAllBindings() {
  keyHint.value = "";
  bindings.value = defaultBindings();
  commitBindings();
  stopRecord();
}

/* ---------- 编辑器命令的按键接管 ---------- */
/* 只在用户改过绑定后才介入：命中新键 → 执行命令；命中被放弃的旧键 → 吞掉，
   否则 Milkdown 内置 keymap 会让旧键继续生效。未改绑时完全不干预。 */
const editorShortcuts = SHORTCUTS.filter((s) => s.group === "editor");

function customEditorBindings() {
  return editorShortcuts.filter((s) => {
    const b = bindings.value[s.id];
    return b && !sameBinding(b, s.def);
  });
}

function onCaptureKey(e: KeyboardEvent) {
  if (recordingId.value || sourceMode.value) return;
  const custom = customEditorBindings();
  if (!custom.length) return;
  const hit = custom.find((s) => matchEvent(e, bindings.value[s.id]));
  if (!hit) {
    const dead = custom.find((s) => matchEvent(e, s.def));
    if (!dead) return;
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  pane.value?.exec(hit.editor as never);
}

/* ---------- 设置分类 ---------- */
/** 设置面板的 Tab；数组顺序即导航顺序 */
const SETTINGS_TABS = ["startup", "look", "keys", "picgo", "pandoc"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

/** 上次停在哪个 Tab（设置 → 启动 里可关） */
function initialSettingsTab(): SettingsTab {
  if (!startup.value.settingsTab) return "look";
  const v = kvGet(SESSION.settingsTab) || "";
  return (SETTINGS_TABS as readonly string[]).includes(v) ? (v as SettingsTab) : "look";
}

const settingsTab = ref<SettingsTab>(initialSettingsTab());

watch(settingsTab, (v) => {
  if (startup.value.settingsTab) kvSet(SESSION.settingsTab, v);
});

/** 侧栏折叠 / 源码模式：界面状态记忆（设置 → 启动 里可关） */
watch(collapsed, (v) => {
  if (startup.value.ui) kvSetBool(SESSION.collapsed, v);
});
watch(sourceMode, (v) => {
  if (startup.value.ui) kvSetBool(SESSION.source, v);
});

const shortcutsOf = (key: string) => SHORTCUTS.filter((s) => s.group === key);

/* ---------- 命令执行 ---------- */
function runAction(id: string): boolean {
  switch (id) {
    case "save":
      saveFile();
      return true;
    case "open":
      openFile();
      return true;
    case "openFolder":
      chooseFolder();
      return true;
    case "newFile":
      newFile();
      return true;
    case "closeTab":
      closeTab(active.value);
      return true;
    case "nextTab":
      if (tabs.value.length > 1) selectTab((active.value + 1) % tabs.value.length);
      return true;
    case "prevTab":
      if (tabs.value.length > 1)
        selectTab((active.value - 1 + tabs.value.length) % tabs.value.length);
      return true;
    case "toggleSidebar":
      collapsed.value = !collapsed.value;
      return true;
    case "settings":
      openSettings();
      return true;
    case "insertImage":
      insertLocalImage();
      return true;
    case "insertImageUrl":
      openImageUrl();
      return true;
    case "toggleMode":
      toggleMode();
      return true;
  }
  return false;
}

/** 源码 / 所见即所得切换；回到所见即所得时重挂载编辑器，用文本框里的最新文本重建 */
function toggleMode() {
  if (sourceMode.value) {
    sourceMode.value = false;
    docToken.value++;
  } else {
    sourceMode.value = true;
  }
}

const current = computed(() => tabs.value[active.value]);

onMounted(() => {
  countText(current.value.text);
  applyTheme();
  document.documentElement.style.setProperty("--editor-font", editorFont.value + "px");
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("keydown", onCaptureKey, true);
  window.removeEventListener("keydown", onRecordKey, true);
});

function countText(md: string) {
  const plain = md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*`>\-|!\[\]()]/g, "")
    .replace(/\s+/g, "");
  chars.value = md.length;
  words.value = plain.length;
}

function onUpdate(md: string) {
  current.value.text = md;
  current.value.dirty = true;
  countText(md);
}

function selectTab(i: number) {
  if (i === active.value) return;
  active.value = i;
  docToken.value++;
  countText(current.value.text);
}

function closeTab(i: number) {
  tabs.value.splice(i, 1);
  if (!tabs.value.length) {
    tabs.value.push({ path: null, name: "未命名.md", text: "", dirty: false });
  }
  active.value = Math.min(active.value, tabs.value.length - 1);
  docToken.value++;
  countText(current.value.text);
}

function pushTab(path: string | null, name: string, text: string) {
  const existing = tabs.value.findIndex((t) => t.path === path);
  if (existing >= 0) {
    selectTab(existing);
    return;
  }
  tabs.value.push({ path, name, text, dirty: false });
  active.value = tabs.value.length - 1;
  docToken.value++;
  countText(text);
}

/* ---------- 侧栏改名 / 删除后，同步已打开的标签 ---------- */

const nameOf = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** child 是不是在 parent 里（含 parent 本身），忽略大小写 */
function underPath(child: string, parent: string) {
  const c = child.replace(/\\/g, "/").toLowerCase();
  const p = parent.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return c === p || c.startsWith(p + "/");
}

function onRenamed(oldPath: string, newPath: string) {
  // 改的是「打开的那个文件夹」本身，工作区根跟着走，
  // 并且要让树按新路径重读一遍 —— 否则树里所有子路径都还挂着旧前缀，点哪个都失效
  if (folderRoot.value && folderRoot.value.toLowerCase() === oldPath.toLowerCase()) {
    folderRoot.value = newPath;
    kvSet(SESSION.folder, newPath);
    void tree.value?.setRoot(newPath);
  }
  for (const t of tabs.value) {
    if (!t.path) continue;
    if (t.path === oldPath) {
      t.path = newPath;
      t.name = nameOf(newPath);
    } else if (underPath(t.path, oldPath)) {
      // 父目录被改名：路径前缀换掉
      t.path = newPath + t.path.slice(oldPath.length);
      t.name = nameOf(t.path);
    }
  }
}

function onRemoved(path: string) {
  const keep: Tab[] = [];
  for (const t of tabs.value) {
    if (!t.path || !underPath(t.path, path)) {
      keep.push(t);
      continue;
    }
    // 磁盘上没了；有未保存的改动就把正文留下，退化成未命名文档，别让用户白写
    if (t.dirty) keep.push({ ...t, path: null, name: `${t.name}（已删除）` });
  }
  if (!keep.length) keep.push({ path: null, name: "未命名.md", text: "", dirty: false });
  const cur = tabs.value[active.value];
  const at = keep.indexOf(cur);
  tabs.value = keep;
  active.value = at >= 0 ? at : 0;
  docToken.value++;
  countText(current.value.text);
}

async function openFile() {
  const result = await openMarkdown();
  if (!result) return;
  pushTab(result.path, result.path.split(/[\\/]/).pop()!, result.text);
}

async function openFileFromTree(path: string) {
  try {
    const text = await readFileText(path);
    pushTab(path, path.split(/[\\/]/).pop()!, text);
  } catch (e) {
    console.error("读取文件失败", e);
  }
}

async function chooseFolder() {
  const root = await openFolder();
  if (!root) return;
  folderRoot.value = root;
  await tree.value?.setRoot(root);
  kvSet(SESSION.folder, root);
}

/* ---------- 会话恢复：上次的文件夹 / 标签页 ---------- */

/** 上次的文件夹还在就自动打开；不在就忘掉它，免得每次启动白试一次 */
async function restoreFolder() {
  if (!startup.value.folder) return;
  const last = kvGet(SESSION.folder);
  if (!last) return;
  try {
    await readDir(last);
  } catch {
    kvDel(SESSION.folder);
    return;
  }
  folderRoot.value = last;
  await tree.value?.setRoot(last);
}

/** 重开上次的标签页；正文现读，磁盘上改过的内容不会被旧快照盖回去 */
async function restoreTabs() {
  if (!startup.value.tabs) return;
  const { paths, active: act } = loadOpenTabs();
  if (!paths.length) return;
  const back: Tab[] = [];
  for (const p of paths) {
    try {
      const text = await readFileText(p);
      back.push({ path: p, name: p.split(/[\\/]/).pop()!, text, dirty: false });
    } catch {
      /* 文件不在了就跳过 */
    }
  }
  if (!back.length) return;
  tabs.value = back;
  active.value = act >= 0 && act < back.length ? act : 0;
  docToken.value++;
  countText(current.value.text);
}

/**
 * 记录当前打开的标签。只在「路径列表或活动标签变了」时写盘 ——
 * 否则每次敲键盘（正文变化）都会触发一次，白写。
 */
let tabSaveTimer = 0;
function persistTabs() {
  if (!startup.value.tabs) return;
  if (tabSaveTimer) window.clearTimeout(tabSaveTimer);
  tabSaveTimer = window.setTimeout(() => {
    tabSaveTimer = 0;
    const paths = tabs.value
      .map((t) => t.path)
      .filter((p): p is string => !!p);
    const cur = current.value.path;
    saveOpenTabs({ paths, active: cur ? paths.indexOf(cur) : -1 });
  }, 300);
}

watch(() => tabs.value.map((t) => t.path).join("\n") + "|" + active.value, persistTabs);

async function saveFile() {
  const saved = await saveMarkdown(current.value.path, current.value.text);
  if (saved) {
    current.value.path = saved;
    current.value.name = saved.split(/[\\/]/).pop()!;
    current.value.dirty = false;
  }
}

async function newFile() {
  // 没打开文件夹时退化为新建空白标签
  if (!inNL || !folderRoot.value) {
    let name = "未命名.md";
    let n = 1;
    while (tabs.value.some((t) => t.name === name)) name = `未命名-${n++}.md`;
    pushTab(null, name, "");
    return;
  }
  let name = "未命名.md";
  let path = joinPath(folderRoot.value, name);
  let n = 1;
  while (tabs.value.some((t) => t.path === path)) {
    name = `未命名-${n++}.md`;
    path = joinPath(folderRoot.value, name);
  }
  try {
    await writeFileText(path, `# ${name.replace(/\.md$/, "")}\n\n`);
    await tree.value?.refresh();
    pushTab(path, name, `# ${name.replace(/\.md$/, "")}\n\n`);
  } catch (e) {
    console.error("新建文件失败", e);
  }
}

/* ---------- 图片插入 ---------- */
const urlDialogOpen = ref(false);
const urlInput = ref("");
const urlError = ref("");
const urlInputEl = ref<HTMLInputElement | null>(null);

/** 选本地图片插入：开了图床就先上传，否则只写绝对路径（不复制原文件） */
async function insertLocalImage() {
  if (inNL) {
    const path = await pickImage();
    if (!path) return;
    const name = path.split("/").pop() ?? "图片";
    const c = loadPicgo();
    if (c.on && c.onLocal) {
      toast("正在上传到图床…");
      const up = await picgoUpload(c.server, path);
      if (up.url) {
        await pane.value?.insertImage(up.url, name);
        toast("已上传到图床");
        return;
      }
      toast(`图床上传失败，已改用本地路径：${up.error}`, true);
    }
    await pane.value?.insertImage(path, name);
    return;
  }
  // 浏览器预览：退回内嵌 data URL
  const file = await pickImageBrowser();
  if (!file) return;
  const b64 = await fileToBase64(file);
  await pane.value?.insertImage(`data:${file.type};base64,${b64}`, file.name);
}

function openImageUrl() {
  urlInput.value = "";
  urlError.value = "";
  urlDialogOpen.value = true;
  nextTick(() => urlInputEl.value?.focus());
}

async function confirmImageUrl() {
  const url = urlInput.value.trim();
  if (!url) return;
  if (!/^(https?:|data:)/i.test(url)) {
    urlError.value = "请填写以 http:// 或 https:// 开头的地址";
    return;
  }
  const name = url.split("/").pop()?.split("?")[0] || "图片";
  await pane.value?.insertImage(url, name);
  urlDialogOpen.value = false;
}

/* ---------- 菜单（编辑区 / 侧栏共用组件） ---------- */
const menuVisible = ref(false);
const menuX = ref(0);
const menuY = ref(0);
const menuSource = ref<"editor" | "sidebar">("editor");

/* 菜单按 divider 分行：同一类操作并排一行，只显示图标，悬停出提示 */
const editorMenu = computed<MenuItem[]>(() => [
  { label: "剪切", icon: "cut", clipboard: "cut", accel: "Ctrl+X" },
  { label: "复制", icon: "copy", clipboard: "copy", accel: "Ctrl+C" },
  { label: "粘贴", icon: "paste", clipboard: "paste", accel: "Ctrl+V" },
  { label: "全选", icon: "selectAll", clipboard: "selectAll", accel: "Ctrl+A" },
  { divider: true, label: "" },
  { label: "加粗", icon: "bold", editor: "bold", key: "bold" },
  { label: "斜体", icon: "italic", editor: "italic", key: "italic" },
  { label: "删除线", icon: "strike", editor: "strike", key: "strike" },
  { label: "行内代码", icon: "inlineCode", editor: "inlineCode", key: "inlineCode" },
  { divider: true, label: "" },
  { label: "引用块", icon: "blockquote", editor: "blockquote", key: "blockquote" },
  { label: "无序列表", icon: "bulletList", editor: "bulletList", key: "bulletList" },
  { label: "有序列表", icon: "orderedList", editor: "orderedList", key: "orderedList" },
  { label: "代码块", icon: "codeBlock", editor: "codeBlock", key: "codeBlock" },
  { label: "分割线", icon: "hr", editor: "hr" },
  { label: "表格 3×3", icon: "table", editor: "table" },
  { divider: true, label: "" },
  { label: "插入本地图片…", icon: "image", action: "insertImage", key: "insertImage" },
  { label: "插入网络图片…", icon: "imageUrl", action: "insertImageUrl", key: "insertImageUrl" },
]);

/** 侧栏右键点中的节点；null = 点在空白处（只出通用菜单） */
type CtxNode = { path: string; entry: string; type: "FILE" | "DIRECTORY"; isRoot: boolean };
const ctxNode = ref<CtxNode | null>(null);
watch(menuVisible, (v) => {
  if (!v) ctxNode.value = null;
});

const sidebarMenu = computed<MenuItem[]>(() => {
  const node = ctxNode.value;
  // 点中文件 / 文件夹才有「重命名 / 删除」，点在空白处这两项不生成
  // 根节点（打开的那个文件夹）不给删除 —— 把工作区根删掉太容易出事，留个重命名就够
  const targeted: MenuItem[] = node
    ? [
        { label: "重命名", icon: "rename", action: "rename" },
        ...(node.isRoot
          ? []
          : ([
              { label: "删除到回收站", icon: "trash", action: "remove", danger: true },
            ] as MenuItem[])),
      ]
    : [];
  // 三行：打开 / 文件操作（新建·重命名·删除·刷新）/ 输出（导入·导出·保存）
  return [
    { label: "打开文件", icon: "file", action: "open", key: "open" },
    { label: "打开文件夹", icon: "folder", action: "folder", key: "openFolder" },
    { divider: true, label: "" },
    { label: "新建 Markdown", icon: "filePlus", action: "newFile", key: "newFile" },
    ...targeted,
    { label: "刷新目录", icon: "refresh", action: "refresh" },
    ...(pandoc.value.on
      ? ([
          { divider: true, label: "" },
          { label: "导入文档（Pandoc）", icon: "importDoc", action: "importDoc" },
          // 导出点开是格式列表，列出的格式 = 设置 → Pandoc 里勾选的那些
          {
            label: "导出为…",
            icon: "exportDoc",
            action: "exportDoc",
            submenu: exportChoices.value,
            subActive: pandoc.value.format,
          },
          { label: "保存当前文档", icon: "save", action: "save", key: "save" },
        ] as MenuItem[])
      : [{ label: "保存当前文档", icon: "save", action: "save", key: "save" }]),
  ];
});

const menuItems = computed(() =>
  menuSource.value === "editor" ? editorMenu.value : sidebarMenu.value,
);

function onContextMenu(e: MouseEvent) {
  e.preventDefault();
  menuSource.value = "editor";
  ctxNode.value = null;
  menuX.value = e.clientX;
  menuY.value = e.clientY;
  menuVisible.value = true;
}

function onTreeCtx(payload: { e: MouseEvent; node: CtxNode | null }) {
  menuSource.value = "sidebar";
  ctxNode.value = payload.node;
  menuX.value = payload.e.clientX;
  menuY.value = payload.e.clientY;
  menuVisible.value = true;
}

async function onMenuSelect(item: MenuItem) {
  if (item.editor) {
    await pane.value?.exec(item.editor as never);
    return;
  }
  if (item.action) {
    switch (item.action) {
      case "open": openFile(); break;
      case "folder": chooseFolder(); break;
      case "save": saveFile(); break;
      case "newFile": newFile(); break;
      case "refresh": tree.value?.refresh(); break;
      case "insertImage": insertLocalImage(); break;
      case "insertImageUrl": openImageUrl(); break;
      case "exportDoc": exportCurrent(item.sub); break;
      case "importDoc": importDocument(); break;
      case "rename":
        if (ctxNode.value) await tree.value?.startRename(ctxNode.value.path);
        break;
      case "remove":
        tree.value?.askRemove(ctxNode.value?.path ?? "");
        break;
    }
    return;
  }
  switch (item.clipboard) {
    case "cut":
      document.execCommand("cut");
      break;
    case "copy":
      document.execCommand("copy");
      break;
    case "paste": {
      try {
        const text = await navigator.clipboard.readText();
        document.execCommand("insertText", false, text);
      } catch {
        document.execCommand("paste");
      }
      break;
    }
    case "selectAll":
      document.execCommand("selectAll");
      break;
  }
}

/* ---------- 全局快捷键 ---------- */
function onKeydown(e: KeyboardEvent) {
  if (recordingId.value) return;
  if (e.key === "Escape") {
    menuVisible.value = false;
    return;
  }
  // 编辑器内部（ProseMirror）已消费的按键不再重复处理
  if (e.defaultPrevented || e.metaKey) return;
  const hit = SHORTCUTS.find((s) => {
    const bd = bindingOf(s.id);
    return bd ? matchEvent(e, bd) : false;
  });
  if (!hit) return;
  if (runAction(hit.id)) e.preventDefault();
}

onMounted(() => {
  window.addEventListener("keydown", onCaptureKey, true);
  window.addEventListener("keydown", onKeydown);
  trackWindow();
  countText(current.value.text);
  // 恢复上次的现场：先目录后标签（标签只依赖文件路径，两者互不阻塞）
  void (async () => {
    try {
      await restoreFolder();
    } catch (e) {
      console.warn("[LiteMark] 恢复上次的文件夹失败：", e);
    }
    try {
      await restoreTabs();
    } catch (e) {
      console.warn("[LiteMark] 恢复上次的标签页失败：", e);
    }
  })();
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("keydown", onCaptureKey, true);
  window.removeEventListener("keydown", onRecordKey, true);
  stopWindowTracking();
});
</script>

<template>
  <div class="window-shell" :class="{ 'browser-preview': !inNL, maximized }">
    <TitleBar @logo="openSettings" />

    <div class="body-row">
      <FileTree
        ref="tree"
        :root="folderRoot"
        :collapsed="collapsed"
        :width="sidebarWidth"
        :export-on="pandoc.on"
        :export-formats="exportChoices"
        :export-active="pandoc.format"
        @open-file="openFileFromTree"
        @act-open="openFile"
        @act-folder="chooseFolder"
        @act-save="saveFile"
        @act-export="exportCurrent"
        @ctx="onTreeCtx"
        @renamed="onRenamed"
        @removed="onRemoved"
        @notify="onNotify"
        @logo="openSettings"
        @toggle-collapse="collapsed = !collapsed"
        @resize="onSidebarResize"
      />

      <div class="main-col">
        <TabsBar :tabs="tabs" :active="active" @select="selectTab" @close="closeTab" />

        <div class="editor-host" @contextmenu="onContextMenu">
          <MilkdownProvider :key="docToken">
            <EditorPane
              ref="pane"
              :initial="current.text"
              :source="sourceMode"
              @update="onUpdate"
              @notify="onNotify"
            />
          </MilkdownProvider>
        </div>
      </div>
    </div>

    <StatusBar
      :file-name="current.name"
      :dirty="current.dirty"
      :words="words"
      :chars="chars"
      :source="sourceMode"
      :mode-key="formatBinding(bindingOf('toggleMode'))"
      @toggle-mode="toggleMode"
      @settings="openSettings"
    />

    <!-- 无边框窗口没有系统缩放边框，四边/四角的拖拽热区自己铺 -->
    <ResizeHandles />

    <!-- 设置弹窗 -->
    <Teleport to="body">
      <div v-if="settingsOpen" class="set-mask" @mousedown.self="closeSettings">
        <div class="set-panel">
          <div class="set-head">
            <span class="set-title">设置</span>
            <button class="set-close" title="关闭" @click="closeSettings">
              <svg viewBox="0 0 12 12" width="11" height="11"><path d="M1.5 1.5l9 9m0-9l-9 9" stroke="currentColor" stroke-width="1.2" /></svg>
            </button>
          </div>

          <div class="set-main">
            <nav class="set-nav">
              <button
                class="nav-item"
                :class="{ on: settingsTab === 'startup' }"
                @click="settingsTab = 'startup'"
              >
                启动
              </button>
              <button
                class="nav-item"
                :class="{ on: settingsTab === 'look' }"
                @click="settingsTab = 'look'"
              >
                外观
              </button>
              <button
                class="nav-item"
                :class="{ on: settingsTab === 'keys' }"
                @click="settingsTab = 'keys'"
              >
                快捷键
              </button>
              <button
                class="nav-item"
                :class="{ on: settingsTab === 'picgo' }"
                @click="settingsTab = 'picgo'"
              >
                图床
              </button>
              <button
                class="nav-item"
                :class="{ on: settingsTab === 'pandoc' }"
                @click="settingsTab = 'pandoc'"
              >
                Pandoc
              </button>
            </nav>

            <div class="set-content">
              <!-- 启动 -->
              <template v-if="settingsTab === 'startup'">
                <div class="set-group-head">
                  <span class="set-group-title">重开时恢复</span>
                </div>

                <div v-for="it in STARTUP_ITEMS" :key="it.id" class="st-item">
                  <div class="st-text">
                    <div class="st-label">{{ it.label }}</div>
                    <div class="st-note">{{ it.note }}</div>
                  </div>
                  <div class="seg">
                    <button
                      v-for="v in ([true, false] as const)"
                      :key="String(v)"
                      class="seg-item"
                      :class="{ on: startup[it.id] === v }"
                      @click="setStartup({ [it.id]: v } as Partial<StartupConf>)"
                    >
                      {{ v ? "开" : "关" }}
                    </button>
                  </div>
                </div>

                <p class="set-note">
                  关掉哪一项，那一项就不再被记录。所有配置存在
                  <code>%APPDATA%\LiteMark\settings.json</code>，重开程序、换端口都不会再丢。
                </p>
              </template>

              <!-- 外观 -->
              <template v-else-if="settingsTab === 'look'">
                <div class="set-row">
                  <span class="set-label">主题</span>
                  <div class="seg">
                    <button
                      v-for="m in (['system','light','dark'] as const)"
                      :key="m"
                      class="seg-item"
                      :class="{ on: themeMode === m }"
                      @click="setTheme(m)"
                    >
                      {{ m === 'system' ? '跟随系统' : m === 'light' ? '亮色' : '暗色' }}
                    </button>
                  </div>
                </div>

                <div class="set-row">
                  <span class="set-label">正文字号</span>
                  <div class="font-ctl">
                    <button class="seg-item" @click="setFont(Math.max(12, editorFont - 1))">−</button>
                    <span class="font-val">{{ editorFont.toFixed(0) }} px</span>
                    <button class="seg-item" @click="setFont(Math.min(24, editorFont + 1))">+</button>
                  </div>
                </div>

                <p class="set-note">更多外观项（行高、字体、代码主题）陆续加入。</p>
              </template>

              <!-- 快捷键 -->
              <template v-else-if="settingsTab === 'keys'">
                <div class="set-group-head">
                  <span class="set-group-title">按键绑定</span>
                  <button class="link-btn" @click="resetAllBindings">全部恢复默认</button>
                </div>

                <div v-for="g in GROUPS" :key="g.key" class="key-group">
                  <div class="key-group-title">{{ g.title }}</div>
                  <div class="key-list">
                    <div v-for="s in shortcutsOf(g.key)" :key="s.id" class="key-row">
                      <span class="key-label">{{ s.label }}</span>
                      <button
                        class="key-btn"
                        :class="{ rec: recordingId === s.id }"
                        @click="startRecord(s.id)"
                      >
                        {{ recordingId === s.id ? "按下新组合…" : formatBinding(bindingOf(s.id)) }}
                      </button>
                      <button class="key-reset" title="恢复默认" @click="resetBinding(s.id)">
                        <svg viewBox="0 0 14 14" width="12" height="12"><path d="M11.5 7a4.5 4.5 0 1 1-1.3-3.2M11.5 1.5v3.2H8.3" stroke="currentColor" stroke-width="1.2" fill="none" /></svg>
                      </button>
                    </div>
                  </div>
                </div>

                <p class="key-hint" :class="{ warn: !!keyHint }">
                  {{ keyHint || "点右侧按键框，直接按下新组合；Esc 取消。改绑后原按键会停用。" }}
                </p>
              </template>

              <!-- 图床（PicGo） -->
              <template v-else-if="settingsTab === 'picgo'">
                <div class="set-row">
                  <span class="set-label">启用 PicGo 图床</span>
                  <div class="seg">
                    <button
                      v-for="v in ([true, false] as const)"
                      :key="String(v)"
                      class="seg-item"
                      :class="{ on: picgo.on === v }"
                      @click="setPicgo({ on: v })"
                    >
                      {{ v ? "开" : "关" }}
                    </button>
                  </div>
                </div>

                <div class="set-row">
                  <span class="set-label">服务地址</span>
                  <div class="pg-server">
                    <input
                      class="pg-input"
                      :value="picgo.server"
                      :disabled="!picgo.on"
                      spellcheck="false"
                      placeholder="http://127.0.0.1:36677"
                      @change="setPicgo({ server: ($event.target as HTMLInputElement).value })"
                    />
                    <button
                      class="seg-item pg-btn"
                      :disabled="picgoTesting || !picgo.on"
                      @click="testPicgo"
                    >
                      {{ picgoTesting ? "连接中…" : "测试" }}
                    </button>
                    <button
                      class="key-reset"
                      title="恢复默认地址"
                      :disabled="!picgo.on"
                      @click="setPicgo({ server: DEFAULT_SERVER })"
                    >
                      <svg viewBox="0 0 14 14" width="12" height="12"><path d="M11.5 7a4.5 4.5 0 1 1-1.3-3.2M11.5 1.5v3.2H8.3" stroke="currentColor" stroke-width="1.2" fill="none" /></svg>
                    </button>
                  </div>
                </div>

                <p v-if="picgoTestMsg" class="key-hint" :class="{ warn: picgoTestBad }">
                  {{ picgoTestMsg }}
                </p>

                <div class="set-group-head pg-head">
                  <span class="set-group-title">自动上传时机</span>
                </div>

                <div class="set-row">
                  <span class="set-label">粘贴图片时</span>
                  <div class="seg">
                    <button
                      v-for="v in ([true, false] as const)"
                      :key="String(v)"
                      class="seg-item"
                      :class="{ on: picgo.onPaste === v }"
                      :disabled="!picgo.on"
                      @click="setPicgo({ onPaste: v })"
                    >
                      {{ v ? "传图床" : "用本地路径" }}
                    </button>
                  </div>
                </div>

                <div class="set-row">
                  <span class="set-label">插入本地图片时</span>
                  <div class="seg">
                    <button
                      v-for="v in ([true, false] as const)"
                      :key="String(v)"
                      class="seg-item"
                      :class="{ on: picgo.onLocal === v }"
                      :disabled="!picgo.on"
                      @click="setPicgo({ onLocal: v })"
                    >
                      {{ v ? "传图床" : "用本地路径" }}
                    </button>
                  </div>
                </div>

                <p class="set-note">
                  上传失败会自动回退本地路径，不打断编辑。<br />
                  手动上传：鼠标悬停图片，链接框右侧的上传按钮。<br />
                  PicGo 侧要打开「设置 → 设置 Server」，默认
                  <code>127.0.0.1:36677</code>。
                </p>
              </template>

              <!-- Pandoc -->
              <template v-else>
                <div class="set-row">
                  <span class="set-label">启用 Pandoc 导出 / 导入</span>
                  <div class="seg">
                    <button
                      v-for="v in ([true, false] as const)"
                      :key="String(v)"
                      class="seg-item"
                      :class="{ on: pandoc.on === v }"
                      @click="setPandoc({ on: v })"
                    >
                      {{ v ? "开" : "关" }}
                    </button>
                  </div>
                </div>

                <div class="set-row">
                  <span class="set-label">pandoc 路径</span>
                  <div class="pg-server">
                    <input
                      class="pg-input"
                      :value="pandoc.exe"
                      :disabled="!pandoc.on"
                      spellcheck="false"
                      placeholder="留空 = 用 PATH 里的 pandoc"
                      @change="setPandoc({ exe: ($event.target as HTMLInputElement).value })"
                    />
                    <button
                      class="seg-item pg-btn"
                      :disabled="pandocBusy || !pandoc.on"
                      @click="testPandoc"
                    >
                      {{ pandocBusy ? "检测中…" : "检测" }}
                    </button>
                    <button
                      class="key-reset"
                      title="清除自定义路径"
                      :disabled="!pandoc.on"
                      @click="setPandoc({ exe: '' })"
                    >
                      <svg viewBox="0 0 14 14" width="12" height="12"><path d="M11.5 7a4.5 4.5 0 1 1-1.3-3.2M11.5 1.5v3.2H8.3" stroke="currentColor" stroke-width="1.2" fill="none" /></svg>
                    </button>
                  </div>
                </div>

                <p v-if="pandocTestMsg" class="key-hint" :class="{ warn: pandocTestBad }">
                  {{ pandocTestMsg }}
                </p>

                <div class="set-group-head pg-head">
                  <span class="set-group-title">导出</span>
                </div>

                <div class="set-row">
                  <span class="set-label">默认格式</span>
                  <select
                    class="pg-input pg-select"
                    :value="pandoc.format"
                    :disabled="!pandoc.on"
                    @change="setPandoc({ format: ($event.target as HTMLSelectElement).value })"
                  >
                    <option v-for="f in formatOptions" :key="f.id" :value="f.id">
                      {{ f.label }}
                    </option>
                  </select>
                </div>

                <div class="set-row">
                  <span class="set-label">导出格式</span>
                  <div class="ck-row pg-wrap">
                    <label v-for="f in FORMATS" :key="f.id" class="ck">
                      <input
                        type="checkbox"
                        :checked="pandoc.exports.includes(f.id)"
                        :disabled="!pandoc.on"
                        @change="
                          toggleExportFormat(f.id, ($event.target as HTMLInputElement).checked)
                        "
                      />
                      <span>{{ f.label }}</span>
                    </label>
                  </div>
                </div>

                <p class="set-note">
                  勾选决定导出按钮里列出哪些格式（一个都不勾时只列默认格式）。<br />
                  侧栏「保存」右边的导出按钮点开就是这份列表，带勾的是默认格式。
                </p>

                <div class="set-row">
                  <span class="set-label">导出位置</span>
                  <div class="seg">
                    <button
                      v-for="m in OUT_MODES"
                      :key="m.id"
                      class="seg-item"
                      :class="{ on: pandoc.outMode === m.id }"
                      :disabled="!pandoc.on"
                      @click="setPandoc({ outMode: m.id })"
                    >
                      {{ m.label }}
                    </button>
                  </div>
                </div>

                <div v-if="pandoc.outMode === 'fixed'" class="set-row">
                  <span class="set-label">固定目录</span>
                  <div class="pg-server">
                    <input
                      class="pg-input"
                      :value="pandoc.outDir"
                      spellcheck="false"
                      placeholder="D:/导出"
                      @change="setPandoc({ outDir: ($event.target as HTMLInputElement).value })"
                    />
                    <button class="seg-item pg-btn" @click="choosePandocOutDir">选择…</button>
                  </div>
                </div>

                <div class="set-row">
                  <span class="set-label">导出选项</span>
                  <div class="ck-row">
                    <label class="ck">
                      <input
                        type="checkbox"
                        :checked="pandoc.standalone"
                        :disabled="!pandoc.on"
                        @change="setPandoc({ standalone: ($event.target as HTMLInputElement).checked })"
                      />
                      <span>完整文件</span>
                    </label>
                    <label class="ck">
                      <input
                        type="checkbox"
                        :checked="pandoc.toc"
                        :disabled="!pandoc.on"
                        @change="setPandoc({ toc: ($event.target as HTMLInputElement).checked })"
                      />
                      <span>目录</span>
                    </label>
                    <label class="ck">
                      <input
                        type="checkbox"
                        :checked="pandoc.numberSections"
                        :disabled="!pandoc.on"
                        @change="setPandoc({ numberSections: ($event.target as HTMLInputElement).checked })"
                      />
                      <span>章节编号</span>
                    </label>
                  </div>
                </div>

                <div class="set-row">
                  <span class="set-label">PDF 引擎</span>
                  <select
                    class="pg-input pg-select"
                    :value="pandoc.pdfEngine"
                    :disabled="!pandoc.on"
                    @change="onEnginePick"
                  >
                    <option v-if="!enginePicked" value="" disabled>选择 PDF 引擎…</option>
                    <option v-for="o in engineOptions" :key="o.value" :value="o.value">
                      {{ o.label }}
                    </option>
                  </select>
                </div>

                <div v-if="pandoc.engines.length" class="set-row">
                  <span class="set-label">自定义引擎</span>
                  <div class="eng-list">
                    <div v-for="p in pandoc.engines" :key="p" class="eng-item">
                      <code class="eng-path" :title="p">{{ p }}</code>
                      <button class="key-reset" title="移除" @click="removeEngine(p)">
                        <svg viewBox="0 0 14 14" width="12" height="12"><path d="M3.6 3.6l6.8 6.8M10.4 3.6l-6.8 6.8" stroke="currentColor" stroke-width="1.2" fill="none" /></svg>
                      </button>
                    </div>
                  </div>
                </div>

                <p class="set-note">
                  只列出本机 PATH 里能查到的引擎；装在别处、或 Portable 版的用
                  「添加引擎位置…」把 exe 指过来即可。
                </p>

                <div class="set-group-head pg-head">
                  <span class="set-group-title">Typst 引擎（推荐 · 一键安装）</span>
                </div>

                <div class="set-row">
                  <span class="set-label">安装状态</span>
                  <div class="pg-server">
                    <input
                      class="pg-input"
                      :value="typstExe"
                      readonly
                      spellcheck="false"
                      :placeholder="typstBusy ? '处理中…' : '还没装 Typst'"
                    />
                    <button
                      class="seg-item pg-btn"
                      :disabled="typstBusy"
                      @click="installTypst"
                    >
                      {{ typstBusy ? "安装中…" : typstExe ? "重装" : "一键安装" }}
                    </button>
                    <button
                      class="key-reset"
                      title="重新检测"
                      :disabled="typstBusy"
                      @click="probeTypst(true)"
                    >
                      <svg viewBox="0 0 14 14" width="12" height="12"><path d="M11.5 7a4.5 4.5 0 1 1-1.3-3.2M11.5 1.5v3.2H8.3" stroke="currentColor" stroke-width="1.2" fill="none" /></svg>
                    </button>
                  </div>
                </div>

                <div v-if="typstWinget" class="set-row">
                  <span class="set-label">winget</span>
                  <div class="pg-server">
                    <input
                      class="pg-input"
                      :value="typstWinget"
                      readonly
                      spellcheck="false"
                      :title="typstWinget"
                      placeholder="未检测"
                    />
                  </div>
                </div>

                <p v-if="typstMsg" class="key-hint" :class="{ warn: typstBad }">{{ typstMsg }}</p>
                <pre v-if="typstBad && typstLog" class="typst-log">{{ typstLog }}</pre>

                <div v-if="typstNoWinget" class="winget-box">
                  <div v-for="w in WINGET_CMDS" :key="w.cmd" class="wg-row">
                    <span class="wg-tag">{{ w.label }}</span>
                    <code class="cmd-text" :title="w.cmd">{{ w.cmd }}</code>
                    <button class="seg-item pg-btn" @click="copyText(w.cmd)">复制</button>
                  </div>
                  <p class="set-note">
                    第 1 条在 <code>cmd</code> / <code>PowerShell</code> 里都能跑（打开商店的「应用安装程序」页）；
                    装不了商店的精简系统用第 2、3 条，都是 PowerShell，依次跑一遍就把官方 msixbundle
                    （约 207 MB，自带依赖）下好装上了。装完回到这里点「重新检测」。
                  </p>
                </div>

                <div class="set-row">
                  <span class="set-label">脚本命令</span>
                  <div class="cmd-row">
                    <code class="cmd-text" :title="TYPST_SHOW_CMD">{{ TYPST_SHOW_CMD }}</code>
                    <button class="seg-item pg-btn" @click="copyTypstCmd">复制</button>
                  </div>
                </div>

                <p class="set-note">
                  用 winget 装上 portable 版 typst.exe（用户目录，不用管理员），装完自动把它的目录补进
                  用户 PATH，并把上面的 PDF 引擎指过去。Typst 依赖 winget，机器上没有 winget
                  时这里会直接给出安装命令。<br />
                  Typst 不需要 TeX 发行版；中文默认就会 fallback 到系统字体，想指定可在「额外参数」里加
                  <code>-V mainfont="Microsoft YaHei"</code>。
                </p>

                <div class="set-row">
                  <span class="set-label">Word 参考模板</span>
                  <div class="pg-server">
                    <input
                      class="pg-input"
                      :value="pandoc.refDocx"
                      spellcheck="false"
                      placeholder="可留空（用 pandoc 默认样式）"
                      @change="setPandoc({ refDocx: ($event.target as HTMLInputElement).value })"
                    />
                    <button class="seg-item pg-btn" :disabled="!pandoc.on" @click="chooseRefDocx">
                      选择…
                    </button>
                  </div>
                </div>

                <div class="set-row">
                  <span class="set-label">额外参数</span>
                  <input
                    class="pg-input pg-extra"
                    :value="pandoc.extra"
                    spellcheck="false"
                    placeholder="进阶：原样追加，如 --toc-depth=3"
                    @change="setPandoc({ extra: ($event.target as HTMLInputElement).value })"
                  />
                </div>

                <p class="set-note">
                  入口：侧栏顶部的导出按钮、侧栏右键「导出为 …」/「导入文档」。<br />
                  「完整文件」= 生成带元信息的完整文档，HTML 与 EPUB 需要它。<br />
                  PDF 要额外的引擎（TeX 或 wkhtmltopdf），缺了会在导出时提示。<br />
                  导入 docx / html 时，图片抽到源文档同目录的 <code>名字.assets</code> 里。
                </p>
              </template>
            </div>
          </div>

          <div class="set-foot">LiteMark · 设置保存在本机</div>
        </div>
      </div>
    </Teleport>

    <!-- 插入网络图片 -->
    <Teleport to="body">
      <div v-if="urlDialogOpen" class="set-mask" @mousedown.self="urlDialogOpen = false">
        <div class="url-panel">
          <div class="url-title">插入网络图片</div>
          <input
            ref="urlInputEl"
            v-model="urlInput"
            class="url-input"
            placeholder="https://example.com/pic.png"
            spellcheck="false"
            @keydown.enter="confirmImageUrl"
            @keydown.esc="urlDialogOpen = false"
          />
          <p v-if="urlError" class="url-err">{{ urlError }}</p>
          <div class="url-actions">
            <button class="seg-item" @click="urlDialogOpen = false">取消</button>
            <button class="seg-item primary" @click="confirmImageUrl">插入</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 轻提示：上传是慢操作，得有反馈 -->
    <Teleport to="body">
      <div v-if="toastMsg" class="toast" :class="{ bad: toastBad }">{{ toastMsg }}</div>
    </Teleport>

    <ContextMenu
      :visible="menuVisible"
      :x="menuX"
      :y="menuY"
      :items="menuItems"
      :bindings="bindings"
      @close="menuVisible = false"
      @select="onMenuSelect"
    />
  </div>
</template>

<style scoped>
.body-row {
  flex: 1;
  display: flex;
  min-height: 0;
}

.main-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.editor-host {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 设置弹窗 */
.set-mask {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: grid;
  place-items: center;
  /* 遮罩要够重，浮层才「浮」得起来 */
  background: rgba(0, 0, 0, 0.32);
}

.set-panel {
  width: 560px;
  height: 480px;
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  border-radius: var(--radius-panel);
  background: var(--bg-glass-strong);
  backdrop-filter: var(--blur-panel);
  -webkit-backdrop-filter: var(--blur-panel);
  border: 1px solid var(--border-soft);
  box-shadow: var(--shadow-float);
  padding: 14px 16px 10px;
  animation: set-in 0.15s cubic-bezier(0.2, 0.9, 0.3, 1);
}

/* 左侧分类 + 右侧内容 */
.set-main {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 14px;
}

.set-nav {
  flex: none;
  width: 104px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-right: 12px;
  border-right: 1px solid var(--border-faint);
}

.nav-item {
  text-align: left;
  border: none;
  background: transparent;
  color: var(--text-2);
  font-size: 12.5px;
  font-family: inherit;
  padding: 7px 10px;
  border-radius: var(--radius-item);
  cursor: default;
  transition: background 0.12s ease, color 0.12s ease;
}
.nav-item:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
.nav-item.on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.set-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding-right: 2px;
}

@keyframes set-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}

.set-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.set-title {
  font-size: 14px;
  font-weight: 650;
}

.set-close {
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  color: var(--text-2);
  border-radius: var(--radius-item);
  cursor: default;
}
.set-close:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}

.set-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
}

.set-label {
  font-size: 13px;
  color: var(--text-1);
}

.seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  border-radius: var(--radius-item);
  background: var(--bg-hover);
}

.seg-item {
  border: none;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: default;
  transition: background 0.12s ease, color 0.12s ease;
}
.seg-item.on {
  background: var(--bg-field);
  color: var(--text-1);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
}
.seg-item:hover:not(.on) {
  color: var(--text-1);
}

.font-ctl {
  display: flex;
  align-items: center;
  gap: 8px;
}

.font-val {
  font-size: 12.5px;
  color: var(--text-2);
  min-width: 42px;
  text-align: center;
}

.set-foot {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-faint);
  font-size: 11px;
  color: var(--text-3);
  text-align: center;
}

/* ---------- 快捷键区 ---------- */
.set-note {
  margin: 14px 0 0;
  font-size: 11.5px;
  color: var(--text-3);
}

/* 启动恢复项：左边标题 + 说明，右边开关 */
.st-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px solid var(--border-faint);
}
.st-item:last-of-type {
  border-bottom: none;
}
.st-text {
  min-width: 0;
}
.st-label {
  font-size: 13px;
  color: var(--text-1);
}
.st-note {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--text-3);
}

.set-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.set-group-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
}

.link-btn {
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 6px;
  cursor: default;
  transition: background 0.12s ease;
}
.link-btn:hover {
  background: var(--bg-hover);
}

.key-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.key-group + .key-group {
  margin-top: 12px;
}

.key-group-title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-3);
  margin: 0 2px 4px;
}

.key-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 4px;
  border-radius: var(--radius-item);
}
.key-row:hover {
  background: var(--bg-hover);
}

.key-label {
  flex: 1;
  font-size: 12.5px;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.key-btn {
  flex: none;
  min-width: 118px;
  text-align: center;
  border: 1px solid var(--border-soft);
  background: var(--bg-field);
  color: var(--text-2);
  font-size: 11.5px;
  font-family: inherit;
  padding: 4px 10px;
  border-radius: 7px;
  cursor: default;
  transition: border-color 0.12s ease, color 0.12s ease, background 0.12s ease;
}
.key-btn:hover {
  border-color: var(--accent);
  color: var(--text-1);
}
.key-btn.rec {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
  animation: key-pulse 1s ease-in-out infinite;
}

@keyframes key-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.key-reset {
  flex: none;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  color: var(--text-3);
  border-radius: 6px;
  cursor: default;
  transition: background 0.12s ease, color 0.12s ease;
}
.key-reset:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}

.key-hint {
  margin: 8px 2px 2px;
  font-size: 11px;
  color: var(--text-3);
}
.key-hint.warn {
  color: var(--danger);
}

/* ---------- 网络图片弹窗 ---------- */
.url-panel {
  width: 390px;
  border-radius: var(--radius-panel);
  background: var(--bg-glass-strong);
  backdrop-filter: var(--blur-panel);
  -webkit-backdrop-filter: var(--blur-panel);
  border: 1px solid var(--border-soft);
  box-shadow: var(--shadow-float);
  padding: 14px 16px 12px;
  animation: set-in 0.15s cubic-bezier(0.2, 0.9, 0.3, 1);
}

.url-title {
  font-size: 13.5px;
  font-weight: 600;
  margin-bottom: 10px;
}

.url-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border-soft);
  background: var(--bg-hover);
  color: var(--text-1);
  font-size: 12.5px;
  font-family: inherit;
  padding: 8px 10px;
  border-radius: 8px;
  outline: none;
  transition: border-color 0.12s ease;
}
.url-input:focus {
  border-color: var(--accent);
}
.url-input::placeholder {
  color: var(--text-3);
}

.url-err {
  margin: 8px 0 0;
  font-size: 11.5px;
  color: var(--danger);
}

.url-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 14px;
}

.seg-item.primary {
  background: var(--accent);
  color: #fff;
}
.seg-item.primary:hover {
  background: var(--accent);
  color: #fff;
}

/* ---------- 图床设置 ---------- */
.pg-server {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pg-input {
  width: 216px;
  border: 1px solid var(--border-soft);
  background: var(--bg-hover);
  color: var(--text-1);
  font-size: 12px;
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  padding: 5px 8px;
  border-radius: 7px;
  outline: none;
  transition: border-color 0.12s ease;
}
.pg-input:focus {
  border-color: var(--accent);
}
.pg-input:disabled {
  color: var(--text-3);
}

.pg-btn {
  border: 1px solid var(--border-soft);
  background: var(--bg-field);
  padding: 4px 10px;
  color: var(--text-2);
}
.pg-btn:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--accent);
}
.pg-btn:disabled,
.seg-item:disabled {
  color: var(--text-3);
}

.pg-head {
  margin-top: 16px;
}

.set-note code {
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 11px;
  background: var(--bg-hover);
  padding: 1px 4px;
  border-radius: 4px;
}

/* ---------- PDF 引擎：设置里的自定义引擎行 ---------- */
.eng-list {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
  flex: 1;
  min-width: 0;
}

.eng-item {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
}

.eng-path {
  min-width: 0;
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid var(--border-soft);
  background: var(--bg-hover);
  color: var(--text-2);
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 10.5px;
  padding: 4px 7px;
  border-radius: 5px;
  user-select: all;
}

/* ---------- Typst 一键安装 ---------- */
.cmd-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  justify-content: flex-end;
}

.cmd-text {
  flex: 1;
  min-width: 0;
  max-width: 216px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid var(--border-soft);
  background: var(--bg-hover);
  color: var(--text-2);
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 11px;
  padding: 5px 7px;
  border-radius: 5px;
  user-select: all;
}

/* 免商店那条命令 90+ 字符，这里不省略号，改成横向滚动 */
.winget-box .cmd-text {
  flex: 1;
  max-width: none;
  overflow-x: auto;
  text-overflow: clip;
  font-size: 10px;
}

/* winget 缺失时才展开的安装命令区 */
.winget-box {
  margin: 8px 0 2px;
  padding: 9px 10px;
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  background: var(--bg-hover);
}

.wg-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wg-row + .wg-row {
  margin-top: 6px;
}

.wg-tag {
  flex: 0 0 auto;
  width: 60px;
  color: var(--text-3);
  font-size: 11px;
}

.typst-log {
  margin: 6px 2px 0;
  max-height: 132px;
  overflow: auto;
  padding: 7px 9px;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  background: var(--bg-hover);
  color: var(--text-3);
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 10.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}

/* ---------- 轻提示 ---------- */
.toast {
  position: fixed;
  right: 20px;
  bottom: 46px;
  z-index: 1200;
  max-width: 420px;
  padding: 9px 14px;
  border-radius: var(--radius-item);
  border: 1px solid var(--border-soft);
  background: var(--bg-glass-strong);
  backdrop-filter: var(--blur-panel);
  -webkit-backdrop-filter: var(--blur-panel);
  box-shadow: var(--shadow-float);
  color: var(--text-1);
  font-size: 12.5px;
  line-height: 1.5;
  animation: set-in 0.15s cubic-bezier(0.2, 0.9, 0.3, 1);
}

.toast.bad {
  border-color: var(--danger);
  color: var(--danger);
}

/* ---------- Pandoc 设置 ---------- */
.pg-select {
  width: 216px;
  height: 28px;
  padding: 0 6px;
  cursor: default;
}
.pg-select:disabled {
  color: var(--text-3);
}

.pg-extra {
  width: 260px;
}

.ck-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

/* 导出格式勾选：项多、标签长，允许换行 */
.pg-wrap {
  flex-wrap: wrap;
  row-gap: 8px;
}

.ck {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12.5px;
  color: var(--text-2);
  cursor: default;
  user-select: none;
}
.ck input {
  accent-color: var(--accent);
  cursor: default;
}
.ck input:disabled + span {
  color: var(--text-3);
}
</style>
