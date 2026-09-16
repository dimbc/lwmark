<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from "vue";
import {
  readDir,
  joinPath,
  movePath,
  trashPath,
  fileExists,
  type DirEntry,
} from "../bridge";
import { ICON_PATHS } from "../icons";

/** 右键菜单需要的节点信息。根节点 = 「打开的那个文件夹」本身，也走这条通道 */
export interface TreeNode {
  path: string;
  entry: string;
  type: "FILE" | "DIRECTORY";
  /** 是不是「打开的那个文件夹」本身 */
  isRoot: boolean;
}

const props = defineProps<{
  root: string | null;
  collapsed?: boolean;
  width?: number;
  /** Pandoc 开着才显示导出按钮 */
  exportOn?: boolean;
  /** 导出按钮点开的格式列表（设置里勾了哪些就列哪些） */
  exportFormats?: { id: string; label: string }[];
  /** 当前默认格式，列表里打勾 */
  exportActive?: string;
  /** 侧栏页签：文件树 / 大纲；不传 = 永远显示文件树 */
  tab?: "files" | "outline";
}>();
const emit = defineEmits<{
  openFile: [path: string];
  actOpen: [];
  actFolder: [];
  actSave: [];
  actExport: [fmtId: string];
  ctx: [payload: { e: MouseEvent; node: TreeNode | null }];
  toggleCollapse: [];
  resize: [width: number];
  logo: [];
  /** 切换「文件 / 大纲」页签 */
  tab: [t: "files" | "outline"];
  /** 重命名成功：旧路径 → 新路径（App 用来同步标签页） */
  renamed: [oldPath: string, newPath: string];
  /** 已删到回收站 */
  removed: [path: string];
  notify: [p: { msg: string; bad?: boolean }];
}>();

/* ---------- 导出格式列表：贴着按钮弹出 ---------- *
 * Teleport 到 body + fixed 定位，避免被侧栏的 overflow 裁掉。 */
const fmtOpen = ref(false);
const fmtPos = ref({ x: 0, y: 0 });
const fmtEl = ref<HTMLElement | null>(null);
const fmtBtn = ref<HTMLElement | null>(null);

function closeFormats() {
  fmtOpen.value = false;
}

async function toggleFormats(e: MouseEvent) {
  if (fmtOpen.value) {
    closeFormats();
    return;
  }
  const bb = (e.currentTarget as HTMLElement).getBoundingClientRect();
  fmtPos.value = { x: bb.left, y: bb.bottom + 6 };
  fmtOpen.value = true;
  await nextTick();
  const r = fmtEl.value?.getBoundingClientRect();
  if (!r) return;
  // 贴按钮左缘向下展开；右边 / 下边放不下就收回视口内
  const x = Math.max(8, Math.min(bb.left, window.innerWidth - r.width - 8));
  let y = bb.bottom + 6;
  if (y + r.height + 8 > window.innerHeight) y = Math.max(8, bb.top - r.height - 6);
  fmtPos.value = { x, y };
}

function pickFormat(id: string) {
  closeFormats();
  emit("actExport", id);
}

function onDocDown(e: MouseEvent) {
  const t = e.target as Node;
  if (fmtEl.value?.contains(t) || fmtBtn.value?.contains(t)) return;
  closeFormats();
}

function onPickKey(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  e.preventDefault();
  closeFormats();
}

watch(fmtOpen, (open) => {
  if (open) {
    document.addEventListener("mousedown", onDocDown, true);
    window.addEventListener("keydown", onPickKey, true);
  } else {
    document.removeEventListener("mousedown", onDocDown, true);
    window.removeEventListener("keydown", onPickKey, true);
  }
});

// 侧栏收起时按钮本身会消失，列表不能留在屏幕上
watch(() => props.collapsed, closeFormats);
onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocDown, true);
  window.removeEventListener("keydown", onPickKey, true);
});

/* ---------- 边缘拖动 / 点击切换 ---------- */
const dragging = ref(false);
let startX = 0;
let moved = false;

function onHandleDown(e: MouseEvent) {
  e.preventDefault();
  startX = e.clientX;
  moved = false;
  dragging.value = true;
  window.addEventListener("mousemove", onHandleMove);
  window.addEventListener("mouseup", onHandleUp);
}

function onHandleMove(e: MouseEvent) {
  if (Math.abs(e.clientX - startX) < 3) return;
  moved = true;
  if (props.collapsed) return;
  emit("resize", Math.min(460, Math.max(170, e.clientX)));
}

function onHandleUp() {
  dragging.value = false;
  window.removeEventListener("mousemove", onHandleMove);
  window.removeEventListener("mouseup", onHandleUp);
  if (!moved) emit("toggleCollapse");
}

onBeforeUnmount(() => {
  window.removeEventListener("mousemove", onHandleMove);
  window.removeEventListener("mouseup", onHandleUp);
});

/* ---------- 路径小工具 ---------- */
const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? "";
const dirName = (p: string) => {
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  return i > 0 ? p.slice(0, i) : p;
};
/** 忽略大小写与结尾分隔符的比较（Windows 盘符 / 文件名都不敏感） */
const samePath = (a: string, b: string) =>
  a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();

/* ---------- 树 ---------- */
interface Node extends DirEntry {
  path: string;
  loaded: boolean;
  children: Node[];
}

const tree = ref<Node[]>([]);
const expanded = ref(new Set<string>());
/** 根节点（打开的那个文件夹）默认展开 */
const rootOpen = ref(true);

const MD_EXT = /\.(md|markdown|txt)$/i;

async function loadDir(dir: string): Promise<Node[]> {
  const list = await readDir(dir);
  const nodes: Node[] = list
    .filter((d) => d.type === "DIRECTORY" || MD_EXT.test(d.entry))
    .map((d) => ({
      ...d,
      path: joinPath(dir, d.entry),
      loaded: false,
      children: [],
    }));
  nodes.sort((a, b) =>
    a.type !== b.type
      ? a.type === "DIRECTORY" ? -1 : 1
      : a.entry.localeCompare(b.entry, "zh-CN"),
  );
  return nodes;
}

async function setRoot(root: string | null) {
  expanded.value = new Set();
  rootOpen.value = true;
  renaming.value = null;
  pendingRemove.value = null;
  tree.value = root ? await loadDir(root) : [];
}

async function refresh() {
  await setRoot(props.root);
}

async function toggle(node: Node) {
  if (node.type !== "DIRECTORY") return;
  if (expanded.value.has(node.path)) {
    expanded.value.delete(node.path);
  } else {
    if (!node.loaded) {
      node.children = await loadDir(node.path);
      node.loaded = true;
    }
    expanded.value.add(node.path);
  }
  expanded.value = new Set(expanded.value);
}

function findNode(path: string): Node | null {
  const stack = [...tree.value];
  while (stack.length) {
    const n = stack.pop()!;
    if (samePath(n.path, path)) return n;
    if (n.children.length) stack.push(...n.children);
  }
  return null;
}

/** 重新加载某个目录（重命名 / 删除之后刷新它所在的那一层） */
async function reloadDir(dir: string) {
  if (props.root && samePath(dir, props.root)) {
    tree.value = await loadDir(props.root);
    return;
  }
  const node = findNode(dir);
  if (node && node.type === "DIRECTORY") {
    node.children = await loadDir(node.path);
    node.loaded = true;
  }
}

/* ---------- 扁平行：递归展开，层级不限 ---------- *
 * 之前是模板里硬编码三层，第四层目录点开也不会出内容；改成先拍平成数组再渲染，
 * 缩进按 depth 算，多深都能展开。 */
interface Row {
  node: Node;
  depth: number;
  isRoot: boolean;
}

const rows = computed<Row[]>(() => {
  const root = props.root;
  if (!root) return [];
  const out: Row[] = [
    {
      node: {
        entry: baseName(root) || root,
        type: "DIRECTORY",
        path: root,
        loaded: true,
        children: [],
      },
      depth: 0,
      isRoot: true,
    },
  ];
  if (!rootOpen.value) return out;
  const walk = (list: Node[], depth: number) => {
    for (const n of list) {
      out.push({ node: n, depth, isRoot: false });
      if (n.type === "DIRECTORY" && expanded.value.has(n.path)) walk(n.children, depth + 1);
    }
  };
  walk(tree.value, 1);
  return out;
});

const isOpen = (row: Row) => (row.isRoot ? rootOpen.value : expanded.value.has(row.node.path));

async function onRowClick(row: Row) {
  if (renaming.value) return; // 正在改名，别被点击打断
  if (row.isRoot) {
    rootOpen.value = !rootOpen.value;
    return;
  }
  if (row.node.type === "DIRECTORY") await toggle(row.node);
  else emit("openFile", row.node.path);
}

function onRowCtx(e: MouseEvent, row: Row) {
  emit("ctx", {
    e,
    node: {
      path: row.node.path,
      entry: row.node.entry,
      type: row.node.type,
      isRoot: row.isRoot,
    },
  });
}

/* ---------- 重命名：原地变输入框 ---------- */
const renaming = ref<string | null>(null);
const renameText = ref("");

async function startRename(path: string) {
  const node = findNode(path);
  const isRoot = !!props.root && samePath(path, props.root);
  if (!node && !isRoot) return;
  renaming.value = path;
  renameText.value = node ? node.entry : baseName(path);
  await nextTick();
  // ⚠️ 不能用模板 ref：`ref` 写在 v-for 里，Vue 会把它收集成数组，
  // 拿到的不是元素。同一时刻只会有一个 .rename-input，直接查 DOM 最省事。
  const el = document.querySelector<HTMLInputElement>(".tree-scroll .rename-input");
  if (!el) return;
  el.focus();
  // 只选中主文件名，扩展名留着不动（和资源管理器一致）
  const dot = renameText.value.lastIndexOf(".");
  el.setSelectionRange(0, dot > 0 ? dot : renameText.value.length);
}

function cancelRename() {
  renaming.value = null;
}

/** 提交：回车 / 失焦都走这里；Esc 已把 renaming 清空，会在这里早退 */
async function commitRename() {
  const from = renaming.value;
  if (!from) return;
  const name = renameText.value.trim();
  renaming.value = null;
  if (!name || name === baseName(from)) return;
  if (/[\\/:*?"<>|]/.test(name)) {
    emit("notify", { msg: '名称不能包含 \\ / : * ? " < > |', bad: true });
    return;
  }
  const to = joinPath(dirName(from), name);
  // 只是改大小写时 to 与 from 是同一个文件，不能当成「重名」拦下
  if (!samePath(from, to) && (await fileExists(to))) {
    emit("notify", { msg: `这个位置已经有「${name}」了`, bad: true });
    return;
  }
  try {
    await movePath(from, to);
  } catch (err) {
    emit("notify", { msg: `重命名失败：${String(err)}`, bad: true });
    return;
  }
  // 目录改名后它下面所有路径都变了，展开状态与已加载的子节点全部作废
  if (props.root && samePath(from, props.root)) expanded.value = new Set();
  else expanded.value.delete(from);
  emit("renamed", from, to);
  emit("notify", { msg: `已重命名为 ${name}` });
  await reloadDir(dirName(from));
}

/* ---------- 删除：先确认，再进回收站 ---------- */
const pendingRemove = ref<{
  path: string;
  name: string;
  type: "FILE" | "DIRECTORY";
  isRoot: boolean;
} | null>(null);

function askRemove(path: string) {
  const node = findNode(path);
  const isRoot = !!props.root && samePath(path, props.root);
  if (!node && !isRoot) return;
  pendingRemove.value = {
    path,
    name: node ? node.entry : baseName(path),
    type: node ? node.type : "DIRECTORY",
    isRoot,
  };
}

async function confirmRemove() {
  const t = pendingRemove.value;
  if (!t) return;
  pendingRemove.value = null;
  try {
    await trashPath(t.path);
  } catch (err) {
    emit("notify", { msg: `删除失败：${String(err)}`, bad: true });
    return;
  }
  emit("removed", t.path);
  emit("notify", { msg: `已移到回收站：${t.name}` });
  if (!t.isRoot) {
    expanded.value.delete(t.path);
    await reloadDir(dirName(t.path));
  }
}

defineExpose({ setRoot, refresh, startRename, askRemove });
</script>

<template>
  <!-- 收起态：窄条活动栏 -->
  <aside
    v-if="collapsed"
    class="rail"
    :class="{ dragging }"
    @contextmenu.prevent="emit('ctx', { e: $event, node: null })"
  >
    <button class="rail-logo" title="LWmark · 设置" @click="emit('logo')">
      <span class="logo-dot" />
    </button>
    <button class="ta-btn" title="打开文件 (Ctrl+O)" @click="emit('actOpen')">
      <svg viewBox="0 0 16 16" width="15" height="15"><path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h3l1.5 2h4.5A1.5 1.5 0 0 1 14 5.5v7A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5v-9z" stroke="currentColor" stroke-width="1.2" fill="none" /></svg>
    </button>
    <button class="ta-btn" title="打开文件夹" @click="emit('actFolder')">
      <svg viewBox="0 0 16 16" width="15" height="15"><path d="M1.5 4a1 1 0 0 1 1-1H6l1.5 1.5h6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4z" stroke="currentColor" stroke-width="1.2" fill="none" /></svg>
    </button>
    <button class="ta-btn" title="保存 (Ctrl+S)" @click="emit('actSave')">
      <svg viewBox="0 0 16 16" width="15" height="15"><path d="M3 2h8l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.2" fill="none" /><path d="M5 2v4h5V2M5 14v-5h6v5" stroke="currentColor" stroke-width="1.2" fill="none" /></svg>
    </button>
    <button
      v-if="exportOn"
      ref="fmtBtn"
      class="ta-btn"
      :class="{ on: fmtOpen }"
      title="导出为…"
      @click="toggleFormats"
    >
      <svg viewBox="0 0 16 16" width="15" height="15"><path :d="ICON_PATHS.exportDoc" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>

    <div class="splitter" :class="{ active: dragging }" @mousedown="onHandleDown">
      <span class="splitter-bar" />
    </div>
  </aside>

  <!-- 展开态 -->
  <aside
    v-else
    class="file-tree"
    :class="{ dragging }"
    :style="{ width: (width ?? 220) + 'px' }"
    @contextmenu.prevent="emit('ctx', { e: $event, node: null })"
  >
    <!-- 文件 / 大纲 页签（收起态窄条不显示） -->
    <div class="side-tabs">
      <button class="side-tab" :class="{ on: tab !== 'outline' }" @click="emit('tab', 'files')">文件</button>
      <button class="side-tab" :class="{ on: tab === 'outline' }" @click="emit('tab', 'outline')">大纲</button>
    </div>

    <template v-if="tab === 'outline'">
      <!-- 大纲面板由 App 通过插槽塞进来 -->
      <slot name="outline" />
    </template>

    <template v-else>
    <div class="tree-actions">
      <button class="ta-btn" title="打开文件 (Ctrl+O)" @click="emit('actOpen')">
        <svg viewBox="0 0 16 16" width="15" height="15"><path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h3l1.5 2h4.5A1.5 1.5 0 0 1 14 5.5v7A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5v-9z" stroke="currentColor" stroke-width="1.2" fill="none" /></svg>
      </button>
      <button class="ta-btn" title="打开文件夹" @click="emit('actFolder')">
        <svg viewBox="0 0 16 16" width="15" height="15"><path d="M1.5 4a1 1 0 0 1 1-1H6l1.5 1.5h6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4z" stroke="currentColor" stroke-width="1.2" fill="none" /></svg>
      </button>
      <button class="ta-btn" title="保存 (Ctrl+S)" @click="emit('actSave')">
        <svg viewBox="0 0 16 16" width="15" height="15"><path d="M3 2h8l3 3v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.2" fill="none" /><path d="M5 2v4h5V2M5 14v-5h6v5" stroke="currentColor" stroke-width="1.2" fill="none" /></svg>
      </button>
      <button
        v-if="exportOn"
        ref="fmtBtn"
        class="ta-btn"
        :class="{ on: fmtOpen }"
        title="导出为…"
        @click="toggleFormats"
      >
        <svg viewBox="0 0 16 16" width="15" height="15"><path :d="ICON_PATHS.exportDoc" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <button v-if="root" class="ta-btn" title="刷新目录" @click="refresh">
        <svg viewBox="0 0 16 16" width="15" height="15"><path d="M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3" stroke="currentColor" stroke-width="1.2" fill="none" /></svg>
      </button>
      <span class="ta-root" :title="root ?? ''">{{ root ? baseName(root) : "资源管理器" }}</span>
    </div>

    <div v-if="!root" class="tree-empty">
      <p>未打开文件夹</p>
      <button class="empty-btn" @click="emit('actFolder')">打开文件夹</button>
    </div>

    <div v-else class="tree-scroll">
      <div
        v-for="row in rows"
        :key="row.node.path"
        class="tree-item"
        :class="{ root: row.isRoot, renaming: renaming === row.node.path }"
        :style="{ paddingLeft: 10 + row.depth * 15 + 'px' }"
        @click="onRowClick(row)"
        @contextmenu.prevent.stop="onRowCtx($event, row)"
      >
        <span class="chevron" :class="{ open: isOpen(row) }">
          <svg v-if="row.node.type === 'DIRECTORY'" viewBox="0 0 10 10" width="9" height="9"><path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.2" fill="none" /></svg>
        </span>
        <input
          v-if="renaming === row.node.path"
          v-model="renameText"
          class="rename-input"
          spellcheck="false"
          @click.stop
          @mousedown.stop
          @dblclick.stop
          @contextmenu.prevent.stop
          @keydown.enter.prevent="commitRename"
          @keydown.esc.prevent="cancelRename"
          @blur="commitRename"
        />
        <span v-else class="tree-label">{{ row.node.entry }}</span>
      </div>
    </div>
    </template>

    <div class="splitter" :class="{ active: dragging }" @mousedown="onHandleDown">
      <span class="splitter-bar" />
    </div>
  </aside>

  <!-- 删除确认：自绘小卡片，和设置面板同一套观感 -->
  <Teleport to="body">
    <div v-if="pendingRemove" class="rm-mask" @mousedown.self="pendingRemove = null">
      <div class="rm-card">
        <div class="rm-title">
          删除{{ pendingRemove.type === "DIRECTORY" ? "文件夹" : "文件" }}
        </div>
        <div class="rm-body">
          把「<b>{{ pendingRemove.name }}</b>」移到回收站？
          <p v-if="pendingRemove.type === 'DIRECTORY'" class="rm-note">
            文件夹里的内容会一起移走，之后可以从回收站还原。
          </p>
        </div>
        <div class="rm-actions">
          <button class="rm-btn" @click="pendingRemove = null">取消</button>
          <button class="rm-btn danger" @click="confirmRemove">移到回收站</button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 导出格式列表：Teleport 到 body，位置贴着触发它的按钮 -->
  <Teleport to="body">
    <div
      v-if="fmtOpen"
      ref="fmtEl"
      class="fmt-pop"
      :style="{ left: fmtPos.x + 'px', top: fmtPos.y + 'px' }"
    >
      <button
        v-for="f in exportFormats"
        :key="f.id"
        class="fmt-item"
        :class="{ on: f.id === exportActive }"
        @click="pickFormat(f.id)"
      >
        <span class="fmt-label">{{ f.label }}</span>
        <svg
          v-if="f.id === exportActive"
          class="fmt-ck"
          viewBox="0 0 16 16"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M3.6 8.4 6.3 11 12.2 4.8" />
        </svg>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
/* 边缘把手：悬停加粗、点击切换、拖动调宽 */
.splitter {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  width: 7px;
  display: flex;
  justify-content: center;
  cursor: col-resize;
  z-index: 6;
}

.splitter-bar {
  width: 1px;
  height: 100%;
  background: var(--border-soft);
  transition: width 0.12s ease, background 0.12s ease;
}

.splitter:hover .splitter-bar,
.splitter.active .splitter-bar {
  width: 3px;
  background: var(--accent);
}

/* 收起态窄条 */
.rail {
  position: relative;
  width: 46px;
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 0;
  border-right: 1px solid var(--border-faint);
  background: var(--bg-glass);
}

.file-tree {
  position: relative;
  width: 220px;
  flex: none;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-faint);
  background: var(--bg-glass);
  overflow: hidden;
}

.dragging {
  user-select: none;
}

/* 文件 / 大纲 页签 */
.side-tabs {
  flex: none;
  display: flex;
  gap: 2px;
  padding: 8px 10px 0;
}

.side-tab {
  flex: 1;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-3);
  font-family: inherit;
  font-size: 11.5px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.1s ease, color 0.1s ease;
}

.side-tab:hover {
  color: var(--text-1);
  background: var(--bg-hover);
}

.side-tab.on {
  color: var(--accent);
  background: var(--accent-soft);
  font-weight: 600;
}

.tree-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 10px 8px 8px 10px;
  border-bottom: 1px solid var(--border-faint);
}

.ta-btn {
  flex: none;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  color: var(--text-2);
  border-radius: var(--radius-item);
  cursor: default;
  transition: background 0.12s ease, color 0.12s ease;
}
.ta-btn:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
/* 导出按钮展开着格式列表 */
.ta-btn.on {
  background: var(--accent-soft);
  color: var(--accent);
}

/* ---------- 导出格式列表 ---------- */
.fmt-pop {
  position: fixed;
  z-index: 1100;
  min-width: 178px;
  padding: 5px;
  border-radius: var(--radius-panel);
  background: var(--bg-glass-strong);
  backdrop-filter: var(--blur-panel);
  -webkit-backdrop-filter: var(--blur-panel);
  border: 1px solid var(--border-soft);
  box-shadow: var(--shadow-float);
  display: flex;
  flex-direction: column;
  gap: 1px;
  animation: fmt-in 0.12s cubic-bezier(0.2, 0.9, 0.3, 1);
  transform-origin: top left;
}

@keyframes fmt-in {
  from {
    opacity: 0;
    transform: scale(0.97);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.fmt-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 9px;
  border: none;
  background: transparent;
  color: var(--text-2);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.3;
  text-align: left;
  border-radius: var(--radius-item);
  cursor: default;
  transition: background 0.1s ease, color 0.1s ease;
}
.fmt-item:hover {
  background: var(--accent-soft);
  color: var(--accent);
}
/* 当前默认格式 */
.fmt-item.on {
  color: var(--accent);
}

.fmt-label {
  flex: 1;
  white-space: nowrap;
}

.fmt-ck {
  width: 12px;
  height: 12px;
  flex: none;
  display: block;
}

.ta-root {
  margin-left: auto;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 96px;
}

.tree-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-3);
  font-size: 12.5px;
}

.empty-btn {
  border: 1px solid var(--border-soft);
  background: transparent;
  color: var(--text-2);
  font-size: 12.5px;
  padding: 5px 14px;
  border-radius: var(--radius-item);
  cursor: default;
  transition: background 0.12s ease;
}
.empty-btn:hover {
  background: var(--bg-hover);
}

.tree-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 4px 6px 10px;
}

.tree-item {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding-right: 6px;
  border-radius: var(--radius-item);
  cursor: default;
  font-size: 13px;
  color: var(--text-1);
  user-select: none;
  white-space: nowrap;
  transition: background 0.1s ease;
}
.tree-item:hover {
  background: var(--bg-hover);
}
/* 打开的那个文件夹：名字加粗，和里面的子项区分开 */
.tree-item.root .tree-label {
  font-weight: 600;
}
.tree-item.root .chevron {
  color: var(--text-2);
}

.chevron {
  width: 10px;
  flex: none;
  display: inline-flex;
  align-items: center;
  color: var(--text-3);
}
.chevron.open :deep(svg) {
  transform: rotate(90deg);
}

.tree-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 原地重命名的输入框：接管这一行的文字位置 */
.rename-input {
  flex: 1;
  min-width: 0;
  height: 21px;
  padding: 0 4px;
  border: 1px solid var(--accent);
  border-radius: 5px;
  background: var(--bg-field);
  color: var(--text-1);
  font-family: inherit;
  font-size: 13px;
  outline: none;
}

/* ---------- 删除确认 ---------- */
.rm-mask {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.32);
  animation: rm-in 0.12s ease;
}

@keyframes rm-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.rm-card {
  width: 288px;
  padding: 16px 16px 13px;
  border-radius: var(--radius-panel);
  background: var(--bg-raised);
  border: 1px solid var(--border-soft);
  box-shadow: var(--shadow-float);
  color: var(--text-1);
}

.rm-title {
  font-size: 13.5px;
  font-weight: 600;
  margin-bottom: 8px;
}

.rm-body {
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-2);
  word-break: break-all;
}
.rm-body b {
  color: var(--text-1);
  font-weight: 600;
}

.rm-note {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-3);
}

.rm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.rm-btn {
  padding: 5px 13px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-item);
  background: transparent;
  color: var(--text-2);
  font-family: inherit;
  font-size: 12.5px;
  cursor: default;
  transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.rm-btn:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
.rm-btn.danger {
  border-color: color-mix(in srgb, var(--danger) 45%, transparent);
  color: var(--danger);
}
.rm-btn.danger:hover {
  background: color-mix(in srgb, var(--danger) 13%, transparent);
  border-color: var(--danger);
}
</style>
