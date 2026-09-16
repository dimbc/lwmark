<script setup lang="ts">
/**
 * 无边框窗口的自绘缩放抓手。
 *
 * borderless 窗口在 Windows 下没有 WS_THICKFRAME（Neutralino 的 setBorderless 会把它去掉），
 * 系统不给缩放边框，也拿不到原生缩放，只能在窗口四边 / 四角自己铺一层热区，
 * 拖动时直接调 window.setSize / move。
 *
 * 两个坑：
 *   1. PointerEvent 的 screenX / screenY 是 CSS 逻辑像素，而 setSize / move 要物理像素。
 *      高分屏下要乘缩放比 —— 缩放比现场量（物理宽 ÷ 客户区宽），别用 devicePixelRatio，
 *      两者在 WebView 里未必相等。
 *   2. 每帧都发 IPC 会互相追尾（窗口尺寸滞后于鼠标、来回抖）。这里用
 *      「最新值覆盖 + 同时只飞一个请求」的方式节流：算出来的是相对起始状态的绝对值，
 *      所以丢帧也不会累积漂移。
 */
import { computed, onBeforeUnmount, ref } from "vue";
import { inNL, winCtl, WIN_MIN, type WinRect } from "../bridge";
import { maximized, resizing, syncWindowGeo } from "../windowState";

type Dir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** 后出现的压在前面，四角天然盖住四边 */
const DIRS: Dir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

const visible = computed(() => inNL && !maximized.value);

/** 物理像素 / CSS 像素，每次拖拽开始时量一遍 */
let scale = 1;
let dir: Dir | null = null;
let from: { sx: number; sy: number; rect: WinRect } | null = null;
let pending: WinRect | null = null;
let frame = 0;
let inflight = false;

async function onDown(e: PointerEvent, d: Dir) {
  if (!visible.value || e.button !== 0) return;
  e.preventDefault(); // 顺手挡掉文本选择
  const sx = e.screenX;
  const sy = e.screenY;
  let rect: WinRect;
  try {
    rect = await winCtl.rect();
  } catch {
    return;
  }
  if (!rect.width || !rect.height) return;
  const cssWidth = document.documentElement.clientWidth || rect.width;
  scale = rect.width / cssWidth;
  dir = d;
  from = { sx, sy, rect };
  resizing.value = true;
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

function onMove(e: PointerEvent) {
  if (!dir || !from) return;
  const base = from.rect;
  const dx = (e.screenX - from.sx) * scale;
  const dy = (e.screenY - from.sy) * scale;
  const r: WinRect = { ...base };

  if (dir.includes("e")) r.width = Math.round(base.width + dx);
  if (dir.includes("s")) r.height = Math.round(base.height + dy);
  if (dir.includes("w")) {
    r.width = Math.round(base.width - dx);
    r.x = base.x + (base.width - r.width);
  }
  if (dir.includes("n")) {
    r.height = Math.round(base.height - dy);
    r.y = base.y + (base.height - r.height);
  }
  limit(r, dir);

  pending = r;
  if (!frame && !inflight) frame = requestAnimationFrame(flush);
}

/** 顶到最小尺寸时，对面那条边保持不动（拖左边到下限，右边界不该跟着挪） */
function limit(r: WinRect, d: Dir) {
  if (r.width < WIN_MIN.width) {
    if (d.includes("w")) r.x -= WIN_MIN.width - r.width;
    r.width = WIN_MIN.width;
  }
  if (r.height < WIN_MIN.height) {
    if (d.includes("n")) r.y -= WIN_MIN.height - r.height;
    r.height = WIN_MIN.height;
  }
  r.x = Math.round(r.x);
  r.y = Math.round(r.y);
}

function flush() {
  frame = 0;
  if (inflight || !pending) return;
  const r = pending;
  pending = null;
  inflight = true;
  void winCtl
    .setRect(r)
    .catch(() => {
      /* 窗口正在关闭这类失败，忽略 */
    })
    .then(() => {
      inflight = false;
      if (pending && !frame) frame = requestAnimationFrame(flush);
    });
}

function onUp() {
  if (!dir) return;
  dir = null;
  from = null;
  pending = null;
  resizing.value = false;
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onUp);
  syncWindowGeo(); // 松手后把最终尺寸记进配置
}

onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame);
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onUp);
});
</script>

<template>
  <template v-if="visible">
    <div
      v-for="d in DIRS"
      :key="d"
      class="rz"
      :class="`rz-${d}`"
      @pointerdown="onDown($event, d)"
    />
  </template>
</template>

<style scoped>
/*
  四边 4px、四角 12px。再宽就会压住编辑区右侧那条 10px 的滚动条
  （滚动条的滑块落在 3~7px 这一段），这里刚好错开。
*/
.rz {
  position: fixed;
  z-index: 2000;
}

.rz-n,
.rz-s {
  left: 0;
  right: 0;
  height: 4px;
  cursor: ns-resize;
}
.rz-e,
.rz-w {
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: ew-resize;
}

.rz-n {
  top: 0;
}
.rz-s {
  bottom: 0;
}
.rz-w {
  left: 0;
}
.rz-e {
  right: 0;
}

.rz-nw,
.rz-ne,
.rz-sw,
.rz-se {
  width: 12px;
  height: 12px;
}
.rz-nw {
  top: 0;
  left: 0;
  cursor: nwse-resize;
}
.rz-ne {
  top: 0;
  right: 0;
  cursor: nesw-resize;
}
.rz-sw {
  bottom: 0;
  left: 0;
  cursor: nesw-resize;
}
.rz-se {
  bottom: 0;
  right: 0;
  cursor: nwse-resize;
}
</style>
