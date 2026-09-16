/**
 * 统一配置存储（跨会话持久）。
 *
 * 为什么不用 localStorage：Neutralino 以 `"port": 0` 启动时每次端口都变，而 WebView 的
 * localStorage 是按 origin（含端口）隔离的 —— 同一个 key 这次写进 `127.0.0.1:50479`，
 * 下次读的是 `127.0.0.1:56561`，等于每次都读不到上一次的值，设置看起来「没保存」。
 *
 * 所以配置的真源改成磁盘上的一个 JSON 文件：
 *
 *     %APPDATA%\LWmark\settings.json
 *
 * `initStore()` 在挂载 Vue 之前把整份配置读进内存，之后 kvGet / kvSet 都是**同步**的
 * （老代码的写法不用改），写入按 120ms 防抖合并落盘。
 *
 * 浏览器预览（没有 Neutralino）自动降级为 localStorage，行为与以前一致。
 */
import { os } from "@neutralinojs/lib";
import { copyFile, ensureDir, fileExists, inNL, joinPath, readFileText, writeFileText } from "./bridge";

type Dict = Record<string, string>;

const DIR_NAME = "LWmark";
/** 改名前的配置目录（%APPDATA%\LiteMark），首次启动把旧配置一次性搬过来 */
const LEGACY_DIR_NAME = "LiteMark";
const FILE_NAME = "settings.json";
/** 只接管自家键，别把别的库写进 localStorage 的东西也搬走 */
const OWN_KEY = /^lm-/;
/** 写盘防抖：太短会频繁 IO，太长则关窗口时可能来不及落盘 */
const FLUSH_DELAY = 120;

let data: Dict = {};
/** 落盘目标；为 null 表示走 localStorage 降级 */
let filePath: string | null = null;
let loaded = false;
let dirty = false;
let timer = 0;
let flushing = false;

function ls(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // 某些隐私模式访问 localStorage 会抛
    return null;
  }
}

/** 读一遍当前 origin 的 localStorage（老版本只有它，用来做一次性迁移） */
function legacySnapshot(): Dict {
  const out: Dict = {};
  const s = ls();
  if (!s) return out;
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k && OWN_KEY.test(k)) {
        const v = s.getItem(k);
        if (v !== null) out[k] = v;
      }
    }
  } catch {
    /* 读不到就当没有 */
  }
  return out;
}

/**
 * 改名（LiteMark → LWmark）的一次性迁移：新配置目录里还没有 settings.json 时，
 * 把旧目录 %APPDATA%\LiteMark\settings.json 复制过来。只复制不删除，旧目录留给用户处置。
 */
async function migrateLegacyConfig(appData: string, dir: string): Promise<boolean> {
  try {
    const legacyPath = joinPath(joinPath(appData, LEGACY_DIR_NAME), FILE_NAME);
    if (!(await fileExists(legacyPath))) return false;
    await ensureDir(dir);
    await copyFile(legacyPath, joinPath(dir, FILE_NAME));
    console.info("[LWmark] 已把 %APPDATA%\\LiteMark 的配置迁移到 %APPDATA%\\LWmark");
    return true;
  } catch (e) {
    console.warn("[LWmark] 旧配置迁移失败，按全新配置启动：", e);
    return false;
  }
}

/**
 * 启动时调用一次（在 createApp().mount() 之前）。
 * 读不到 Neutralino 环境或配置目录不可用时静默降级到 localStorage，不影响启动。
 *
 * ⚠️ 这个函数跑在挂载之前，所以它**绝不能碰 localStorage**（Neutralino 里）。
 * WebView 的 localStorage 是同步 IPC：profile 一旦出问题，它不会报错而是**永久阻塞**
 * 主线程 —— 连 setTimeout 都不再触发，界面就再也挂不上，表现就是一片白。
 * 老版本迁移只在浏览器预览下有意义（Neutralino 端口随机，旧 origin 本来也读不到）。
 */
export async function initStore(): Promise<void> {
  if (loaded) return;

  try {
    const appData = String((await os.getEnv("APPDATA")) || "");
    if (appData) {
      const dir = joinPath(appData, DIR_NAME);
      const path = joinPath(dir, FILE_NAME);
      let saved: Dict = {};
      // 新目录还没有配置时，先把改名前的旧目录（%APPDATA%\LiteMark）搬过来再读
      const hasFile = (await fileExists(path)) || (await migrateLegacyConfig(appData, dir));
      if (hasFile) {
        try {
          const raw = await readFileText(path);
          // 别的工具（记事本、PowerShell 的 Out-File）写的文件可能带 BOM，JSON.parse 会直接抛
          const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === "object") saved = parsed as Dict;
        } catch (e) {
          // 文件损坏时别把用户后面的设置一起挡掉，从空配置继续
          console.warn("[LWmark] 配置文件解析失败，按空配置启动：", e);
        }
      }
      await ensureDir(dir);
      filePath = path;
      // 磁盘是真源；只有磁盘上还从没写过配置时，才要一份老 origin 的残留做一次性迁移
      data = hasFile ? { ...saved } : { ...legacyForMigration(), ...saved };
      loaded = true;
      return;
    }
  } catch (e) {
    console.warn("[LWmark] 配置目录不可用，回落到 localStorage：", e);
  }

  data = legacyForMigration();
  loaded = true;
}

/** 浏览器预览下才用得着 localStorage；Neutralino 里一律不碰（同步 IPC，卡住即白屏） */
function legacyForMigration(): Dict {
  return inNL ? {} : legacySnapshot();
}

/** 读配置；没存过返回 null */
export function kvGet(key: string): string | null {
  if (!loaded) return ls()?.getItem(key) ?? null;
  const v = data[key];
  return v === undefined ? null : v;
}

export function kvSet(key: string, value: string): void {
  if (data[key] === value) return;
  data[key] = value;
  if (!loaded) {
    // initStore 之前就被调用（正常流程不会，main.ts 已保证顺序）：先落当前 origin
    const s = ls();
    if (s) {
      try {
        s.setItem(key, value);
      } catch {
        /* 忽略 */
      }
    }
    return;
  }
  dirty = true;
  schedule();
}

export function kvDel(key: string): void {
  if (!(key in data)) return;
  delete data[key];
  if (!loaded) {
    try {
      ls()?.removeItem(key);
    } catch {
      /* 忽略 */
    }
    return;
  }
  dirty = true;
  schedule();
}

/* ---------- 布尔/JSON 便捷封装（设置项基本都是这两种） ---------- */

export function kvGetBool(key: string, def: boolean): boolean {
  const v = kvGet(key);
  return v === null ? def : v === "1";
}

export function kvSetBool(key: string, value: boolean): void {
  kvSet(key, value ? "1" : "0");
}

export function kvGetJSON<T>(key: string, def: T): T {
  const raw = kvGet(key);
  if (raw === null) return def;
  try {
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? def : (parsed as T);
  } catch {
    return def;
  }
}

export function kvSetJSON(key: string, value: unknown): void {
  try {
    kvSet(key, JSON.stringify(value));
  } catch (e) {
    console.warn("[LWmark] 配置序列化失败：", e);
  }
}

/* ---------- 落盘 ---------- */

function schedule(): void {
  if (!filePath) {
    // 降级模式：直接写 localStorage（同步，不需要防抖）
    const s = ls();
    if (s) {
      for (const [k, v] of Object.entries(data)) {
        try {
          s.setItem(k, v);
        } catch {
          /* 配额满等异常忽略 */
        }
      }
    }
    dirty = false;
    return;
  }
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = 0;
    void flush();
  }, FLUSH_DELAY);
}

/** 把内存里的整份配置写回磁盘；并发调用只跑一次，写完再看有没有新改动 */
async function flush(): Promise<void> {
  if (!filePath || flushing) return;
  flushing = true;
  try {
    dirty = false;
    await writeFileText(filePath, JSON.stringify(data, null, 2));
  } catch (e) {
    console.warn("[LWmark] 配置写入失败：", e);
  } finally {
    flushing = false;
    if (dirty) schedule();
  }
}

/** 关窗口前尽量把待写内容落盘（异步可能来不及，所以平时就靠 120ms 防抖） */
export function flushStore(): void {
  if (!filePath || !dirty) return;
  if (timer) window.clearTimeout(timer);
  timer = 0;
  void flush();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", flushStore);
}
