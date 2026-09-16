<script setup lang="ts">
/**
 * 代码块语言标记：鼠标移到代码块上时，右上角浮出一枚小标签，
 * 显示当前语言（没标就是「标记语言」）；点一下弹出语言列表，选中即写回
 * `code_block.attrs.language` —— 也就是围栏 ```lang 里那个 lang。
 *
 * 和 TableHandles / ImageBar 同一套做法：Teleport 到 body + fixed 定位，
 * 完全不进 ProseMirror 的 DOM，不参与文档，也不会触发它的 DOM 观察器。
 *
 * ⚠️ 语言要从**文档节点**读（`view.posAtDOM(pre, 0)` → code_block.language），
 * 不是读 DOM：围栏语言映射到 DOM 上只有一个 `data-language`，而我们要的是原值。
 */
import { ref, computed, watch, nextTick, onBeforeUnmount } from "vue";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import type { Node as PMNode } from "@milkdown/kit/prose/model";
import { ICON_PATHS } from "../icons";
import { CODE_LANGS, resolveLang } from "../highlight";

const props = defineProps<{
  /** 编辑区滚动容器，鼠标监听挂在这里 */
  host: HTMLElement | null;
  /** 源码模式下整个禁用 */
  source?: boolean;
  /** 取编辑器实例（create 是异步的，父组件用轮询包好） */
  editor: () => Promise<Editor>;
}>();

/** 悬停标签的位置（右缘对齐代码块右上角） */
const chip = ref<{ x: number; y: number; lang: string } | null>(null);
/** 语言列表是否展开 */
const picking = ref(false);
const filter = ref("");
const filterEl = ref<HTMLInputElement | null>(null);

/** 当前挂着的代码块（非响应式，只在交互那一刻用） */
let target: HTMLPreElement | null = null;

let lastX = 0;
let lastY = 0;
let raf = 0;
let hideTimer = 0;

const CHIP_GAP = 8;
const PICK_W = 196;
const PICK_MAX_H = 280;

/* ---------- 显隐调度 ---------- */

function clear() {
  if (picking.value) return;
  chip.value = null;
  target = null;
}

function scheduleHide(delay = 240) {
  if (picking.value) return;
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (!picking.value) clear();
  }, delay);
}

function hold() {
  window.clearTimeout(hideTimer);
}

/* ---------- 命中与定位 ---------- */

function hit(cx: number, cy: number): HTMLPreElement | null {
  const host = props.host;
  if (!host) return null;
  for (const el of host.querySelectorAll<HTMLPreElement>(".milkdown pre")) {
    const b = el.getBoundingClientRect();
    if (cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom) return el;
  }
  return null;
}

/** 定位到代码块右上角内侧 */
function anchor(el: HTMLPreElement) {
  const b = el.getBoundingClientRect();
  return { x: b.right - CHIP_GAP, y: b.top + CHIP_GAP };
}

/** 从文档节点读语言（不是读 DOM） */
async function readLang(pre: HTMLPreElement): Promise<string> {
  const editor = await props.editor();
  return editor.action((ctx) => {
    if (!pre.isConnected) return "";
    const view = ctx.get(editorViewCtx);
    const pos = codeBlockPos(view.state.doc, view.posAtDOM(pre, 0));
    if (pos < 0) return "";
    return String(view.state.doc.nodeAt(pos)?.attrs.language ?? "");
  });
}

/** 由 DOM 位置反查 code_block 节点位置；空块与嵌套块都要能落到 */
function codeBlockPos(doc: PMNode, raw: number): number {
  for (const p of [raw, raw - 1]) {
    if (p >= 0 && doc.nodeAt(p)?.type.name === "code_block") return p;
  }
  const $p = doc.resolve(raw);
  for (let d = $p.depth; d >= 1; d--) {
    if ($p.node(d).type.name === "code_block") return $p.before(d);
  }
  return -1;
}

function place(pre: HTMLPreElement) {
  const a = anchor(pre);
  target = pre;
  chip.value = { x: a.x, y: a.y, lang: "" };
  void readLang(pre).then((lang) => {
    if (target === pre && chip.value) chip.value.lang = lang;
  });
}

function scan(cx: number, cy: number) {
  if (props.source) return;
  const pre = hit(cx, cy);
  if (!pre) {
    scheduleHide();
    return;
  }
  if (pre === target && chip.value) {
    hold();
    return;
  }
  hold();
  picking.value = false;
  place(pre);
}

function onMove(e: MouseEvent) {
  lastX = e.clientX;
  lastY = e.clientY;
  if (raf) return;
  raf = window.requestAnimationFrame(() => {
    raf = 0;
    scan(lastX, lastY);
  });
}

/** 滚动时贴着代码块走；滚出容器就收起 */
function reposition() {
  const pre = target;
  const c = chip.value;
  if (!pre || !c || !pre.isConnected) return;
  const host = props.host;
  const b = pre.getBoundingClientRect();
  if (host) {
    const hb = host.getBoundingClientRect();
    if (b.bottom < hb.top + 4 || b.top > hb.bottom - 4) {
      chip.value = null;
      target = null;
      picking.value = false;
      return;
    }
  }
  const a = anchor(pre);
  c.x = a.x;
  c.y = a.y;
}

function onScroll() {
  if (raf) return;
  raf = window.requestAnimationFrame(() => {
    raf = 0;
    reposition();
  });
}

let bound: HTMLElement | null = null;

/** 包一层：直接把 scheduleHide 交给 addEventListener 会把 Event 当成 delay 传进去 */
function onLeave() {
  scheduleHide();
}

function bind(host: HTMLElement | null) {
  unbind();
  if (!host) return;
  bound = host;
  host.addEventListener("mousemove", onMove);
  host.addEventListener("mouseleave", onLeave);
  host.addEventListener("scroll", onScroll, { passive: true });
}

function unbind() {
  if (!bound) return;
  bound.removeEventListener("mousemove", onMove);
  bound.removeEventListener("mouseleave", onLeave);
  bound.removeEventListener("scroll", onScroll);
  bound = null;
}

watch(() => props.host, bind, { immediate: true });

// 切到源码模式：标签与列表都得收掉
watch(
  () => props.source,
  (on) => {
    if (on) {
      picking.value = false;
      chip.value = null;
      target = null;
    }
  },
);

onBeforeUnmount(() => {
  unbind();
  window.clearTimeout(hideTimer);
  if (raf) window.cancelAnimationFrame(raf);
  window.removeEventListener("keydown", onDocKey, true);
  window.removeEventListener("mousedown", onDocDown, true);
});

/* ---------- 语言列表 ---------- */

const current = computed(() => {
  const raw = String(chip.value?.lang ?? "");
  const id = resolveLang(raw);
  const hit = id ? CODE_LANGS.find((l) => l.id === id) : undefined;
  return { raw, id, label: hit?.label ?? "", title: id ? (hit?.label ?? id) : raw };
});

const options = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return CODE_LANGS;
  return CODE_LANGS.filter(
    (l) =>
      l.label.toLowerCase().includes(q) ||
      l.id.includes(q) ||
      l.alias.some((a) => a.includes(q)),
  );
});

const pickPos = ref({ x: 0, y: 0 });

async function openPicker() {
  const c = chip.value;
  if (!c) return;
  hold();
  filter.value = "";
  picking.value = true;
  // 面板贴芯片右上角外侧，越界就夹回视口
  let x = c.x - PICK_W;
  x = Math.max(8, Math.min(x, window.innerWidth - PICK_W - 8));
  let y = c.y + 30;
  if (y + PICK_MAX_H > window.innerHeight - 8) y = Math.max(8, window.innerHeight - PICK_MAX_H - 8);
  pickPos.value = { x, y };
  await nextTick();
  filterEl.value?.focus();
}

function closePicker() {
  picking.value = false;
}

/** 列表开着时：Esc 关、点别处关（点列表内部不算） */
function onDocKey(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closePicker();
  }
}

function onDocDown(e: MouseEvent) {
  const el = e.target as HTMLElement | null;
  if (el && (el.closest(".lang-pick") || el.closest(".lang-chip"))) return;
  closePicker();
}

watch(picking, (on) => {
  if (on) {
    window.addEventListener("keydown", onDocKey, true);
    window.addEventListener("mousedown", onDocDown, true);
  } else {
    window.removeEventListener("keydown", onDocKey, true);
    window.removeEventListener("mousedown", onDocDown, true);
  }
});

function onPickKey(e: KeyboardEvent) {
  if (e.key === "Enter") {
    e.preventDefault();
    const first = options.value[0];
    if (first) void apply(first.id);
  }
}

/** 写回语言（也用于「清除语言」传空串） */
async function apply(lang: string) {
  const pre = target;
  picking.value = false;
  if (!pre || !pre.isConnected) return;
  try {
    const editor = await props.editor();
    const ok = editor.action((ctx) => {
      if (!pre.isConnected) return false;
      const view = ctx.get(editorViewCtx);
      const pos = codeBlockPos(view.state.doc, view.posAtDOM(pre, 0));
      if (pos < 0) {
        console.warn("[LiteMark] 语言标签定位不到代码块，pos =", pos);
        return false;
      }
      const node = view.state.doc.nodeAt(pos)!;
      if (String(node.attrs.language ?? "") === lang) return false; // 没改就别进撤销栈
      view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, language: lang }));
      return true;
    });
    // 标签文字就地更新（高亮由 Decoration 自动跟着 state 变）
    if (ok && chip.value) chip.value.lang = lang;
  } catch (e) {
    console.error("[LiteMark] 设置代码块语言失败：", e);
  }
  hold();
}
</script>

<template>
  <Teleport to="body">
    <button
      v-if="chip"
      class="lang-chip"
      :class="{ unset: !current.raw, unk: !!current.raw && !current.id }"
      :style="{ left: chip.x + 'px', top: chip.y + 'px' }"
      :title="
        current.raw
          ? current.id
            ? `当前语言：${current.raw}（点击更换）`
            : `语言 ${current.raw} 暂不支持高亮，可点击换成已支持的`
          : '给这个代码块标记语言（写回围栏）'
      "
      @mousedown.prevent
      @click="openPicker"
      @mouseenter="hold"
      @mouseleave="onLeave"
    >
      <svg
        class="lang-ico"
        viewBox="0 0 16 16"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path :d="ICON_PATHS.codeBlock" />
      </svg>
      <span class="lang-text">{{ current.raw || "标记语言" }}</span>
      <span v-if="current.label && current.label.toLowerCase() !== current.raw.toLowerCase()" class="lang-hint">
        {{ current.label }}
      </span>
    </button>

    <div
      v-if="picking && chip"
      class="lang-pick"
      :style="{ left: pickPos.x + 'px', top: pickPos.y + 'px', width: PICK_W + 'px', maxHeight: PICK_MAX_H + 'px' }"
      @mousedown.stop
      @mouseenter="hold"
      @mouseleave="onLeave"
    >
      <input
        ref="filterEl"
        v-model="filter"
        class="lang-filter"
        spellcheck="false"
        placeholder="搜索语言…"
        @keydown="onPickKey"
      />
      <div class="lang-list">
        <button
          v-for="l in options"
          :key="l.id"
          class="lang-item"
          :class="{ on: l.id === current.id }"
          @mousedown.prevent
          @click="apply(l.id)"
        >
          <span class="lang-name">{{ l.label }}</span>
          <span class="lang-id">{{ l.id }}</span>
        </button>
        <button v-if="current.raw" class="lang-item clear" @mousedown.prevent @click="apply('')">
          <span class="lang-name">清除语言</span>
          <span class="lang-id">不高亮</span>
        </button>
        <p v-if="!options.length" class="lang-empty">没有匹配的语言</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 标签：默认很淡，鼠标进块内就亮起来 —— 不抢代码的注意力 */
.lang-chip {
  position: fixed;
  z-index: 940;
  /* left 是代码块右上角内侧，自身宽度往左撑开 */
  transform: translateX(-100%);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  background: var(--bg-glass-strong);
  backdrop-filter: var(--blur-panel);
  -webkit-backdrop-filter: var(--blur-panel);
  color: var(--text-2);
  font-family: inherit;
  font-size: 10.5px;
  line-height: 1;
  cursor: pointer;
  opacity: 0.42;
  transition: opacity 0.12s ease, color 0.12s ease, border-color 0.12s ease;
  animation: lang-in 0.12s ease;
}

.lang-chip:hover {
  opacity: 1;
  color: var(--accent);
  border-color: var(--accent);
}

/* 还没标语言：更淡，且文字是引导语 */
.lang-chip.unset {
  opacity: 0.3;
}

/* 标了语言但不支持高亮（如 vue / mermaid） */
.lang-chip.unk .lang-text {
  text-decoration: underline dotted;
}

@keyframes lang-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 0.42;
  }
}

.lang-ico {
  width: 12px;
  height: 12px;
  flex: none;
  display: block;
}

.lang-text {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lang-hint {
  color: var(--text-3);
  max-width: 90px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 语言列表 */
.lang-pick {
  position: fixed;
  z-index: 941;
  display: flex;
  flex-direction: column;
  padding: 6px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--border-soft);
  background: var(--bg-glass-strong);
  backdrop-filter: var(--blur-panel);
  -webkit-backdrop-filter: var(--blur-panel);
  box-shadow: var(--shadow-float);
  animation: pick-in 0.12s cubic-bezier(0.2, 0.9, 0.3, 1);
}

@keyframes pick-in {
  from {
    opacity: 0;
    transform: scale(0.97);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.lang-filter {
  flex: none;
  height: 26px;
  margin-bottom: 5px;
  padding: 0 8px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-item);
  background: var(--bg-hover);
  color: var(--text-1);
  font-family: inherit;
  font-size: 12px;
  outline: none;
}

.lang-filter:focus {
  border-color: var(--accent);
}

.lang-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.lang-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
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

.lang-item:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.lang-item.on {
  color: var(--accent);
}

.lang-name {
  flex: 1;
  white-space: nowrap;
}

.lang-id {
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 10px;
  color: var(--text-3);
  white-space: nowrap;
}

.lang-item.clear .lang-name {
  color: var(--danger);
}

.lang-empty {
  margin: 8px 4px;
  font-size: 11.5px;
  color: var(--text-3);
}
</style>
