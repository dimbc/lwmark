<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from "vue";
import { readDir, joinPath, type DirEntry } from "../bridge";
import { ICON_PATHS } from "../icons";

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
}>();
const emit = defineEmits<{
  openFile: [path: string];
  actOpen: [];
  actFolder: [];
  actSave: [];
  actExport: [fmtId: string];
  ctx: [e: MouseEvent];
  toggleCollapse: [];
  resize: [width: number];
  logo: [];
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

interface Node extends DirEntry {
  path: string;
  loaded: boolean;
  children: Node[];
}

const tree = ref<Node[]>([]);
const expanded = ref(new Set<string>());

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
  tree.value = root ? await loadDir(root) : [];
}

async function refresh() {
  await setRoot(props.root);
}

defineExpose({ setRoot, refresh });

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

const rootName = () =>
  props.root ? props.root.split(/[\\/]/).filter(Boolean).pop()! : "";
</script>

<template>
  <!-- 收起态：窄条活动栏 -->
  <aside
    v-if="collapsed"
    class="rail"
    :class="{ dragging }"
    @contextmenu.prevent="emit('ctx', $event)"
  >
    <button class="rail-logo" title="LiteMark · 设置" @click="emit('logo')">
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
    @contextmenu.prevent="emit('ctx', $event)"
  >
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
      <span class="ta-root" :title="root ?? ''">{{ rootName() || "资源管理器" }}</span>
    </div>

    <div v-if="!root" class="tree-empty">
      <p>未打开文件夹</p>
      <button class="empty-btn" @click="emit('actFolder')">打开文件夹</button>
    </div>

    <div v-else class="tree-scroll">
      <template v-for="node in tree" :key="node.path">
        <div
          class="tree-item"
          :style="{ paddingLeft: '10px' }"
          @click="node.type === 'DIRECTORY' ? toggle(node) : emit('openFile', node.path)"
        >
          <span class="chevron" :class="{ open: expanded.has(node.path) }">
            <svg v-if="node.type === 'DIRECTORY'" viewBox="0 0 10 10" width="9" height="9"><path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.2" fill="none" /></svg>
          </span>
          <span class="tree-label">{{ node.entry }}</span>
        </div>
        <template v-if="expanded.has(node.path)">
          <template v-for="child in node.children" :key="child.path">
            <div
              class="tree-item"
              :style="{ paddingLeft: '26px' }"
              @click="child.type === 'DIRECTORY' ? toggle(child) : emit('openFile', child.path)"
            >
              <span class="chevron">
                <svg v-if="child.type === 'DIRECTORY'" viewBox="0 0 10 10" width="9" height="9"><path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.2" fill="none" /></svg>
              </span>
              <span class="tree-label">{{ child.entry }}</span>
            </div>
            <template v-if="expanded.has(child.path)">
              <div
                v-for="leaf in child.children"
                :key="leaf.path"
                class="tree-item"
                :style="{ paddingLeft: '42px' }"
                @click="leaf.type === 'DIRECTORY' ? toggle(leaf) : emit('openFile', leaf.path)"
              >
                <span class="chevron" />
                <span class="tree-label">{{ leaf.entry }}</span>
              </div>
            </template>
          </template>
        </template>
      </template>
    </div>

    <div class="splitter" :class="{ active: dragging }" @mousedown="onHandleDown">
      <span class="splitter-bar" />
    </div>
  </aside>

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
</style>
