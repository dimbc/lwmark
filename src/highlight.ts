/**
 * 代码块语法高亮：把代码按语言切成「带类型的字符区间」，交给 codeHighlight.ts
 * 用 ProseMirror Decoration 上色（纯视图层，不改文档、不进撤销栈）。
 *
 * 为什么用 refractor：Prism 的 ESM 封装，比 prismjs 本体的全局 `Prism` 依赖干净，
 * 语言文件是独立 ESM 且自带依赖（cpp 会自己 import c → clike），bundler 友好。
 * 它暴露底层 `tokenize(text, grammar)`，token 带**精确字符长度**，正好能换算成
 * ProseMirror 的区间；`highlight()` 那套 hast 输出对我们没用（还会把
 * hastscript / parse-entities 一起拖进来）。
 *
 * ⚠️ 实测要点：Prism 的 `Token.length` 在 content 是数组时返回的是**子项个数**而不是
 * 字符数，不能直接用。这里自己写 `lenOf()` 递归求和，并让 `highlight()` 自检
 * 「所有区间走完的偏移必须恰好等于代码长度」—— 对不上就整块不上色并 warn，
 * 绝不把错位的高亮画进编辑器。
 *
 * 只注册 16 种常见语言：core 单独 30 KB，8 语言 54.6 KB，16 语言 77.0 KB
 * （min 后体积，gzip 分别 10.9 / 19.5 / 27.0 KB）。加语言就是多一行 import + register。
 */
import { refractor } from "refractor/core";
import bash from "refractor/bash";
import c from "refractor/c";
import cpp from "refractor/cpp";
import csharp from "refractor/csharp";
import css from "refractor/css";
import go from "refractor/go";
import java from "refractor/java";
import javascript from "refractor/javascript";
import json from "refractor/json";
import markdown from "refractor/markdown";
import markup from "refractor/markup";
import python from "refractor/python";
import rust from "refractor/rust";
import sql from "refractor/sql";
import typescript from "refractor/typescript";
import yaml from "refractor/yaml";

for (const lang of [
  bash,
  c,
  cpp,
  csharp,
  css,
  go,
  java,
  javascript,
  json,
  markdown,
  markup,
  python,
  rust,
  sql,
  typescript,
  yaml,
]) {
  refractor.register(lang);
}

/** 语言选择器里列出的一项 */
export interface CodeLang {
  /** 围栏里写的主名（```python） */
  id: string;
  label: string;
  /** 也认的写法，写围栏里或点选后都能用 */
  alias: string[];
}

/**
 * 选择器里列出的语言。顺序即显示顺序（常用的在前）。
 * 除主名外的写法（js / py / md / html …）refractor 自己注册了别名，
 * 但 `jsx`、`c++`、`c#` 这类它不认，由这里的 EXTRA 兜。
 */
export const CODE_LANGS: CodeLang[] = [
  { id: "javascript", label: "JavaScript", alias: ["js", "jsx", "mjs", "cjs"] },
  { id: "typescript", label: "TypeScript", alias: ["ts", "tsx"] },
  { id: "python", label: "Python", alias: ["py", "python3"] },
  { id: "json", label: "JSON", alias: ["jsonc", "json5"] },
  { id: "markup", label: "HTML / XML", alias: ["html", "htm", "xml", "svg"] },
  { id: "css", label: "CSS", alias: [] },
  { id: "bash", label: "Bash / Shell", alias: ["sh", "shell", "zsh", "console"] },
  { id: "markdown", label: "Markdown", alias: ["md"] },
  { id: "yaml", label: "YAML", alias: ["yml"] },
  { id: "sql", label: "SQL", alias: [] },
  { id: "java", label: "Java", alias: [] },
  { id: "c", label: "C", alias: [] },
  { id: "cpp", label: "C++", alias: ["c++", "cplusplus"] },
  { id: "csharp", label: "C#", alias: ["c#", "cs", "dotnet"] },
  { id: "go", label: "Go", alias: ["golang"] },
  { id: "rust", label: "Rust", alias: [] },
];

/** 上面这 16 种之外，还认这些写法 → 统一化到主名 */
const EXTRA: Record<string, string> = {
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  node: "javascript",
  tsx: "typescript",
  python3: "python",
  jsonc: "json",
  json5: "json",
  htm: "markup",
  "c++": "cpp",
  cplusplus: "cpp",
  "c#": "csharp",
  cs: "csharp",
  golang: "go",
  zsh: "bash",
  console: "bash",
};

/**
 * 别名 → 主名（py → python、js → javascript、html → markup …）。
 * 作用有二：把围栏里的各种写法统一化，好让语言选择器能标出「当前是哪个」。
 *
 * 补全方式：refractor 装别名时主名与别名**指向同一个 grammar 对象**
 * （语言文件里就是 `e.languages.py = e.languages.python`），按对象反查即可，
 * 不用手抄一份别名表。
 */
const CANON: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const l of CODE_LANGS) {
    out[l.id] = l.id;
    for (const a of l.alias) out[a] = l.id;
  }
  for (const l of CODE_LANGS) {
    const grammar = refractor.languages[l.id];
    if (!grammar) continue;
    for (const [key, g] of Object.entries(refractor.languages)) {
      if (g === grammar) out[key] = l.id;
    }
  }
  return out;
})();

/**
 * 围栏里的写法 → 已注册的语言主名；不认识返回 null（= 不高亮）。
 * 空串也算 null：没标语言的代码块保持素色。
 *
 * 只认 CANON 里的键，所以 `extend`、`insertBefore` 这些 Prism 挂在 languages
 * 上的工具函数不会被误当成语言。
 */
export function resolveLang(raw: string): string | null {
  const key = String(raw || "").trim().toLowerCase().replace(/^\./, "");
  if (!key) return null;
  const id = CANON[key] ? key : EXTRA[key];
  return id && CANON[id] ? CANON[id] : null;
}

/** 一种 token 的字符区间与样式类名 */
export interface Tok {
  from: number;
  to: number;
  /** 完整 class，形如 "lm-hl lm-hl-keyword" */
  cls: string;
}

/** Prism 的 type / alias 都可能是空格分隔或含点的，统一清洗成合法 class 名 */
function clsOf(type: string, alias: unknown): string {
  const parts = [type];
  if (typeof alias === "string") parts.push(...alias.split(/\s+/));
  else if (Array.isArray(alias)) parts.push(...alias.filter((a) => typeof a === "string").flatMap((a: string) => a.split(/\s+/)));
  const seen = new Set<string>();
  const out: string[] = ["lm-hl"];
  for (const p of parts) {
    const name = p.replace(/[^a-z0-9-]/gi, "").toLowerCase();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(`lm-hl-${name}`);
  }
  return out.join(" ");
}

/**
 * ⚠️ 不能用 Prism 自带的 `token.length`：content 是数组时它返回**子项个数**。
 * 自己递归求和才是字符数。
 */
function lenOf(token: any): number {
  if (typeof token === "string") return token.length;
  if (typeof token.content === "string") return token.content.length;
  if (Array.isArray(token.content)) {
    let n = 0;
    for (const child of token.content) n += lenOf(child);
    return n;
  }
  return 0;
}

/**
 * 把 token 树摊平成互不重叠的区间。
 * 只保留「叶子」token —— 内层类型比外层具体，样式也只需要一层；
 * 外层（如 function 里套 title + punctuation）如果一起上色，两层 class 会撞在一起。
 */
function flatten(list: any[], start: number, out: Tok[]): number {
  let pos = start;
  for (const token of list) {
    if (typeof token === "string") {
      pos += token.length;
      continue;
    }
    const len = lenOf(token);
    const kids: any[] | null = Array.isArray(token.content) ? token.content : null;
    const nested = kids ? kids.some((k) => typeof k !== "string") : false;
    if (nested) {
      pos = flatten(kids!, pos, out);
    } else if (len > 0) {
      out.push({ from: pos, to: pos + len, cls: clsOf(String(token.type ?? ""), token.alias) });
      pos += len;
    }
  }
  return pos;
}

/** tokenize 结果缓存：每次选区变化都会重算 decorations，文档一大就吃不消 */
const cache = new Map<string, Tok[]>();
const CACHE_MAX = 400;

/**
 * 把代码切成带样式的区间。语言不认识 / 代码为空返回空数组。
 * 区间按位置升序且互不重叠，可直接用于 Decoration.inline。
 */
export function highlight(code: string, lang: string): Tok[] {
  if (!code) return [];
  const key = `${lang}\u0000${code}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let out: Tok[] = [];
  try {
    const grammar = refractor.languages[lang];
    if (grammar) {
      const toks: Tok[] = [];
      // 返回值理论上等于 code.length；不等说明摊平逻辑有问题，宁可不上色
      const end = flatten(refractor.tokenize(code, grammar) as any[], 0, toks);
      if (end === code.length) out = toks;
      else console.warn("[LWmark] 高亮区间偏移不一致，已跳过：", lang, end, code.length);
    }
  } catch (e) {
    // 语法文件对畸形代码抛错时不能让整个编辑器崩
    console.warn("[LWmark] 高亮失败：", lang, e);
  }

  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(key, out);
  return out;
}
