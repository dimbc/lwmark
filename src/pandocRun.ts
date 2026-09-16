/**
 * Pandoc 导出 / 导入的执行编排。
 *
 * 流程一律「先落进临时工作区，再用相对文件名调 pandoc，最后把结果搬回用户目录」：
 *   1. %TEMP%/LiteMark/pandoc/<时间戳>/ 建目录（每次独立，多任务不互相踩）
 *   2. 内容写成 in.md / 模板复制成 ref.docx（纯 ASCII 文件名）
 *   3. cwd 设成工作区，命令行里只有 `in.md`、`out.docx`、`ref.docx`
 *   4. 结果文件 copy 到目标路径（这一步才出现用户的中文/空格路径，走文件 API 不经 shell）
 *   5. 清理工作区
 *
 * 这样无论用户名、目录名带中文还是空格，命令行永远是干净的 ASCII，shell 解析不了别的花样。
 */
import {
  copyFile,
  ensureDir,
  fileExists,
  inNL,
  joinPath,
  pandocRun,
  pandocWorkDir,
  pickAnyFile,
  pickSavePath,
  readDir,
  readFileText,
  removePath,
  toPosixPath,
  writeFileText,
  type DirEntry,
  type ProcResult,
} from "./bridge";
import {
  FORMATS,
  IMPORT_FORMATS,
  buildArgs,
  type FormatDef,
  type PandocConf,
} from "./pandoc";

export interface ExportInput {
  text: string;
  /** 源文件绝对路径（正斜杠），未保存的文档为 null */
  srcPath: string | null;
  /** 标签显示名，用于推导导出文件名 */
  name: string;
}

export interface ExportResult {
  ok: boolean;
  /** 导出成功的完整路径（正斜杠） */
  path: string;
  message: string;
}

export interface ImportResult {
  ok: boolean;
  text: string;
  /** 新标签的显示名，如 报告.md */
  name: string;
  message: string;
}

const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, "");
const baseOf = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** pandoc 退出码非 0 时把它的话翻译成人话 */
function explain(res: ProcResult, fmt: FormatDef): string {
  const err = (res.stdErr || "").trim();
  const tail = err ? `（${err.slice(0, 220)}）` : `（退出码 ${res.exitCode}）`;
  if (fmt.engine && /not found|not recognized|No such file|--pdf-engine/i.test(err)) {
    return `没找到 PDF 引擎${tail}\n装个 TeX 发行版（MiKTeX / TeX Live）或 wkhtmltopdf，也可以在设置 → Pandoc 里指定引擎`;
  }
  if (err) return err.slice(0, 400);
  return `Pandoc 退出码 ${res.exitCode}，没有输出任何信息`;
}

/** 导出：当前文档 → docx / pdf / html / epub … */
export async function exportDoc(
  input: ExportInput,
  c: PandocConf,
  /** 本次导出指定的格式 id（来自导出按钮的格式列表）；省略则用设置里的默认格式 */
  fmtId?: string,
): Promise<ExportResult> {
  if (!inNL) {
    return { ok: false, path: "", message: "浏览器预览模式无法调用本机 Pandoc，请用 npm run app 启动" };
  }
  const fmt = FORMATS.find((f) => f.id === (fmtId || c.format)) ?? FORMATS[0];
  const base = (input.name || "未命名").replace(/\.(md|markdown|txt)$/i, "") || "未命名";

  /* ---------- 1. 定目标路径 ---------- */
  let target = "";
  if (c.outMode === "fixed") {
    if (!c.outDir) {
      return { ok: false, path: "", message: "还没设置固定输出目录（设置 → Pandoc）" };
    }
    target = joinPath(c.outDir, `${base}.${fmt.ext}`);
  } else if (c.outMode === "ask" || !input.srcPath) {
    // 「每次询问」，或者文档还没保存过（没有源目录可放）→ 弹保存框
    const picked = await pickSavePath(`导出为 ${fmt.label}`, `${base}.${fmt.ext}`, [
      fmt.ext,
    ]);
    if (!picked) return { ok: false, path: "", message: "已取消" };
    target = picked;
  } else {
    target = joinPath(dirOf(input.srcPath), `${base}.${fmt.ext}`);
  }

  /* ---------- 2. 工作区 ---------- */
  const ws = await pandocWorkDir();
  if (!ws) return { ok: false, path: "", message: "无法创建临时工作目录" };

  const outName = `out.${fmt.ext}`;
  const outAbs = joinPath(ws, outName);
  const made: string[] = [];

  try {
    await writeFileText(joinPath(ws, "in.md"), input.text);
    made.push(joinPath(ws, "in.md"));

    // Word 参考模板也搬进工作区：命令行里只出现 ref.docx
    let refFile = "";
    if (fmt.id === "docx" && c.refDocx) {
      if (!(await fileExists(c.refDocx))) {
        return { ok: false, path: "", message: `参考模板不存在：${c.refDocx}` };
      }
      refFile = "ref.docx";
      await copyFile(c.refDocx, joinPath(ws, refFile));
      made.push(joinPath(ws, refFile));
    }

    const args = buildArgs({
      from: "gfm",
      to: fmt.id,
      input: "in.md",
      output: outName,
      standalone: c.standalone,
      toc: c.toc,
      numberSections: c.numberSections,
      pdfEngine: fmt.engine ? c.pdfEngine : "",
      refFile,
      extra: c.extra,
    });

    const res = await pandocRun(c.exe, args, ws);
    if (res.exitCode !== 0) {
      return { ok: false, path: "", message: explain(res, fmt) };
    }
    if (!(await fileExists(outAbs))) {
      return {
        ok: false,
        path: "",
        message: `Pandoc 执行完成但没有生成文件${(res.stdErr || "").trim().slice(0, 200)}`,
      };
    }

    // ---------- 3. 搬到目标位置（中文 / 空格路径只在这一步出现，走文件 API） ----------
    made.push(outAbs);
    await copyFile(outAbs, target);
    return { ok: true, path: toPosixPath(target), message: "" };
  } catch (e) {
    return { ok: false, path: "", message: describe(e) };
  } finally {
    await cleanup(ws, made);
  }
}

/** 导入：docx / html / odt / rtf … → Markdown 文本（交给新标签打开） */
export async function importDoc(c: PandocConf): Promise<ImportResult> {
  const miss = { ok: false, text: "", name: "", message: "" };
  if (!inNL) {
    return { ...miss, message: "浏览器预览模式无法调用本机 Pandoc，请用 npm run app 启动" };
  }

  const src = await pickAnyFile(
    "导入文档（用 Pandoc 转为 Markdown）",
    IMPORT_FORMATS.flatMap((f) => f.ext),
  );
  if (!src) return { ...miss, message: "已取消" };

  const ext = (src.split(".").pop() ?? "").toLowerCase();
  const fmt = IMPORT_FORMATS.find((f) => f.ext.includes(ext));
  if (!fmt) return { ...miss, message: `不支持的格式：.${ext}` };

  const base = baseOf(src).replace(/\.[^.]+$/, "") || "导入文档";
  const ws = await pandocWorkDir();
  if (!ws) return { ...miss, message: "无法创建临时工作目录" };

  const inName = `in.${ext}`;
  const outName = "out.md";
  const made: string[] = [];

  try {
    await copyFile(src, joinPath(ws, inName));
    made.push(joinPath(ws, inName));

    // extract-media=. → 图片抽到工作区 media/，随后搬到源文档同目录的 <名字>.assets/
    const args = buildArgs({
      from: fmt.reader,
      to: "gfm",
      input: inName,
      output: outName,
      extractMedia: ".",
      // 不折行：pandoc 默认在 72 列硬断行，导入的文本会到处是断行
      extra: "--wrap=none",
    });
    const res = await pandocRun(c.exe, args, ws);
    if (res.exitCode !== 0) {
      return { ...miss, message: explain(res, { id: fmt.reader, label: fmt.label, ext }) };
    }

    const outAbs = joinPath(ws, outName);
    if (!(await fileExists(outAbs))) {
      return { ...miss, message: "Pandoc 转换完成但没有生成 Markdown" };
    }
    made.push(outAbs);
    let md = await readFileText(outAbs);

    md = await relocateMedia(md, ws, src, base, made);

    return { ok: true, text: md, name: `${base}.md`, message: "" };
  } catch (e) {
    return { ...miss, message: describe(e) };
  } finally {
    await cleanup(ws, made);
  }
}

/**
 * 把工作区 media/ 里的图片搬到源文档旁边的 `<名字>.assets/`，并把引用改写成**绝对路径**。
 * 与项目里图片一律写绝对路径的约定保持一致：Markdown 之后存到哪都不影响图片显示。
 */
async function relocateMedia(
  md: string,
  ws: string,
  src: string,
  base: string,
  made: string[],
): Promise<string> {
  const mediaDir = joinPath(ws, "media");
  if (!(await fileExists(mediaDir))) return md;

  let entries: DirEntry[] = [];
  try {
    entries = await readDir(mediaDir);
  } catch {
    return md;
  }
  const files = entries.filter((e) => e.type === "FILE");
  if (!files.length) return md;

  const assets = joinPath(dirOf(src), `${base}.assets`);
  try {
    await ensureDir(assets);
  } catch {
    return md;
  }

  // pandoc 给图片带上了宽高属性，gfm 表达不了就会退化成 `<img ... />` 原始 HTML；
  // Milkdown 不渲染原始 HTML，所以这里统一还原成 Markdown 图片语法。
  let out = md.replace(/<img\b[^>]*?\/?>/gi, imgTagToMd);

  for (const f of files) {
    const srcAbs = joinPath(mediaDir, f.entry);
    const dstAbs = joinPath(assets, f.entry);
    try {
      await copyFile(srcAbs, dstAbs);
      made.push(srcAbs);
      const abs = toPosixPath(dstAbs);
      // 路径带空格时按 CommonMark 规则用尖括号包住，否则链接会被截断
      out = out.split(`media/${f.entry}`).join(hasSpace(abs) ? `<${abs}>` : abs);
    } catch {
      /* 单张图失败不影响整体导入 */
    }
  }
  return out;
}

/** `<img src="..." alt="..." />` → `![alt](src)` */
function imgTagToMd(tag: string): string {
  const src =
    /src\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ??
    /src\s*=\s*'([^']*)'/i.exec(tag)?.[1] ??
    "";
  if (!src) return tag;
  const alt = /alt\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? "";
  return `![${alt}](${src})`;
}

const hasSpace = (s: string) => /[\s()<>]/.test(s);

/** 清掉本次任务产出的文件，再删工作区目录 */
async function cleanup(ws: string, made: string[]) {
  for (const f of made) await removePath(f);
  // media 目录里的文件已在上面的 made 里，这里只删目录本身
  await removePath(joinPath(ws, "media"));
  await removePath(ws);
}

function describe(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg || "未知错误";
}
