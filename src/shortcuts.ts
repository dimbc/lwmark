/* 快捷键：命令定义、按键解析、绑定持久化 */

import { kvGet, kvSet } from "./store";

export interface Binding {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

export interface ShortcutDef {
  id: string;
  label: string;
  /** app = 程序命令；editor = 交给 Milkdown 的格式化命令 */
  group: "app" | "editor";
  def: Binding;
  /** group 为 editor 时，对应 EditorPane 的命令名 */
  editor?: string;
}

const b = (ctrl: boolean, shift: boolean, alt: boolean, key: string): Binding => ({
  ctrl,
  shift,
  alt,
  key,
});

/** 可改绑的命令表；新增命令只需在此登记 + 在 App 的 runAction / EditorPane 里实现 */
export const SHORTCUTS: ShortcutDef[] = [
  /* ---- 应用 ---- */
  { id: "save", label: "保存文档", group: "app", def: b(true, false, false, "s") },
  { id: "open", label: "打开文件", group: "app", def: b(true, false, false, "o") },
  { id: "openFolder", label: "打开文件夹", group: "app", def: b(true, true, false, "o") },
  { id: "newFile", label: "新建文件", group: "app", def: b(true, false, false, "n") },
  { id: "closeTab", label: "关闭当前标签", group: "app", def: b(true, false, false, "w") },
  { id: "nextTab", label: "下一个标签", group: "app", def: b(true, false, false, "tab") },
  { id: "prevTab", label: "上一个标签", group: "app", def: b(true, true, false, "tab") },
  { id: "toggleSidebar", label: "收起 / 展开侧栏", group: "app", def: b(true, false, false, "\\") },
  { id: "toggleMode", label: "源码 / 所见即所得切换", group: "app", def: b(true, false, false, "/") },
  { id: "settings", label: "打开设置", group: "app", def: b(true, false, false, ",") },
  { id: "insertImage", label: "插入本地图片", group: "app", def: b(true, false, true, "i") },
  { id: "insertImageUrl", label: "插入网络图片", group: "app", def: b(true, true, true, "i") },

  /* ---- 编辑器（默认键与 Milkdown 内置 keymap 一致，Mod = Ctrl） ---- */
  { id: "bold", label: "加粗", group: "editor", def: b(true, false, false, "b"), editor: "bold" },
  { id: "italic", label: "斜体", group: "editor", def: b(true, false, false, "i"), editor: "italic" },
  { id: "inlineCode", label: "行内代码", group: "editor", def: b(true, false, false, "e"), editor: "inlineCode" },
  { id: "strike", label: "删除线", group: "editor", def: b(true, false, true, "x"), editor: "strike" },
  { id: "blockquote", label: "引用块", group: "editor", def: b(true, true, false, "b"), editor: "blockquote" },
  { id: "bulletList", label: "无序列表", group: "editor", def: b(true, false, true, "8"), editor: "bulletList" },
  { id: "orderedList", label: "有序列表", group: "editor", def: b(true, false, true, "7"), editor: "orderedList" },
  { id: "codeBlock", label: "代码块", group: "editor", def: b(true, false, true, "c"), editor: "codeBlock" },
  { id: "h1", label: "标题 1", group: "editor", def: b(true, false, true, "1"), editor: "h1" },
  { id: "h2", label: "标题 2", group: "editor", def: b(true, false, true, "2"), editor: "h2" },
  { id: "h3", label: "标题 3", group: "editor", def: b(true, false, true, "3"), editor: "h3" },
  { id: "h4", label: "标题 4", group: "editor", def: b(true, false, true, "4"), editor: "h4" },
  { id: "h5", label: "标题 5", group: "editor", def: b(true, false, true, "5"), editor: "h5" },
  { id: "h6", label: "标题 6", group: "editor", def: b(true, false, true, "6"), editor: "h6" },
  { id: "paragraph", label: "正文段落", group: "editor", def: b(true, false, true, "0"), editor: "paragraph" },
  { id: "indent", label: "列表缩进", group: "editor", def: b(true, false, false, "]"), editor: "indent" },
  { id: "outdent", label: "列表提升", group: "editor", def: b(true, false, false, "["), editor: "outdent" },
  { id: "undo", label: "撤销", group: "editor", def: b(true, false, false, "z"), editor: "undo" },
  { id: "redo", label: "重做", group: "editor", def: b(true, false, false, "y"), editor: "redo" },
];

export const GROUPS: { key: ShortcutDef["group"]; title: string }[] = [
  { key: "app", title: "应用" },
  { key: "editor", title: "编辑器" },
];


const STORE_KEY = "lm-keys";
const MODIFIERS = ["control", "shift", "alt", "meta"];

function keyLabel(key: string): string {
  if (key === "tab") return "Tab";
  if (key === "escape") return "Esc";
  if (key === " ") return "Space";
  if (key === "\\") return "\\";
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function sameBinding(a: Binding, b: Binding): boolean {
  return a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt && a.key === b.key;
}

/** 展示用："Ctrl + Shift + Tab" */
export function formatBinding(b: Binding): string {
  const parts: string[] = [];
  if (b.ctrl) parts.push("Ctrl");
  if (b.shift) parts.push("Shift");
  if (b.alt) parts.push("Alt");
  parts.push(keyLabel(b.key));
  return parts.join(" + ");
}

/** 存储用："Ctrl+Shift+tab" */
export function serializeBinding(b: Binding): string {
  const parts: string[] = [];
  if (b.ctrl) parts.push("Ctrl");
  if (b.shift) parts.push("Shift");
  if (b.alt) parts.push("Alt");
  parts.push(b.key);
  return parts.join("+");
}

export function parseBinding(raw: string): Binding | null {
  const parts = raw.split("+").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const key = parts.pop()!.toLowerCase();
  if (!key) return null;
  let ctrl = false;
  let shift = false;
  let alt = false;
  for (const p of parts) {
    const l = p.toLowerCase();
    if (l === "ctrl" || l === "control") ctrl = true;
    else if (l === "shift") shift = true;
    else if (l === "alt") alt = true;
  }
  return { ctrl, shift, alt, key: key === "esc" ? "escape" : key };
}

export function matchEvent(e: KeyboardEvent, b: Binding): boolean {
  return (
    !e.metaKey &&
    e.ctrlKey === b.ctrl &&
    e.shiftKey === b.shift &&
    e.altKey === b.alt &&
    e.key.toLowerCase() === b.key
  );
}

/** 从键盘事件取绑定；纯修饰键或没有修饰键都返回 null（不允许吞掉普通输入） */
export function bindingFromEvent(e: KeyboardEvent): Binding | null {
  const key = e.key.toLowerCase();
  if (MODIFIERS.includes(key)) return null;
  if (!e.ctrlKey && !e.altKey && !e.metaKey) return null;
  return {
    ctrl: e.ctrlKey,
    shift: e.shiftKey,
    alt: e.altKey,
    key: key === "esc" ? "escape" : key,
  };
}

export function defaultBindings(): Record<string, Binding> {
  const out: Record<string, Binding> = {};
  for (const s of SHORTCUTS) out[s.id] = { ...s.def };
  return out;
}

export function loadBindings(): Record<string, Binding> {
  const out = defaultBindings();
  try {
    const raw = JSON.parse(kvGet(STORE_KEY) || "{}");
    for (const s of SHORTCUTS) {
      const v = raw[s.id];
      if (typeof v === "string") {
        const parsed = parseBinding(v);
        if (parsed) out[s.id] = parsed;
      }
    }
  } catch {
    /* 数据损坏时回落到默认值 */
  }
  return out;
}

export function saveBindings(map: Record<string, Binding>): void {
  const raw: Record<string, string> = {};
  for (const s of SHORTCUTS) {
    if (map[s.id]) raw[s.id] = serializeBinding(map[s.id]);
  }
  kvSet(STORE_KEY, JSON.stringify(raw));
}
