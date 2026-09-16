/**
 * PDF 引擎的候选表与取值规范化。
 *
 * 这里**不做探测**（探测在 typstInstall.ts 的 PowerShell 脚本里，和 Typst 一起
 * 一次往返扫完），只负责三件事：
 *   1. 列出 pandoc 支持的引擎 + 各自的可执行文件名（脚本按这张表去 PATH 里找）
 *   2. 把引擎取值清理成能安全进命令行的形式
 *   3. 带空格的路径补引号（`--pdf-engine="C:\Program Files\...\xelatex.exe"`）
 *
 * ⚠️ 第 3 条是对「命令行里不出现引号」那条约定的**唯一例外**：TeX 发行版基本都装在
 * `Program Files` 下，不加引号 cmd 会把路径从空格处切成两段。引号由我们自己加，
 * 用户填进来的引号一律先剥掉（见 cleanEngine），所以不会把结构搞乱。
 */

export interface EngineDef {
  /** `--pdf-engine` 的取值（引擎名） */
  id: string;
  /** 下拉里的显示名 */
  label: string;
  /** 在 PATH 里找的可执行文件名 */
  bin: string;
}

/** 顺序 = 下拉里的排列顺序（越靠前越推荐） */
export const ENGINE_DEFS: EngineDef[] = [
  { id: "typst", label: "Typst", bin: "typst" },
  { id: "xelatex", label: "XeLaTeX", bin: "xelatex" },
  { id: "lualatex", label: "LuaLaTeX", bin: "lualatex" },
  { id: "pdflatex", label: "pdfLaTeX", bin: "pdflatex" },
  { id: "tectonic", label: "Tectonic", bin: "tectonic" },
  { id: "wkhtmltopdf", label: "wkhtmltopdf", bin: "wkhtmltopdf" },
  { id: "weasyprint", label: "WeasyPrint", bin: "weasyprint" },
  { id: "prince", label: "Prince", bin: "prince" },
  { id: "context", label: "ConTeXt", bin: "context" },
];

const BY_ID = new Map(ENGINE_DEFS.map((e) => [e.id, e]));

/** 引擎名的显示名；未知值（自定义路径）取文件名 */
export function engineLabel(v: string): string {
  const hit = BY_ID.get(v);
  if (hit) return hit.label;
  return baseName(v) || v;
}

/** 路径末段（兼容两种斜杠） */
export function baseName(p: string): string {
  const s = p.trim();
  const i = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
  return i >= 0 ? s.slice(i + 1) : s;
}

/**
 * 清理引擎取值：剥掉引号，拒绝 shell 元字符（`& | < > ^ %`）。
 * 返回 null 表示这个值不能进命令行，调用方要给用户提示。
 */
export function cleanEngine(v: string): string | null {
  const s = v.trim().replace(/"/g, "");
  if (!s) return "";
  if (/[&|<>^%]/.test(s)) return null;
  return s;
}

/** 拼进 `--pdf-engine=` 的取值：带空格的路径补引号 */
export function engineArgValue(v: string): string {
  return /\s/.test(v) ? `"${v}"` : v;
}

/** 看起来像个路径（而不是纯引擎名） */
export function isEnginePath(v: string): boolean {
  return /[\\/]/.test(v);
}
