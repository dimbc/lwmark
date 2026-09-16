/**
 * Neutralino 桥接层：浏览器里自动降级（input file / blob 下载）。
 */
import { init, os, filesystem, app, computer, window as nlWindow } from "@neutralinojs/lib";

export let inNL = typeof window !== "undefined" && "NL_PORT" in window;

export function setNL(v: boolean) {
  inNL = v;
}

/** 运行时加载 Neutralino 全局变量（vite 构建器不感知，浏览器下 404 自动降级） */
export function loadNLGlobals(): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "__neutralino_globals.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

export async function initNL() {
  if (inNL) await init();
}

export async function openMarkdown(): Promise<{ path: string; text: string } | null> {
  if (inNL) {
    const res = (await os.showOpenDialog("打开 Markdown", {
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
    })) as string | string[] | null;
    const p = Array.isArray(res) ? res[0] : res;
    if (!p) return null;
    const text = await filesystem.readFile(p);
    return { path: p, text };
  }
  // 浏览器降级
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.markdown,.txt";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () =>
        resolve({ path: file.name, text: String(reader.result ?? "") });
      reader.readAsText(file);
    };
    input.click();
  });
}

export async function openFolder(): Promise<string | null> {
  if (!inNL) return null;
  const res = (await os.showFolderDialog("选择 Markdown 文件夹")) as string | null;
  return res || null;
}

export interface DirEntry {
  entry: string;
  type: "FILE" | "DIRECTORY";
}

export async function readDir(path: string): Promise<DirEntry[]> {
  const list = (await filesystem.readDirectory(path)) as DirEntry[];
  return list.filter((d) => d.entry !== "." && d.entry !== "..");
}

export async function writeFileText(path: string, text: string): Promise<void> {
  await filesystem.writeFile(path, text);
}

export async function readFileText(path: string): Promise<string> {
  return String(await filesystem.readFile(path));
}

export function joinPath(dir: string, name: string): string {
  if (/[\\/]$/.test(dir)) return dir + name;
  return dir + (/^[A-Za-z]:|^\\\\/.test(dir) ? "\\" : "/") + name;
}

export async function saveMarkdown(
  path: string | null,
  text: string,
): Promise<string | null> {
  if (inNL) {
    let target = path;
    if (!target) {
      target = (await os.showSaveDialog("保存 Markdown", {
        defaultPath: "未命名.md",
      })) as string | null;
      if (!target) return null;
    }
    await filesystem.writeFile(target, text);
    return target;
  }
  // 浏览器降级：触发下载
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = path ?? "未命名.md";
  a.click();
  URL.revokeObjectURL(a.href);
  return path ?? "未命名.md";
}

/** 窗口在屏幕上的位置与大小，单位是**物理像素**（和 window.setSize / move 同一套） */
export interface WinRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 最小窗口尺寸，与 neutralino.config.json 的 modes.window 保持一致 */
export const WIN_MIN = { width: 720, height: 520 };

export const winCtl = {
  minimize: () => nlWindow.minimize(),
  close: () => app.exit(), // v6 无 window.close，关闭走 app.exit
  drag: () => nlWindow.beginDrag(), // v6 拖拽 API
  maximize: () => nlWindow.maximize(),
  unmaximize: () => nlWindow.unmaximize(),
  isMaximized: () => nlWindow.isMaximized(),
  /**
   * 读当前窗口矩形。borderless 窗口在 Windows 下去掉了 WS_THICKFRAME，
   * 系统不再提供拖拽缩放，所有尺寸变化都得自己算，所以需要一个统一的读取口。
   */
  async rect(): Promise<WinRect> {
    if (!inNL) return { x: 0, y: 0, width: 0, height: 0 };
    const [size, pos] = await Promise.all([nlWindow.getSize(), nlWindow.getPosition()]);
    return {
      x: pos.x ?? 0,
      y: pos.y ?? 0,
      width: size.width ?? 0,
      height: size.height ?? 0,
    };
  },
  /**
   * 改大小 / 挪位置，两个都是物理像素。
   * setSize 的参数是「补丁」语义，但 minWidth 依赖窗口创建时的值，显式再传一遍更保险。
   */
  async setRect(r: Partial<WinRect>): Promise<void> {
    if (!inNL) return;
    if (typeof r.width === "number" && typeof r.height === "number") {
      await nlWindow.setSize({
        width: Math.round(r.width),
        height: Math.round(r.height),
        minWidth: WIN_MIN.width,
        minHeight: WIN_MIN.height,
        resizable: true,
      });
    }
    if (typeof r.x === "number" && typeof r.y === "number") {
      await nlWindow.move(Math.round(r.x), Math.round(r.y));
    }
  },
  /** 显示器信息，用来把窗口位置夹回屏幕内 */
  displays: () => computer.getDisplays(),
};

/* ---------- 图片 ---------- */

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"];

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  avif: "image/avif",
};

/** 文档里统一写正斜杠路径 */
export const toPosixPath = (p: string) => p.replace(/\\/g, "/");

/** 交给 Neutralino 的原生路径（Windows 盘符还原反斜杠） */
const toNativePath = (p: string) =>
  /^[A-Za-z]:\//.test(p) ? p.replace(/\//g, "\\") : p;

/** 选一张本地图片，返回正斜杠绝对路径 */
export async function pickImage(): Promise<string | null> {
  if (!inNL) return null;
  const res = (await os.showOpenDialog("插入图片", {
    filters: [{ name: "图片", extensions: IMAGE_EXT }],
  })) as string | string[] | null;
  const p = Array.isArray(res) ? res[0] : res;
  return p ? toPosixPath(p) : null;
}

/** 浏览器 <input type=file> 选图，返回 File（无路径） */
export function pickImageBrowser(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_EXT.map((e) => "." + e).join(",");
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? "");
      resolve(s.includes(",") ? s.slice(s.indexOf(",") + 1) : s);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function mimeOf(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "image/png";
}

/** ArrayBuffer → base64（分块，避免大图爆栈） */
export function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** base64 → ArrayBuffer（writeBinaryFile 需要） */
export function base64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * 本地图片 → 可显示的 blob URL（仅供页面内预览，不改文档内容）。
 * 用 blob 而非 data URL：不做 base64 膨胀，大图也不会卡。
 */
export async function localImageBlobUrl(path: string): Promise<string | null> {
  if (!inNL) return null;
  try {
    // v6 的 readBinaryFile 经 lib 解码后返回 ArrayBuffer
    const buf = (await filesystem.readBinaryFile(
      toNativePath(path),
    )) as unknown as ArrayBuffer;
    if (!buf || !buf.byteLength) return null;
    return URL.createObjectURL(new Blob([buf], { type: mimeOf(path) }));
  } catch (e) {
    console.error("读取图片失败：", path, e);
    return null;
  }
}

/** 剪贴板图片落盘到系统临时目录，返回绝对路径（文档里引用它） */
export async function saveClipboardImage(
  base64: string,
  ext = "png",
): Promise<string | null> {
  if (!inNL) return null;
  try {
    const tmp = String((await os.getEnv("TEMP")) || (await os.getEnv("TMP")) || "");
    if (!tmp) return null;
    const dir = joinPath(tmp, "LiteMark");
    try {
      await filesystem.createDirectory(dir);
    } catch {
      /* 已存在则忽略 */
    }
    const path = joinPath(dir, `paste-${Date.now()}.${ext}`);
    // v6 的 writeBinaryFile 需要 ArrayBuffer
    await filesystem.writeBinaryFile(path, base64ToBuffer(base64) as never);
    return toPosixPath(path);
  } catch (e) {
    console.error("保存剪贴板图片失败：", e);
    return null;
  }
}

/* ---------- PicGo 图床 ---------- */

export interface PicgoResult {
  /** 成功时的图床地址 */
  url: string | null;
  /** 失败原因（成功时为空串） */
  error: string;
}

/** 服务地址白名单校验：只允许协议 + 主机 + 端口 + 路径，杜绝命令行注入 */
function safeServer(server: string): string | null {
  const base = server.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[A-Za-z0-9.:_\-/]+$/.test(base)) return null;
  return base;
}

/**
 * 临时目录里的 LiteMark 子目录（顺带确保存在）。
 * 图床上传的 JSON、Pandoc 转译产物、Typst 安装脚本都放这里。
 */
export async function liteTempDir(): Promise<string | null> {
  if (!inNL) return null;
  try {
    const tmp = String((await os.getEnv("TEMP")) || (await os.getEnv("TMP")) || "");
    if (!tmp) return null;
    const dir = joinPath(tmp, "LiteMark");
    try {
      await filesystem.createDirectory(dir);
    } catch {
      /* 已存在则忽略 */
    }
    return dir;
  } catch (e) {
    console.error("找不到系统临时目录：", e);
    return null;
  }
}

/**
 * 调本机 PicGo 的 HTTP 服务上传一张图，返回图床地址。
 *
 * ⚠️ 为什么不用 WebView 的 fetch：PicGo 服务端**没有开 CORS**（扒过 picgo-core 的实包，
 * bundle 里没有任何 Access-Control-Allow-Origin，也没有 cors 中间件），跨源会被浏览器拦掉，
 * 而且 application/json 还会先发预检、直接死在预检上。Neutralino 的 net.request 又**不支持
 * 请求 body**（v6 的 NetRequestOptions 只有 params/headers/auth）。所以让系统去发：
 * execCommand 调 Windows 自带的 curl.exe。
 *
 * ⚠️ 命令要走 cmd /c，路径含空格或引号会出事。规避办法有两条：
 *   1. JSON 载荷先写进临时文件，命令行里只出现**文件名**（`--data-binary @名字`），不带路径；
 *   2. `cwd` 设成临时目录，让 curl 在那边找这个文件。
 * 服务地址另外用白名单正则在前面拦一道，避免把用户输入直接拼进命令行。
 */
export async function picgoUpload(
  server: string,
  imagePath: string,
  timeoutSec = 45,
): Promise<PicgoResult> {
  if (!inNL) return { url: null, error: "浏览器预览模式无法访问本机 PicGo" };
  const base = safeServer(server);
  if (!base) return { url: null, error: "服务地址格式不对（示例：http://127.0.0.1:36677）" };

  const dir = await liteTempDir();
  if (!dir) return { url: null, error: "找不到系统临时目录" };

  // 每次上传用独立文件名：多张图连着传时互不覆盖
  const file = `picgo-${Date.now()}-${Math.floor(Math.random() * 1e4)}.json`;
  const payloadPath = joinPath(dir, file);
  try {
    // PicGo 要的是本机绝对路径，Windows 下用反斜杠最稳
    await filesystem.writeFile(
      payloadPath,
      JSON.stringify({ list: [toNativePath(imagePath)] }),
    );
  } catch (e) {
    return { url: null, error: `准备上传数据失败：${String(e)}` };
  }

  // ⚠️ 命令里刻意不留「带空格的参数」、不加任何引号 —— 这样不论最终由 cmd / PowerShell / sh
  // 哪种 shell 解析，结果完全一致。（`-H Content-Type:application/json` 不写空格也合法：
  // curl 按第一个冒号切分 header 名值；实测服务端收到的 Content-Type 正确。）
  const cmd =
    `curl.exe -sS -X POST -H Content-Type:application/json ` +
    `--data-binary @${file} --max-time ${timeoutSec} ${base}/upload`;

  try {
    const res = (await os.execCommand(cmd, { cwd: dir })) as {
      exitCode: number;
      stdOut: string;
      stdErr: string;
    };
    const out = (res.stdOut || "").trim();
    const err = (res.stdErr || "").trim();

    if (!out) {
      const unreachable =
        res.exitCode === 7 || /Failed to connect|Connection refused|Could not connect/i.test(err);
      return {
        url: null,
        error: unreachable
          ? "连不上 PicGo 服务，确认 PicGo 已启动并打开了「设置 Server」"
          : err || `上传失败（curl 退出码 ${res.exitCode}）`,
      };
    }

    let data: { success?: boolean; result?: string[]; message?: string };
    try {
      data = JSON.parse(out) as typeof data;
    } catch {
      return { url: null, error: `PicGo 返回了非 JSON 内容：${out.slice(0, 120)}` };
    }
    const url = Array.isArray(data.result) ? String(data.result[0] ?? "") : "";
    if (data.success && url) return { url, error: "" };
    return { url: null, error: data.message || "PicGo 未返回图片地址" };
  } catch (e) {
    return { url: null, error: `调用 curl 失败：${String(e)}` };
  } finally {
    filesystem.remove(payloadPath).catch(() => {
      /* 清理失败不影响结果 */
    });
  }
}

/** 探一下 PicGo 服务在不在（设置面板的「测试连接」用） */
export async function picgoPing(server: string): Promise<PicgoResult & { ok: boolean }> {
  if (!inNL) return { ok: false, url: null, error: "浏览器预览模式无法访问本机 PicGo" };
  const base = safeServer(server);
  if (!base) return { ok: false, url: null, error: "服务地址格式不对" };
  try {
    // 只看能不能连上：服务在线 → curl 退出码 0（PicGo 对未知路由回 404 也无妨）；
    // 连不上 → 退出码 7。所以不需要 -w 取状态码，也就避免了命令行里出现引号与 % 符号。
    const res = (await os.execCommand(
      `curl.exe -s -o NUL --max-time 8 ${base}/`,
    )) as { exitCode: number; stdOut: string; stdErr: string };
    if (res.exitCode === 0) return { ok: true, url: null, error: "" };
    return {
      ok: false,
      url: null,
      error: "连不上，确认 PicGo 已启动并打开了「设置 Server」",
    };
  } catch (e) {
    return { ok: false, url: null, error: `调用 curl 失败：${String(e)}` };
  }
}

/* ---------- Pandoc ---------- */

export const DEFAULT_PANDOC = "pandoc.exe";

/**
 * 可执行文件路径校验：拒绝 shell 元字符（`& | < > ^ %` 与引号）。
 * 引号由我们自己加，避免用户填进来的引号把命令行结构搞乱。
 */
function safeExe(exe: string): string | null {
  const s = exe.trim() || DEFAULT_PANDOC;
  if (/[&|<>^%"]/.test(s)) return null;
  return s;
}

/** 带空格的路径加双引号（cmd / PowerShell 通用） */
const quoteIfNeeded = (s: string) => (/\s/.test(s) ? `"${s}"` : s);

export interface ProcResult {
  exitCode: number;
  stdOut: string;
  stdErr: string;
}

/**
 * 通用：在指定目录里跑一条命令。
 *
 * ⚠️ 调用方必须保证命令行里**没有引号、没有用户路径**（见 pandoc.ts 模块头的约定）：
 * 需要多行逻辑时，把脚本写成固定 ASCII 文件名的 .ps1 落进工作目录，
 * 命令行里只出现文件名 + cwd。Typst 安装就是这么干的（typstInstall.ts）。
 */
export async function execIn(cmd: string, cwd?: string): Promise<ProcResult> {
  return (await os.execCommand(cmd, cwd ? { cwd } : undefined)) as ProcResult;
}

/** 探一下 pandoc 在不在，返回版本行（设置面板的「检测」用） */
export async function pandocDetect(
  exe: string,
): Promise<{ ok: boolean; version: string; error: string }> {
  if (!inNL) {
    return { ok: false, version: "", error: "浏览器预览模式无法调用本机 Pandoc" };
  }
  const bin = safeExe(exe);
  if (!bin) {
    return { ok: false, version: "", error: "路径含非法字符（& | < > ^ % 或引号）" };
  }
  try {
    const res = (await os.execCommand(`${quoteIfNeeded(bin)} --version`)) as ProcResult;
    const out = (res.stdOut || "").trim();
    if (res.exitCode !== 0 || !out) {
      const err = (res.stdErr || "").trim();
      return {
        ok: false,
        version: "",
        error: err
          ? err.split(/\r?\n/)[0].slice(0, 160)
          : "没找到 pandoc，确认已安装，或在设置里填它的完整路径",
      };
    }
    const first = (out.split(/\r?\n/)[0] || "").trim();
    return { ok: true, version: first.replace(/\s+/g, " "), error: "" };
  } catch (e) {
    return { ok: false, version: "", error: `调用失败：${String(e)}` };
  }
}

/**
 * 跑一次 pandoc。cwd 必须是工作区，args 里只允许纯 ASCII 相对文件名
 * （拼装见 pandoc.ts 的 buildArgs）。
 *
 * ⚠️ execCommand 之间是同步阻塞的：PDF 生成慢的时候界面会等，所以调用方要先给提示。
 */
export async function pandocRun(
  exe: string,
  args: string[],
  cwd: string,
): Promise<ProcResult> {
  const bin = safeExe(exe);
  if (!bin) throw new Error('Pandoc 路径含非法字符（& | < > ^ % 或引号）');
  return (await os.execCommand(`${quoteIfNeeded(bin)} ${args.join(" ")}`, {
    cwd,
  })) as ProcResult;
}

/** 建一个本次任务专用的工作区：%TEMP%/LiteMark/pandoc/<时间戳>/ */
export async function pandocWorkDir(): Promise<string | null> {
  if (!inNL) return null;
  try {
    const tmp = String((await os.getEnv("TEMP")) || (await os.getEnv("TMP")) || "");
    if (!tmp) return null;
    for (const dir of [joinPath(tmp, "LiteMark"), joinPath(joinPath(tmp, "LiteMark"), "pandoc")]) {
      try {
        await filesystem.createDirectory(dir);
      } catch {
        /* 已存在 */
      }
    }
    const ws = joinPath(joinPath(joinPath(tmp, "LiteMark"), "pandoc"), String(Date.now()));
    await filesystem.createDirectory(ws);
    return ws;
  } catch (e) {
    console.error("创建 Pandoc 工作目录失败：", e);
    return null;
  }
}

/** 逐级建目录（createDirectory 不递归） */
export async function ensureDir(dir: string): Promise<void> {
  const isWin = /^[A-Za-z]:/.test(dir);
  const parts = dir.split(/[\\/]+/).filter(Boolean);
  let acc = isWin ? parts[0] + "\\" : "/";
  for (const p of (isWin ? parts.slice(1) : parts)) {
    acc = joinPath(acc, p);
    try {
      await filesystem.createDirectory(acc);
    } catch {
      /* 已存在则忽略 */
    }
  }
}

/** 复制文件（overwrite 必须显式打开，否则目标已存在时会静默失败） */
export async function copyFile(src: string, dst: string): Promise<void> {
  await filesystem.copy(toNativePath(src), toNativePath(dst), {
    overwrite: true,
    recursive: false,
    skip: false,
  });
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await filesystem.getStats(toNativePath(path));
    return true;
  } catch {
    return false;
  }
}

/** 删除文件或空目录；失败不抛（清理用） */
export async function removePath(path: string): Promise<void> {
  try {
    await filesystem.remove(toNativePath(path));
  } catch {
    /* 清理失败不影响结果 */
  }
}

/** 通用文件选择（Pandoc 导入、选参考模板） */
export async function pickAnyFile(
  title: string,
  exts: string[],
): Promise<string | null> {
  if (!inNL) return null;
  const res = (await os.showOpenDialog(title, {
    filters: [{ name: "支持的文档", extensions: exts }],
  })) as string | string[] | null;
  const p = Array.isArray(res) ? res[0] : res;
  return p ? toPosixPath(p) : null;
}

/** 另存为对话框（导出到指定路径用） */
export async function pickSavePath(
  title: string,
  defaultName: string,
  exts: string[],
): Promise<string | null> {
  if (!inNL) return null;
  const res = (await os.showSaveDialog(title, {
    defaultPath: defaultName,
    filters: [{ name: "导出文件", extensions: exts }],
  })) as string | null;
  return res ? toPosixPath(res) : null;
}
