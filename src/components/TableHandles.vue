<script setup lang="ts">
/**
 * 所见即所得下的表格行列手柄。
 *
 * 鼠标靠近某个表格时：表格左侧浮出「行手柄」、顶边浮出「列手柄」，
 * 点开菜单即可插入 / 删除行列。手柄与菜单全部 Teleport 到 body 并用 fixed 定位，
 * **不进 ProseMirror 的 DOM** —— 也就不参与文档、不触发它的 DOM 观察器。
 *
 * ⚠️ 命令来自 prosemirror-tables，作用于「选区所在的单元格」，所以执行前必须
 * 先把选区 dispatch 到目标单元格里。`view.dispatch` 是同步的，紧接着调命令即可
 * 让命令读到新 state，不用分两次 action。
 *
 * ⚠️ Milkdown 的表格 content 是 `table_header_row table_row+`：表头行**必须存在**
 * 且数据行至少一条。所以「表头上方插行 / 删表头行 / 删掉最后一条数据行」都会因为
 * 违反 content 模型而失败，这几项直接置灰，不给点。
 */
import { ref, computed, watch, nextTick, onBeforeUnmount } from "vue";
import { editorViewCtx, type Editor } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import {
  addRowBefore,
  addRowAfter,
  deleteRow,
  addColumnBefore,
  addColumnAfter,
  deleteColumn,
} from "@milkdown/kit/prose/tables";
import { ICON_PATHS } from "../icons";

const props = defineProps<{
  /** 编辑区滚动容器，手柄的鼠标监听挂在这里 */
  host: HTMLElement | null;
  /** 源码模式下整个禁用 */
  source?: boolean;
  /** 取编辑器实例（create 是异步的，父组件用轮询包好） */
  editor: () => Promise<Editor>;
}>();

/** 鼠标离表格这么近就浮出手柄 */
const EDGE = 26;

interface Pos {
  x: number;
  y: number;
}

const rowH = ref<Pos | null>(null);
const colH = ref<Pos | null>(null);

const menu = ref<{
  kind: "row" | "col";
  x: number;
  y: number;
  /** 能否「在/上方·左侧」插入（表头行不行） */
  canBefore: boolean;
  canDelete: boolean;
} | null>(null);

const panel = ref<HTMLElement | null>(null);

/* 命令锚点：非响应式，只在执行那一刻用 */
let rowEl: HTMLTableRowElement | null = null;
let colCell: HTMLTableCellElement | null = null;

let lastX = 0;
let lastY = 0;
let raf = 0;
let hideTimer = 0;

const label = computed(() =>
  menu.value?.kind === "col"
    ? { before: "在左侧插入列", after: "在右侧插入列", del: "删除列" }
    : { before: "在上方插入行", after: "在下方插入行", del: "删除行" },
);

const iconName = computed(() =>
  menu.value?.kind === "col"
    ? { before: "colBefore", after: "colAfter", del: "colDelete" }
    : { before: "rowAbove", after: "rowBelow", del: "rowDelete" },
);

/* ---------- 显隐调度 ---------- */

function clearHandles() {
  rowH.value = null;
  colH.value = null;
}

/** 鼠标离开容器后延迟收起，给「移到手柄上」留出时间 */
function scheduleHide(delay = 240) {
  if (menu.value) return;
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    if (!menu.value) clearHandles();
  }, delay);
}

function hold() {
  window.clearTimeout(hideTimer);
}

/* ---------- 命中计算 ---------- */

function scan(cx: number, cy: number) {
  const host = props.host;
  if (!host || props.source) {
    clearHandles();
    return;
  }

  let table: HTMLTableElement | null = null;
  let r: DOMRect | null = null;
  for (const t of host.querySelectorAll<HTMLTableElement>(".milkdown table")) {
    const b = t.getBoundingClientRect();
    if (
      cx >= b.left - EDGE &&
      cx <= b.right + EDGE &&
      cy >= b.top - EDGE &&
      cy <= b.bottom + EDGE
    ) {
      table = t;
      r = b;
      break;
    }
  }
  if (!table || !r) {
    clearHandles();
    return;
  }

  const rows = Array.from(table.rows);
  const first = rows[0];
  if (!first) {
    clearHandles();
    return;
  }

  // 行：纵向落在哪一行就挂哪个行手柄
  if (cy >= r.top && cy <= r.bottom && cx >= r.left - EDGE && cx <= r.right) {
    const tr = rows.find((el) => {
      const b = el.getBoundingClientRect();
      return cy >= b.top && cy <= b.bottom;
    });
    if (tr) {
      const b = tr.getBoundingClientRect();
      rowEl = tr;
      rowH.value = { x: r.left - 16, y: b.top + b.height / 2 };
    } else {
      rowH.value = null;
    }
  } else {
    rowH.value = null;
  }

  // 列：横向落在哪一列就挂哪个列手柄
  if (cx >= r.left && cx <= r.right && cy >= r.top - EDGE && cy <= r.bottom) {
    const cells = Array.from(first.cells);
    let ci = cells.findIndex((c) => {
      const b = c.getBoundingClientRect();
      return cx >= b.left && cx <= b.right;
    });
    if (ci < 0 && cells.length) {
      // 落在单元格间隙：取横向最近的一列
      let best = Infinity;
      cells.forEach((c, i) => {
        const b = c.getBoundingClientRect();
        const d = Math.abs(cx - (b.left + b.width / 2));
        if (d < best) {
          best = d;
          ci = i;
        }
      });
    }
    const cell = cells[ci];
    if (cell) {
      const b = cell.getBoundingClientRect();
      colCell = cell;
      colH.value = { x: b.left + b.width / 2, y: r.top - 12 };
    } else {
      colH.value = null;
    }
  } else {
    colH.value = null;
  }
}

function onMove(e: MouseEvent) {
  if (props.source || e.buttons) return; // 拖选时不动手柄
  lastX = e.clientX;
  lastY = e.clientY;
  if (raf) return;
  raf = window.requestAnimationFrame(() => {
    raf = 0;
    scan(lastX, lastY);
  });
}

function reScan() {
  if (raf) return;
  raf = window.requestAnimationFrame(() => {
    raf = 0;
    scan(lastX, lastY);
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
  host.addEventListener("scroll", reScan, { passive: true });
}

function unbind() {
  if (!bound) return;
  bound.removeEventListener("mousemove", onMove);
  bound.removeEventListener("mouseleave", onLeave);
  bound.removeEventListener("scroll", reScan);
  bound = null;
}

watch(() => props.host, bind, { immediate: true });

// 切到源码模式时手柄不会自己走，得手动收
watch(
  () => props.source,
  (on) => {
    if (on) {
      close();
      clearHandles();
    }
  },
);

onBeforeUnmount(() => {
  unbind();
  window.clearTimeout(hideTimer);
  if (raf) window.cancelAnimationFrame(raf);
});

/* ---------- 菜单 ---------- */

async function openMenu(kind: "row" | "col", e: MouseEvent) {
  hold();
  const b = (e.currentTarget as HTMLElement).getBoundingClientRect();

  if (kind === "row") {
    if (!rowEl || !rowEl.isConnected) return;
    const table = rowEl.closest("table");
    const header = !!rowEl.querySelector("th");
    const bodyRows = (table?.rows.length ?? 1) - 1;
    menu.value = {
      kind,
      x: b.right + 8,
      y: b.top - 6,
      canBefore: !header,
      canDelete: !header && bodyRows > 1,
    };
  } else {
    if (!colCell || !colCell.isConnected) return;
    const cols = colCell.closest("table")?.rows[0]?.cells.length ?? 1;
    menu.value = {
      kind,
      x: b.left + b.width / 2 - 84,
      y: b.bottom + 8,
      canBefore: true,
      canDelete: cols > 1,
    };
  }

  await nextTick();
  const el = panel.value;
  const m = menu.value;
  if (!el || !m) return;
  const { innerWidth: W, innerHeight: H } = window;
  const rect = el.getBoundingClientRect();
  m.x = Math.max(8, Math.min(m.x, W - rect.width - 8));
  m.y = Math.max(8, Math.min(m.y, H - rect.height - 8));
}

function close() {
  menu.value = null;
  scheduleHide(140);
}

const CMDS = {
  row: { before: addRowBefore, after: addRowAfter, del: deleteRow },
  col: { before: addColumnBefore, after: addColumnAfter, del: deleteColumn },
} as const;

type Op = "before" | "after" | "del";

async function run(op: Op) {
  const m = menu.value;
  if (!m) return;
  const target = m.kind === "row" ? (rowEl?.cells[0] ?? null) : colCell;
  close();
  if (!target || !target.isConnected) return;

  try {
    const editor = await props.editor();
    await editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (!target.isConnected) return;
      const pos = view.posAtDOM(target, 0);
      const sel = TextSelection.near(view.state.doc.resolve(pos), 1);
      view.dispatch(view.state.tr.setSelection(sel));
      CMDS[m.kind][op](view.state, view.dispatch);
    });
  } catch (err) {
    console.error("[LiteMark] 表格操作失败：", m.kind, op, err);
  }
  // 表格尺寸变了，等 DOM 落定后重算手柄
  window.setTimeout(() => scan(lastX, lastY), 30);
}

/** 行手柄：两列三行点阵 */
const ROW_DOTS = [
  [6.4, 4.6],
  [9.6, 4.6],
  [6.4, 8],
  [9.6, 8],
  [6.4, 11.4],
  [9.6, 11.4],
];
/** 列手柄：三列两行点阵（转 90° 会和 translate(-50%,-50%) 打架，直接另写一份） */
const COL_DOTS = [
  [4.6, 6.4],
  [4.6, 9.6],
  [8, 6.4],
  [8, 9.6],
  [11.4, 6.4],
  [11.4, 9.6],
];
</script>

<template>
  <Teleport to="body">
    <button
      v-if="rowH"
      class="tgrip"
      :style="{ left: rowH.x + 'px', top: rowH.y + 'px' }"
      title="行操作"
      @mousedown.prevent
      @mouseenter="hold"
      @mouseleave="scheduleHide()"
      @click="openMenu('row', $event)"
    >
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <circle v-for="(d, i) in ROW_DOTS" :key="i" :cx="d[0]" :cy="d[1]" r="1.05" />
      </svg>
    </button>

    <button
      v-if="colH"
      class="tgrip"
      :style="{ left: colH.x + 'px', top: colH.y + 'px' }"
      title="列操作"
      @mousedown.prevent
      @mouseenter="hold"
      @mouseleave="scheduleHide()"
      @click="openMenu('col', $event)"
    >
      <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <circle v-for="(d, i) in COL_DOTS" :key="i" :cx="d[0]" :cy="d[1]" r="1.05" />
      </svg>
    </button>

    <div
      v-if="menu"
      class="tmenu-mask"
      @mousedown.self="close"
      @contextmenu.self.prevent="close"
    >
      <div
        ref="panel"
        class="tmenu"
        :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
        @mousedown.stop
      >
        <button
          class="tmenu-i"
          :disabled="!menu.canBefore"
          @mousedown.prevent
          @click="run('before')"
        >
          <svg class="tmenu-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <path :d="ICON_PATHS[iconName.before]" />
          </svg>
          <span>{{ label.before }}</span>
        </button>

        <button class="tmenu-i" @mousedown.prevent @click="run('after')">
          <svg class="tmenu-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <path :d="ICON_PATHS[iconName.after]" />
          </svg>
          <span>{{ label.after }}</span>
        </button>

        <div class="tmenu-sep" />

        <button
          class="tmenu-i danger"
          :disabled="!menu.canDelete"
          @mousedown.prevent
          @click="run('del')"
        >
          <svg class="tmenu-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <path :d="ICON_PATHS[iconName.del]" />
          </svg>
          <span>{{ label.del }}</span>
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.tgrip {
  position: fixed;
  z-index: 900;
  width: 22px;
  height: 22px;
  transform: translate(-50%, -50%);
  display: grid;
  place-items: center;
  padding: 0;
  border-radius: 6px;
  border: 1px solid var(--border-soft);
  background: var(--bg-glass-strong);
  backdrop-filter: var(--blur-panel);
  -webkit-backdrop-filter: var(--blur-panel);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  color: var(--text-3);
  cursor: pointer;
  transition: color 0.1s ease, background 0.1s ease;
}

.tgrip:hover {
  color: var(--accent);
  background: var(--bg-glass-strong);
}

.tmenu-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
}

.tmenu {
  position: fixed;
  z-index: 1001;
  min-width: 168px;
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--border-soft);
  background: var(--bg-glass-strong);
  backdrop-filter: var(--blur-panel);
  -webkit-backdrop-filter: var(--blur-panel);
  box-shadow: var(--shadow-float);
  transform-origin: top left;
  animation: tmenu-in 0.13s cubic-bezier(0.2, 0.9, 0.3, 1);
}

@keyframes tmenu-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.tmenu-i {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 10px;
  border: none;
  background: transparent;
  border-radius: var(--radius-item);
  color: var(--text-1);
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  cursor: default;
  transition: background 0.1s ease, color 0.1s ease;
}

.tmenu-i:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent);
}

.tmenu-i.danger:hover:not(:disabled) {
  /* 跟着 --danger 走，两套主题都不会跑偏 */
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
}

.tmenu-i:disabled {
  color: var(--text-3);
}

.tmenu-ico {
  width: 16px;
  height: 16px;
  flex: none;
  display: block;
}

.tmenu-sep {
  height: 1px;
  margin: 3px 6px;
  background: var(--border-faint);
}
</style>
