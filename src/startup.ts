/**
 * 启动恢复项：重开 LiteMark 时把上次的现场带回来。
 *
 * 每一项都能单独关掉（设置 → 启动），默认全开。这里只负责「选项 + 键名」，
 * 真正的读写与恢复动作在 App.vue 里（它才拿得到 tabs / 目录树实例）。
 */
import { kvGetBool, kvGetJSON, kvSetBool, kvSetJSON } from "./store";

export interface StartupConf {
  /** 重新打开上次的文件夹 */
  folder: boolean;
  /** 恢复上次打开的标签页 */
  tabs: boolean;
  /** 恢复界面状态：侧栏折叠、源码模式 */
  ui: boolean;
  /** 记住设置面板停留的 Tab */
  settingsTab: boolean;
}

/** 设置面板里逐条渲染用的文案 */
export const STARTUP_ITEMS: { id: keyof StartupConf; label: string; note: string }[] = [
  {
    id: "folder",
    label: "上次打开的文件夹",
    note: "启动时自动展开；目录被删或改名就安静跳过",
  },
  {
    id: "tabs",
    label: "上次打开的标签页",
    note: "按上次的顺序重开，未保存的改动不恢复",
  },
  {
    id: "ui",
    label: "界面状态",
    note: "侧栏是否收起、源码 / 所见即所得模式",
  },
  {
    id: "settingsTab",
    label: "设置面板的位置",
    note: "下次打开设置时停在上次那个 Tab",
  },
];

/** 会话现场存哪；folder/tabs 的读者是启动恢复，其余是即时状态 */
export const SESSION = {
  folder: "lm-last-folder",
  tabs: "lm-open-tabs",
  collapsed: "lm-sidebar-collapsed",
  source: "lm-source-mode",
  settingsTab: "lm-settings-tab",
} as const;

/** 标签页现场：只记路径，正文每次现读（免得磁盘上的改动被旧快照盖回去） */
export interface OpenTabs {
  paths: string[];
  /** 活动标签在 paths 里的下标，-1 表示当时停在未命名标签上 */
  active: number;
}

const K: Record<keyof StartupConf, string> = {
  folder: "lm-startup-folder",
  tabs: "lm-startup-tabs",
  ui: "lm-startup-ui",
  settingsTab: "lm-startup-settings-tab",
};

export function loadStartup(): StartupConf {
  return {
    folder: kvGetBool(K.folder, true),
    tabs: kvGetBool(K.tabs, true),
    ui: kvGetBool(K.ui, true),
    settingsTab: kvGetBool(K.settingsTab, true),
  };
}

export function saveStartup(c: StartupConf): void {
  kvSetBool(K.folder, c.folder);
  kvSetBool(K.tabs, c.tabs);
  kvSetBool(K.ui, c.ui);
  kvSetBool(K.settingsTab, c.settingsTab);
}

export function loadOpenTabs(): OpenTabs {
  const v = kvGetJSON<OpenTabs>(SESSION.tabs, { paths: [], active: -1 });
  const paths = Array.isArray(v.paths) ? v.paths.filter((p) => typeof p === "string") : [];
  const active = typeof v.active === "number" ? v.active : -1;
  return { paths, active };
}

export function saveOpenTabs(v: OpenTabs): void {
  kvSetJSON(SESSION.tabs, v);
}
