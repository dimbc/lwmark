/**
 * Pandoc 配置（落盘持久化，见 store.ts）+ 命令行参数拼装。
 *
 * 核心约定：**用户路径永远不进命令行**。导出/导入时先把内容落进临时工作区，
 * 命令行里只出现 `in.md` / `out.docx` / `ref.docx` 这类纯 ASCII 相对文件名，
 * 中文名、空格、盘符一概不参与 shell 解析。具体流程见 pandocRun.ts。
 */
import { cleanEngine, engineArgValue } from "./pdfEngines";
import { kvGet, kvGetBool, kvSet } from "./store";

export type OutMode = "source" | "ask" | "fixed";

export interface FormatDef {
  id: string;
  label: string;
  ext: string;
  /** 需要外部引擎（目前只有 PDF 靠 LaTeX 一类引擎） */
  engine?: boolean;
}

/** 导出格式（pandoc 的 -t 值） */
export const FORMATS: FormatDef[] = [
  { id: "docx", label: "Word 文档 (.docx)", ext: "docx" },
  { id: "pdf", label: "PDF 文档 (.pdf)", ext: "pdf", engine: true },
  { id: "html", label: "HTML 网页 (.html)", ext: "html" },
  { id: "epub", label: "EPUB 电子书 (.epub)", ext: "epub" },
  { id: "pptx", label: "PowerPoint (.pptx)", ext: "pptx" },
  { id: "odt", label: "OpenDocument (.odt)", ext: "odt" },
  { id: "rtf", label: "RTF 富文本 (.rtf)", ext: "rtf" },
  { id: "plain", label: "纯文本 (.txt)", ext: "txt" },
];

/** 可导入的格式（pandoc 的 -f 值） */
export const IMPORT_FORMATS: { reader: string; label: string; ext: string[] }[] = [
  { reader: "docx", label: "Word 文档", ext: ["docx"] },
  { reader: "html", label: "HTML 网页", ext: ["html", "htm"] },
  { reader: "odt", label: "OpenDocument", ext: ["odt"] },
  { reader: "rtf", label: "RTF 富文本", ext: ["rtf"] },
  { reader: "epub", label: "EPUB 电子书", ext: ["epub"] },
  { reader: "docbook", label: "DocBook", ext: ["xml", "dbk"] },
  { reader: "latex", label: "LaTeX", ext: ["tex"] },
];

export interface PandocConf {
  /** 总开关：关掉后右键菜单不再出现导出/导入入口 */
  on: boolean;
  /** pandoc 可执行文件路径；留空 = 用 PATH 里的 pandoc */
  exe: string;
  /** 默认导出格式（FORMATS 里的 id） */
  format: string;
  /**
   * 导出按钮里列出的格式（FORMATS 的 id 数组）。
   * 由设置面板勾选控制；一个都没勾时回退成「只列默认格式」，避免按钮点开是空列表。
   */
  exports: string[];
  /** 导出位置策略 */
  outMode: OutMode;
  /** 固定输出目录（outMode = fixed 时用） */
  outDir: string;
  /** --standalone：生成完整文件（HTML / epub 必需，docx 无副作用） */
  standalone: boolean;
  /** --toc：生成目录 */
  toc: boolean;
  /** --number-sections：章节编号 */
  numberSections: boolean;
  /** PDF 引擎；留空则不加 --pdf-engine */
  pdfEngine: string;
  /**
   * 用户手动添加的引擎位置（exe 绝对路径）。
   * 用于 PATH 里查不到、或装在非标准目录的引擎；会一并列进 PDF 引擎下拉。
   */
  engines: string[];
  /** Word 参考模板（--reference-doc），可留空 */
  refDocx: string;
  /** 额外命令行参数，原样追加（进阶） */
  extra: string;
}

const K = {
  on: "lm-pandoc-on",
  exe: "lm-pandoc-exe",
  format: "lm-pandoc-format",
  exports: "lm-pandoc-exports",
  outMode: "lm-pandoc-outmode",
  outDir: "lm-pandoc-outdir",
  standalone: "lm-pandoc-standalone",
  toc: "lm-pandoc-toc",
  numSec: "lm-pandoc-numsec",
  pdfEngine: "lm-pandoc-pdfengine",
  engines: "lm-pandoc-engines",
  refDocx: "lm-pandoc-refdocx",
  extra: "lm-pandoc-extra",
};

function flag(key: string, def: boolean): boolean {
  return kvGetBool(key, def);
}

export const ALL_FORMAT_IDS = FORMATS.map((f) => f.id);

/** 每次读取都直查 store，设置面板改完立刻生效，不用往下传 props */
export function loadPandoc(): PandocConf {
  const mode = kvGet(K.outMode);
  const fmt = kvGet(K.format);
  const rawExports = kvGet(K.exports);
  // 没存过（老版本升级上来）视为全选，行为不变
  const exports =
    rawExports === null
      ? [...ALL_FORMAT_IDS]
      : rawExports.split(",").filter((id) => ALL_FORMAT_IDS.includes(id));
  // 路径分隔用换行（Windows 路径里可以有逗号，用逗号拼会拆错）
  const engines = (kvGet(K.engines) || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    on: flag(K.on, true),
    exe: kvGet(K.exe) || "",
    format: FORMATS.some((f) => f.id === fmt) ? (fmt as string) : "docx",
    exports,
    outMode: mode === "ask" || mode === "fixed" ? mode : "source",
    outDir: kvGet(K.outDir) || "",
    // 默认开：docx/pdf/epub 不受影响，HTML 少了它只是个片段
    standalone: flag(K.standalone, true),
    toc: flag(K.toc, false),
    numberSections: flag(K.numSec, false),
    pdfEngine: kvGet(K.pdfEngine) || "",
    engines,
    refDocx: kvGet(K.refDocx) || "",
    extra: kvGet(K.extra) || "",
  };
}

export function savePandoc(c: PandocConf): void {
  kvSet(K.on, c.on ? "1" : "0");
  kvSet(K.exe, c.exe.trim());
  kvSet(K.format, c.format);
  kvSet(K.exports, c.exports.join(","));
  kvSet(K.outMode, c.outMode);
  kvSet(K.outDir, c.outDir.trim());
  kvSet(K.standalone, c.standalone ? "1" : "0");
  kvSet(K.toc, c.toc ? "1" : "0");
  kvSet(K.numSec, c.numberSections ? "1" : "0");
  kvSet(K.pdfEngine, c.pdfEngine.trim());
  kvSet(K.engines, c.engines.filter(Boolean).join("\n"));
  kvSet(K.refDocx, c.refDocx.trim());
  kvSet(K.extra, c.extra.trim());
}

/**
 * 导出选区实际列出的格式：按勾选过滤；一个都没勾时退成「只列默认格式」。
 * 顺序恒等于 FORMATS 的声明顺序，勾选乱序不会让列表跳来跳去。
 */
export function pickedFormats(c: PandocConf): FormatDef[] {
  const on = FORMATS.filter((f) => c.exports.includes(f.id));
  if (on.length) return on;
  const def = FORMATS.find((f) => f.id === c.format);
  return def ? [def] : [FORMATS[0]];
}

/**
 * 额外参数清理：`&` `|` `<` `>` `^` 与换行都是 shell 元字符，直接剔除。
 * 双引号保留（`--variable mainfont="Microsoft YaHei"` 这类写法需要它）。
 */
export function cleanExtra(raw: string): string {
  return raw.replace(/[&|<>^\r\n]/g, " ").replace(/\s+/g, " ").trim();
}

export interface ArgOpts {
  /** pandoc 的 -f 值 */
  from: string;
  /** pandoc 的 -t 值 */
  to: string;
  /** 工作区内的输入文件名（相对，纯 ASCII） */
  input: string;
  /** 工作区内的输出文件名（相对，纯 ASCII） */
  output: string;
  standalone?: boolean;
  toc?: boolean;
  numberSections?: boolean;
  pdfEngine?: string;
  /** 工作区内的参考模板文件名 */
  refFile?: string;
  /** 抽取媒体的目录（相对，如 "."） */
  extractMedia?: string;
  extra?: string;
}

/**
 * 拼 workdir 内的 pandoc 参数表。所有 token 都是纯 ASCII，**不需要引号**，
 * 这样由 cmd / PowerShell / sh 谁解析结果都一样。
 *
 * 唯一例外是 `--pdf-engine` 的取值：它可能是用户添加的引擎绝对路径
 * （TeX 发行版几乎都在 Program Files 下），带空格时由 engineArgValue 补引号。
 */
export function buildArgs(o: ArgOpts): string[] {
  const args = ["-f", o.from, "-t", o.to, "-o", o.output];
  if (o.standalone) args.push("--standalone");
  if (o.toc) args.push("--toc");
  if (o.numberSections) args.push("--number-sections");
  const engine = cleanEngine(o.pdfEngine ?? "");
  if (engine) args.push(`--pdf-engine=${engineArgValue(engine)}`);
  if (o.refFile) args.push(`--reference-doc=${o.refFile}`);
  if (o.extractMedia) args.push(`--extract-media=${o.extractMedia}`);
  const extra = cleanExtra(o.extra ?? "");
  if (extra) args.push(...extra.split(" "));
  args.push(o.input);
  return args;
}
