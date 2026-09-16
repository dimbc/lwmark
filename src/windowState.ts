/**
 * 窗口几何记忆 + 最大化状态。
 *
 * 为什么不用 Neutralino 自带的 `modes.window.useSavedState`：那个开关把状态写到
 * `dataLocation` 指向的目录（默认是 exe 所在目录）。装在 Program Files 时没有写权限，
 * 它会静默失败；而且它的恢复路径是直接 SetWindowPlacement，不做屏幕边界检查。
 * 这里复用项目已有的 settings.json（%APPDATA%\LiteMark），并把跑到屏幕外的窗口拉回来。
 *
 * 采样来源有两个，缺一不可：
 *   - 尺寸：WebView 内容跟着窗口 resize，DOM 的 resize 事件够用
 *   - 位置：拖标题栏走的是 Neutralino 的原生 beginDrag，JS 侧收不到事件，
 *     只能隔一会儿读一次 getPosition
 */
import { ref } from "vue";
import { inNL, winCtl, WIN_MIN, type WinRect } from "./bridge";
import { kvGetBool, kvGetJSON, kvSetBool, kvSetJSON } from "./store";
import { loadStartup } from "./startup";

const K = {
  geo: "lm-win-geo",
  max: "lm-win-maximized",
} as const;

/** 位置轮询周期。两个本地 IPC 调用，代价可以忽略 */
const POLL_MS = 2500;
/** 恢复时至少要留在屏幕内的标题栏宽度 / 高度，否则窗口就抓不回来了 */
const KEEP_X = 200;
const KEEP_Y = 80;

/** 窗口当前是否最大化，标题栏按钮跟着它走 */
export const maximized = ref(false);
/** 正在拖边缩放：这期间别采样，否则会把中间尺寸记进配置 */
export const resizing = ref(false);

let last: WinRect | null = null;
let pollTimer = 0;
let resizeTimer = 0;
let started = false;
let sampling = false;
let restored = false;

/* ---------- 恢复 ---------- */

/** 所有显示器里最大的那个分辨率，用来判断窗口是不是跑到屏幕外了 */
async function screenBox(): Promise<{ width: number; height: number } | null> {
  try {
    const list = await winCtl.displays();
    let width = 0;
    let height = 0;
    for (const d of list || []) {
      width = Math.max(width, d?.resolution?.width ?? 0);
      height = Math.max(height, d?.resolution?.height ?? 0);
    }
    return width && height ? { width, height } : null;
  } catch {
    return null;
  }
}

/**
 * 把记录下来的矩形夹回可用范围。
 * 副屏的位置信息（显示器坐标）Neutralino 不给，所以边界放得比较宽松：
 * 允许窗口在「主屏右侧一屏」「主屏下方一屏」这类位置存在，只挡真正抓不到的极端值。
 */
function clampToScreen(g: WinRect, box: { width: number; height: number } | null): WinRect {
  const out: WinRect = {
    x: Math.round(g.x),
    y: Math.round(g.y),
    width: Math.max(WIN_MIN.width, Math.round(g.width)),
    height: Math.max(WIN_MIN.height, Math.round(g.height)),
  };
  if (!box) return out;
  out.width = Math.min(out.width, Math.max(WIN_MIN.width, box.width));
  out.height = Math.min(out.height, Math.max(WIN_MIN.height, box.height));
  out.x = Math.min(Math.max(out.x, -out.width + KEEP_X), box.width * 2 - KEEP_X);
  out.y = Math.min(Math.max(out.y, 0), box.height * 2 - KEEP_Y);
  return out;
}

/**
 * 启动时调用一次（越早越好，晚了用户会看到窗口先按默认尺寸出现再跳一下）。
 * 没记过、或用户关掉了「记住窗口大小与位置」，就保持 config 里的默认值。
 */
export async function restoreWindow(): Promise<void> {
  if (!inNL || restored) return;
  restored = true;
  if (!loadStartup().window) return;

  const saved = kvGetJSON<WinRect | null>(K.geo, null);
  const wasMax = kvGetBool(K.max, false);

  if (saved && typeof saved.width === "number" && typeof saved.height === "number") {
    const fixed = clampToScreen(saved, await screenBox());
    try {
      await winCtl.setRect(fixed);
      last = fixed;
    } catch (e) {
      console.warn("[LiteMark] 恢复窗口尺寸失败：", e);
    }
  }

  if (wasMax) {
    try {
      await winCtl.maximize();
      maximized.value = true;
    } catch (e) {
      console.warn("[LiteMark] 恢复最大化状态失败：", e);
    }
  }
}

/* ---------- 采样 ---------- */

async function sample(): Promise<void> {
  if (!inNL || sampling || resizing.value) return;
  if (!loadStartup().window) return;
  sampling = true;
  try {
    const max = await winCtl.isMaximized();
    if (max !== maximized.value) {
      maximized.value = max;
      kvSetBool(K.max, max);
    }
    // 最大化时读到的是占满屏幕的尺寸，记下来下次还原就会变形，所以跳过
    if (max) return;

    const r = await winCtl.rect();
    if (r.width < WIN_MIN.width || r.height < WIN_MIN.height) return;
    if (
      last &&
      last.x === r.x &&
      last.y === r.y &&
      last.width === r.width &&
      last.height === r.height
    ) {
      return;
    }
    last = r;
    kvSetJSON(K.geo, r);
  } catch {
    // 窗口正在关闭时会读失败，忽略
  } finally {
    sampling = false;
  }
}

function onResize(): void {
  if (resizeTimer) window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    resizeTimer = 0;
    void sample();
  }, 300);
}

/** 拖边结束后立刻记一笔，不用等 resize 的防抖；延后一拍是为了躲开还在飞的最后一个 setSize */
export function syncWindowGeo(): void {
  window.setTimeout(() => void sample(), 250);
}

/**
 * 开始跟踪窗口变化（挂载后调用）。DOM 的 resize 管尺寸，定时器管位置。
 */
export function trackWindow(): void {
  if (!inNL || started) return;
  started = true;
  window.addEventListener("resize", onResize);
  pollTimer = window.setInterval(() => {
    if (document.hidden) return;
    void sample();
  }, POLL_MS);
}

export function stopWindowTracking(): void {
  if (!started) return;
  started = false;
  window.removeEventListener("resize", onResize);
  if (pollTimer) window.clearInterval(pollTimer);
  if (resizeTimer) window.clearTimeout(resizeTimer);
  pollTimer = 0;
  resizeTimer = 0;
}

/* ---------- 最大化 ---------- */

/** 标题栏那个按钮走这里，顺便让状态与真实窗口保持一致 */
export async function toggleWindowMax(): Promise<void> {
  if (!inNL) return;
  try {
    if (maximized.value) {
      await winCtl.unmaximize();
      maximized.value = false;
      kvSetBool(K.max, false);
      // 还原后尺寸和位置都变了，等窗口稳定再采样
      window.setTimeout(() => void sample(), 250);
    } else {
      await winCtl.maximize();
      maximized.value = true;
      kvSetBool(K.max, true);
    }
  } catch (e) {
    console.warn("[LiteMark] 切换最大化失败：", e);
  }
}
