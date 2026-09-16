import { createApp } from "vue";
import App from "./App.vue";
import { loadNLGlobals, setNL, initNL } from "./bridge";
import { initStore } from "./store";
import "./style.css";

async function boot() {
  try {
    const ok = await loadNLGlobals();
    setNL(ok || inNLDefault());
    await initNL();
  } catch {
    /* 浏览器预览环境忽略 */
  }
  // 必须在挂载前读完配置：各配置模块（pandoc / picgo / 快捷键 / 主题）都是同步读的
  try {
    await initStore();
  } catch (e) {
    console.warn("[LiteMark] 配置初始化失败，本次会话用默认值：", e);
  }
  createApp(App).mount("#app");
}

function inNLDefault() {
  return "NL_PORT" in window;
}

boot();
