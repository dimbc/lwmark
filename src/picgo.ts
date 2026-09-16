/**
 * PicGo 图床配置（落盘持久化，见 store.ts）。
 *
 * 触发时机做成可配：一个总开关 + 「粘贴图片时上传」「插入本地图片时上传」两个独立开关，
 * 三种模式（粘贴与本地都自动 / 只粘贴自动 / 纯手动）都能配出来。
 * 手动上传始终可用——鼠标悬停图片时那条链接框右侧就有上传按钮。
 *
 * 每次读取都直查 store，所以在设置面板改完立刻生效，不需要往下传 props。
 */
import { kvGet, kvGetBool, kvSet, kvSetBool } from "./store";

export interface PicgoConf {
  /** 总开关 */
  on: boolean;
  /** PicGo HTTP 服务地址（PicGo → 设置 → 设置 Server） */
  server: string;
  /** 粘贴剪贴板图片时自动上传 */
  onPaste: boolean;
  /** 插入本地图片时自动上传 */
  onLocal: boolean;
}

export const DEFAULT_SERVER = "http://127.0.0.1:36677";

const K = {
  on: "lm-picgo-on",
  server: "lm-picgo-server",
  paste: "lm-picgo-paste",
  local: "lm-picgo-local",
};

function flag(key: string, def: boolean): boolean {
  return kvGetBool(key, def);
}

/**
 * 总开关默认**关**：没装/没开 PicGo 时如果默认开启，每次粘贴都要先等一次连接失败，
 * 白白拖慢输入。默认关，用户装好后到设置里打开即可。
 */
export function loadPicgo(): PicgoConf {
  return {
    on: flag(K.on, false),
    server: kvGet(K.server) || DEFAULT_SERVER,
    onPaste: flag(K.paste, true),
    onLocal: flag(K.local, false),
  };
}

export function savePicgo(c: PicgoConf): void {
  kvSetBool(K.on, c.on);
  kvSet(K.server, c.server.trim() || DEFAULT_SERVER);
  kvSetBool(K.paste, c.onPaste);
  kvSetBool(K.local, c.onLocal);
}

/** 这个场景要不要自动上传 */
export function autoUpload(kind: "paste" | "local"): boolean {
  if (typeof window === "undefined") return false;
  const c = loadPicgo();
  return c.on && (kind === "paste" ? c.onPaste : c.onLocal);
}
