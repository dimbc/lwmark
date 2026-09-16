<script setup lang="ts">
/**
 * 图片链接条：鼠标悬停到图片上时，图片上方浮出一条可编辑的链接框，
 * 显示该图在 Markdown 里的**真实地址**（而不是 DOM 里那份 blob 预览），
 * 改完回车即换图。
 *
 * 与 TableHandles 同一套做法：Teleport 到 body + fixed 定位，完全不进 ProseMirror 的 DOM，
 * 也就不参与文档、不触发它的 DOM 观察器。
 *
 * ⚠️ 悬停只负责「浮出」，**不自动聚焦**输入框 —— 否则鼠标扫过图片会抢走编辑器焦点，
 * 正打字的人会被打断。要改链接得自己点一下输入框。
 *
 * ⚠️ 显示的值取自 `view.posAtDOM(img, 0)` → 文档节点 attrs.src。不能读 DOM 的 src 属性：
 * 父组件已把它换成了 blob URL，读出来是一串 blob:http://...
 */
import { ref, watch, onBeforeUnmount } from "vue";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { ICON_PATHS } from "../icons";
import { picgoUpload } from "../bridge";
import { loadPicgo } from "../picgo";

const props = defineProps<{
  /** 编辑区滚动容器，鼠标监听挂在这里 */
  host: HTMLElement | null;
  /** 源码模式下整个禁用 */
  source?: boolean;
  /** 取编辑器实例（create 是异步的，父组件用轮询包好） */
  editor: () => Promise<Editor>;
  /** 地址已改：让父组件丢掉该 img 的原值缓存、重新生成预览 */
  changed?: (img: HTMLImageElement) => void;
}>();

const emit = defineEmits<{ notify: [payload: { msg: string; bad?: boolean }] }>();

/** 浮出的条：位置、宽度、是否翻到图片下方 */
const box = ref<{ x: number; y: number; w: number; below: boolean } | null>(null);
/** 输入框内容（原始地址） */
const value = ref("");
const inputEl = ref<HTMLInputElement | null>(null);

/** 当前挂着的图片（非响应式，只在交互那一刻用） */
let target: HTMLImageElement | null = null;
/** 输入框已聚焦：此时鼠标移开也不收起、也不换目标 */
let editing = false;
/** Esc 取消后浏览器仍会抛一次 blur，用它挡掉误提交 */
let skipping = false;

let lastX = 0;
let lastY = 0;
let raf = 0;
let hideTimer = 0;

const BAR_MIN = 220;
const BAR_MAX = 520;
const GAP = 8;

/* ---------- 显隐调度 ---------- */

function clear() {
  if (editing) return;
  box.value = null;
  target = null;
}

function scheduleHide(delay = 220) {
  if (editing) return;
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (!editing) clear();
  }, delay);
}

function hold() {
  window.clearTimeout(hideTimer);
}

/* ---------- 定位与取值 ---------- */

function place(img: HTMLImageElement) {
  const b = img.getBoundingClientRect();
  const w = Math.max(BAR_MIN, Math.min(b.width, BAR_MAX));
  const below = b.top < 46; // 上方放不下就翻到图片下面
  target = img;
  box.value = {
    x: barX(b.left, b.width, w),
    y: below ? b.bottom + GAP : b.top - GAP,
    w,
    below,
  };
  void loadSrc(img);
}

/** 条的横向位置：相对图片居中，再夹进视口 */
function barX(left: number, width: number, w: number) {
  const centered = left + (width - w) / 2;
  return Math.max(8, Math.min(centered, window.innerWidth - w - 8));
}

/** 从文档节点读真实地址（DOM 的 src 已被换成 blob） */
async function loadSrc(img: HTMLImageElement) {
  if (editing) return;
  try {
    const editor = await props.editor();
    const src = editor.action((ctx) => {
      if (!img.isConnected) return "";
      const view = ctx.get(editorViewCtx);
      const pos = view.posAtDOM(img, 0);
      const node = view.state.doc.nodeAt(pos);
      return node?.type.name === "image" ? String(node.attrs.src ?? "") : "";
    });
    if (target === img && box.value && !editing) value.value = src;
  } catch (e) {
    console.error("[LiteMark] 读取图片地址失败：", e);
  }
}

/** 滚动时贴着图片走；图片滚出容器就收起 */
function reposition() {
  const img = target;
  const b0 = box.value;
  if (!img || !b0 || !img.isConnected) return;
  const b = img.getBoundingClientRect();
  const host = props.host;
  if (host) {
    const hb = host.getBoundingClientRect();
    if (b.bottom < hb.top + 4 || b.top > hb.bottom - 4) {
      clear();
      return;
    }
  }
  b0.x = barX(b.left, b.width, b0.w);
  b0.y = b0.below ? b.bottom + GAP : b.top - GAP;
}

/* ---------- 命中 ---------- */

function hit(cx: number, cy: number): HTMLImageElement | null {
  const host = props.host;
  if (!host) return null;
  for (const el of host.querySelectorAll<HTMLImageElement>(".milkdown img")) {
    const b = el.getBoundingClientRect();
    if (cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom) return el;
  }
  return null;
}

function scan(cx: number, cy: number) {
  if (props.source || editing) return;
  const img = hit(cx, cy);
  if (!img) {
    scheduleHide();
    return;
  }
  if (img === target && box.value) {
    hold();
    return;
  }
  hold();
  place(img);
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

// 切到源码模式时条不会自己走，得手动收
watch(
  () => props.source,
  (on) => {
    if (on) {
      editing = false;
      value.value = "";
      clear();
    }
  },
);

onBeforeUnmount(() => {
  unbind();
  window.clearTimeout(hideTimer);
  if (raf) window.cancelAnimationFrame(raf);
});

/* ---------- 提交 ---------- */

function onFocus() {
  editing = true;
  hold();
}

function onEsc() {
  skipping = true;
  editing = false;
  value.value = "";
  inputEl.value?.blur();
  clear();
}

/** 回车 / 失焦都算确认 */
async function commit() {
  const img = target;
  const next = value.value.trim();
  editing = false;
  if (!img || !img.isConnected || !next) {
    clear();
    return;
  }

  try {
    const editor = await props.editor();
    const applied = editor.action((ctx) => {
      if (!img.isConnected) return false;
      const view = ctx.get(editorViewCtx);
      const pos = view.posAtDOM(img, 0);
      const node = view.state.doc.nodeAt(pos);
      if (!node || node.type.name !== "image") {
        // 宁可什么都不做也不乱改，但绝不静默
        console.warn("[LiteMark] 链接条定位不到图片节点，pos =", pos);
        return false;
      }
      if (String(node.attrs.src ?? "") === next) return false; // 没改，别进撤销栈
      view.dispatch(
        view.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          src: next,
        }),
      );
      return true;
    });
    if (applied) props.changed?.(img);
  } catch (e) {
    console.error("[LiteMark] 修改图片地址失败：", e);
  }
  clear();
}

function onBlur() {
  if (skipping) {
    skipping = false;
    return;
  }
  void commit();
}

/* ---------- 手动上传到图床 ---------- */

const busy = ref(false);

/** 把当前这张图传到图床，成功后把地址替换成图床链接 */
async function upload() {
  const img = target;
  const src = value.value.trim();
  if (busy.value || !img || !img.isConnected || !src) return;

  const c = loadPicgo();
  if (!c.on) {
    emit("notify", { msg: "图床未启用，去「设置 → 图床」打开", bad: true });
    return;
  }
  if (/^(https?:|data:|blob:)/i.test(src)) {
    emit("notify", { msg: "这张图已经是网络地址，不用上传" });
    return;
  }

  busy.value = true;
  hold();
  emit("notify", { msg: "正在上传到图床…" });
  const up = await picgoUpload(c.server, src);
  busy.value = false;
  if (!up.url) {
    emit("notify", { msg: `图床上传失败：${up.error}`, bad: true });
    return;
  }
  value.value = up.url;
  emit("notify", { msg: "已上传到图床" });
  await commit();
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="box"
      class="imgbar"
      :class="{ below: box.below }"
      :style="{ left: box.x + 'px', top: box.y + 'px', width: box.w + 'px' }"
      @mousedown.stop
      @mouseenter="hold"
      @mouseleave="onLeave"
    >
      <svg
        class="imgbar-ico"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path :d="ICON_PATHS.imageUrl" />
      </svg>
      <input
        ref="inputEl"
        v-model="value"
        class="imgbar-in"
        spellcheck="false"
        placeholder="图片链接 / 本地路径，回车应用"
        @focus="onFocus"
        @blur="onBlur"
        @keydown.enter.prevent="commit"
        @keydown.esc.prevent.stop="onEsc"
      />
      <button
        class="imgbar-up"
        :class="{ busy }"
        :disabled="busy"
        title="上传到图床（PicGo）"
        @mousedown.prevent
        @click="upload"
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path :d="ICON_PATHS.upload" />
        </svg>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.imgbar {
  position: fixed;
  z-index: 950;
  display: flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 10px;
  border-radius: var(--radius-item);
  border: 1px solid var(--border-soft);
  background: var(--bg-glass-strong);
  backdrop-filter: var(--blur-panel);
  -webkit-backdrop-filter: var(--blur-panel);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
  /* 默认浮在图片上方：y 是图片顶边，所以要把自身高度往上让开 */
  transform: translateY(-100%);
  animation: imgbar-in 0.12s ease;
}

.imgbar.below {
  transform: none;
}

@keyframes imgbar-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.imgbar-ico {
  width: 14px;
  height: 14px;
  flex: none;
  color: var(--text-3);
}

.imgbar-in {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-1);
  font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 12.5px;
}

.imgbar-in::placeholder {
  color: var(--text-3);
}

/* 上传到图床 */
.imgbar-up {
  flex: none;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  transition: color 0.12s ease, background 0.12s ease;
}

.imgbar-up svg {
  width: 14px;
  height: 14px;
  display: block;
}

.imgbar-up:hover:not(:disabled) {
  color: var(--accent);
  background: var(--bg-hover);
}

.imgbar-up:disabled {
  opacity: 0.55;
}

/* 上传中：图标呼吸，慢操作得有反馈 */
.imgbar-up.busy {
  color: var(--accent);
  animation: imgbar-pulse 1s ease-in-out infinite;
}

@keyframes imgbar-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
</style>
