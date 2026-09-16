import { createApp } from "vue";
import App from "./App.vue";
import { loadNLGlobals, setNL, initNL, inNL } from "./bridge";
import { initStore } from "./store";
import { restoreWindow } from "./windowState";
import "./style.css";

let mounted = false;

/**
 * 挂载界面。做了两件防白屏的事：
 *   1. 幂等 —— 兜底的 catch 里再调一次也不会重复挂载
 *   2. 挂载本身抛错时在页面上写一行原因，而不是留一片白让人猜
 */
function mount(): void {
  if (mounted) return;
  mounted = true;
  try {
    createApp(App).mount("#app");
  } catch (e) {
    console.error("[LiteMark] 界面挂载失败：", e);
    const el = document.getElementById("app");
    if (el) {
      el.innerHTML =
        '<div style="font:13px/1.7 system-ui;padding:32px;color:#333">' +
        "<b>LiteMark 启动失败</b><br>界面没能挂载，详情见开发者控制台。<br>" +
        '<code style="font-size:12px;opacity:.7">' +
        String(e).replace(/[<>&]/g, "") +
        "</code></div>";
    }
  }
}

/**
 * 给每个启动步骤套一个硬超时。
 *
 * 启动链上全是本机 IPC，正常几毫秒就回；但只要有一个**永远不返回**，
 * `await` 就会一直等下去，`mount()` 永远轮不到 —— 那就是白屏的成因。
 * 所以这里宁可用默认值继续，也不允许任何一步挡住界面。
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: T | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      resolve(v);
    };
    const timer = window.setTimeout(() => finish(null), ms);
    p.then((v) => finish(v), () => finish(null));
  });
}

async function boot() {
  // 1. Neutralino 运行时（浏览器预览下会静默降级）
  try {
    const ok = await withTimeout(loadNLGlobals(), 3000);
    setNL(!!ok || "NL_PORT" in window);
    await withTimeout(initNL(), 3000);
  } catch (e) {
    console.warn("[LiteMark] Neutralino 初始化失败：", e);
  }

  // 2. 配置：各配置模块（pandoc / picgo / 快捷键 / 主题）都是同步读的，必须在挂载前读完
  try {
    await withTimeout(initStore(), 3000);
  } catch (e) {
    console.warn("[LiteMark] 配置初始化失败，本次会话用默认值：", e);
  }

  // 3. 把窗口调回上次的尺寸和位置（放在挂载前，避免用户先看到默认尺寸再跳一下）
  if (inNL) {
    try {
      await withTimeout(restoreWindow(), 1000);
    } catch (e) {
      console.warn("[LiteMark] 窗口尺寸恢复失败：", e);
    }
  }

  mount();
}

boot().catch((e) => {
  console.error("[LiteMark] 启动异常：", e);
  mount();
});
