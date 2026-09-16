<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount, onMounted } from "vue";
import { ICON_PATHS } from "../icons";
import { formatBinding, type Binding } from "../shortcuts";

/** 二级列表的一项（如导出格式） */
export interface SubItem {
  id: string;
  label: string;
}

export interface MenuItem {
  label: string;
  /** icons.ts 中的图标名 */
  icon?: string;
  /** EditorPane 命令 */
  editor?: string;
  clipboard?: "cut" | "copy" | "paste" | "selectAll";
  action?:
    | "open"
    | "folder"
    | "save"
    | "newFile"
    | "refresh"
    | "insertImage"
    | "insertImageUrl"
    | "exportDoc"
    | "importDoc"
    | "rename"
    | "remove";
  /** 危险操作（删除），悬停用红色 */
  danger?: boolean;
  /** shortcuts.ts 里的命令 id：悬停时显示当前绑定 */
  key?: string;
  /** 固定组合键（如 Ctrl+C，由系统/编辑器原生处理，不参与改绑） */
  accel?: string;
  divider?: boolean;
  /**
   * 二级列表：带了它的按钮不直接执行，而是在按钮旁弹出竖向列表，
   * 选中后以 `{ ...item, sub: 选中项 id }` 形式发回 select。
   */
  submenu?: SubItem[];
  /** 二级列表里当前生效的那一项（高亮） */
  subActive?: string;
  /** 二级列表选中的项 id，由本组件在 select 时填入 */
  sub?: string;
}

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  items: MenuItem[];
  bindings?: Record<string, Binding>;
}>();

const emit = defineEmits<{ close: []; select: [item: MenuItem] }>();

const panel = ref<HTMLElement | null>(null);
const pos = ref({ x: props.x, y: props.y });

const tipEl = ref<HTMLElement | null>(null);
const tip = ref<{ label: string; parts: string[]; danger?: boolean } | null>(null);
const tipPos = ref({ x: 0, y: 0 });
let tipTimer: number | undefined;

/* 二级列表：从某个按钮旁弹出，位置一次算好（贴着按钮） */
const subEl = ref<HTMLElement | null>(null);
const subState = ref<{ item: MenuItem; x: number; y: number } | null>(null);

/** 用 divider 切分：同类操作并排成一行，行与行之间留分隔线 */
const rows = computed(() => {
  const out: MenuItem[][] = [];
  let cur: MenuItem[] = [];
  for (const it of props.items) {
    if (it.divider) {
      if (cur.length) out.push(cur);
      cur = [];
    } else {
      cur.push(it);
    }
  }
  if (cur.length) out.push(cur);
  return out;
});

watch(
  () => [props.visible, props.x, props.y],
  async () => {
    hideTip();
    subState.value = null;
    if (!props.visible) return;
    pos.value = { x: props.x, y: props.y };
    await nextTick();
    const el = panel.value;
    if (!el) return;
    const { innerWidth, innerHeight } = window;
    const rect = el.getBoundingClientRect();
    if (props.x + rect.width + 8 > innerWidth)
      pos.value.x = Math.max(8, innerWidth - rect.width - 8);
    if (props.y + rect.height + 8 > innerHeight)
      pos.value.y = Math.max(8, innerHeight - rect.height - 8);
  },
);

/** 该项的按键提示：可改绑命令取当前绑定，固定键取 accel */
function partsOf(item: MenuItem): string[] {
  const b = item.key ? props.bindings?.[item.key] : undefined;
  if (b) return formatBinding(b).split(" + ");
  if (item.accel) return item.accel.split("+");
  return [];
}

function hideTip() {
  window.clearTimeout(tipTimer);
  tip.value = null;
}

function enter(item: MenuItem, e: MouseEvent) {
  const btn = e.currentTarget as HTMLElement;
  hideTip();
  // 没有快捷键的项（重命名 / 删除 / 刷新…）也要出名字，不能只靠 kbd 撑着
  const parts = partsOf(item);
  tipTimer = window.setTimeout(async () => {
    tip.value = { label: item.label, parts, danger: item.danger };
    const bb = btn.getBoundingClientRect();
    await nextTick();
    const el = tipEl.value;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let x = bb.left + bb.width / 2;
    x = Math.min(Math.max(x, r.width / 2 + 8), window.innerWidth - r.width / 2 - 8);
    let y = bb.bottom + 8;
    if (y + r.height > window.innerHeight - 8) y = bb.top - r.height - 8;
    tipPos.value = { x, y };
  }, 130);
}

/** 在按钮旁弹出二级列表：默认贴右侧，右边放不下就翻到左侧 */
async function openSub(item: MenuItem, btn: HTMLElement) {
  hideTip();
  const bb = btn.getBoundingClientRect();
  subState.value = { item, x: bb.right + 6, y: bb.top - 8 };
  await nextTick();
  const el = subEl.value;
  if (!el) return;
  const r = el.getBoundingClientRect();
  let x = bb.right + 6;
  if (x + r.width + 8 > window.innerWidth) x = bb.left - r.width - 6;
  x = Math.max(8, Math.min(x, window.innerWidth - r.width - 8));
  let y = Math.min(bb.top - 8, window.innerHeight - r.height - 8);
  y = Math.max(8, y);
  subState.value = { item, x, y };
}

function pickSub(s: SubItem) {
  const it = subState.value?.item;
  subState.value = null;
  if (!it) return;
  emit("select", { ...it, sub: s.id });
  emit("close");
}

function pick(item: MenuItem, e: MouseEvent) {
  if (item.divider) return;
  hideTip();
  if (item.submenu?.length) {
    void openSub(item, e.currentTarget as HTMLElement);
    return;
  }
  emit("select", item);
  emit("close");
}

/** Esc：先收二级列表，没有二级列表时关整个菜单 */
function onKey(e: KeyboardEvent) {
  if (!props.visible || e.key !== "Escape") return;
  e.preventDefault();
  if (subState.value) {
    subState.value = null;
    return;
  }
  hideTip();
  emit("close");
}

onMounted(() => window.addEventListener("keydown", onKey, true));
onBeforeUnmount(() => {
  hideTip();
  window.removeEventListener("keydown", onKey, true);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="ctx-mask"
      @mousedown.self="emit('close')"
      @contextmenu.self.prevent="emit('close')"
    >
      <div
        ref="panel"
        class="ctx-panel"
        :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
        @mousedown.stop
      >
        <template v-for="(row, ri) in rows" :key="ri">
          <div v-if="ri > 0" class="ctx-sep" />
          <div class="ctx-row">
            <button
              v-for="item in row"
              :key="item.label"
              :class="['ctx-item', { danger: item.danger }]"
              @mousedown.prevent
              @click="pick(item, $event)"
              @mouseenter="enter(item, $event)"
              @mouseleave="hideTip"
            >
              <svg
                class="ctx-ico"
                viewBox="0 0 16 16"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.3"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path :d="ICON_PATHS[item.icon ?? ''] ?? ''" />
              </svg>
            </button>
          </div>
        </template>
      </div>

      <!-- 二级列表（如导出的格式列表）：贴着触发的按钮弹出 -->
      <div
        v-if="subState"
        ref="subEl"
        class="ctx-sub"
        :style="{ left: subState.x + 'px', top: subState.y + 'px' }"
        @mousedown.stop
      >
        <button
          v-for="s in subState.item.submenu"
          :key="s.id"
          class="ctx-sub-i"
          :class="{ on: s.id === subState.item.subActive }"
          @mousedown.prevent
          @click="pickSub(s)"
        >
          <span class="ctx-sub-t">{{ s.label }}</span>
          <svg
            v-if="s.id === subState.item.subActive"
            class="ctx-sub-ck"
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

      <div
        v-if="tip"
        ref="tipEl"
        class="ctx-tip"
        :class="{ danger: tip.danger }"
        :style="{ left: tipPos.x + 'px', top: tipPos.y + 'px' }"
      >
        <span class="tip-label">{{ tip.label }}</span>
        <span class="tip-keys">
          <template v-for="(p, i) in tip.parts" :key="i">
            <span v-if="i" class="tip-plus">+</span>
            <kbd>{{ p }}</kbd>
          </template>
        </span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
}

.ctx-panel {
  position: fixed;
  padding: 6px;
  border-radius: var(--radius-panel);
  background: var(--bg-glass-strong);
  backdrop-filter: var(--blur-panel);
  -webkit-backdrop-filter: var(--blur-panel);
  border: 1px solid var(--border-soft);
  box-shadow: var(--shadow-float);
  display: flex;
  flex-direction: column;
  gap: 5px;
  animation: ctx-in 0.13s cubic-bezier(0.2, 0.9, 0.3, 1);
  transform-origin: top left;
}

@keyframes ctx-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* 每行排成固定列网格：列宽一致、从左侧起算，于是所有行的图标严格上下对齐，
 * 不会出现「2 项的行居中、4 项的行撑开」那种参差。面板宽度由最宽的一行决定。 */
.ctx-row {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 30px;
  justify-content: start;
  gap: 2px;
}

.ctx-sep {
  height: 1px;
  background: var(--border-faint);
  margin: 0 3px;
}

.ctx-item {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  color: var(--text-2);
  border-radius: var(--radius-item);
  cursor: default;
  transition: background 0.1s ease, color 0.1s ease;
}
.ctx-item:hover {
  background: var(--accent-soft);
  color: var(--accent);
}
.ctx-item:active {
  background: var(--bg-active);
}
/* 危险操作（删除到回收站）：悬停变红 */
.ctx-item.danger:hover {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
}

.ctx-ico {
  width: 16px;
  height: 16px;
  display: block;
  flex: none;
}

/* 二级列表：文字项，当前生效项打勾 */
.ctx-sub {
  position: fixed;
  min-width: 172px;
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
  animation: ctx-in 0.12s cubic-bezier(0.2, 0.9, 0.3, 1);
  transform-origin: top left;
}

.ctx-sub-i {
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
.ctx-sub-i:hover {
  background: var(--accent-soft);
  color: var(--accent);
}
.ctx-sub-i.on {
  color: var(--accent);
}
.ctx-sub-i:active {
  background: var(--bg-active);
}

.ctx-sub-t {
  flex: 1;
  white-space: nowrap;
}

.ctx-sub-ck {
  width: 12px;
  height: 12px;
  flex: none;
  display: block;
}

/* 悬停提示：功能名 + 当前快捷键 */
.ctx-tip {
  position: fixed;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 9px;
  border-radius: 8px;
  background: var(--bg-glass-strong);
  backdrop-filter: var(--blur-panel);
  -webkit-backdrop-filter: var(--blur-panel);
  border: 1px solid var(--border-soft);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
  font-size: 11.5px;
  color: var(--text-1);
  white-space: nowrap;
  pointer-events: none;
  animation: tip-in 0.1s ease;
}

@keyframes tip-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.tip-keys {
  display: flex;
  align-items: center;
  gap: 3px;
}

.ctx-tip kbd {
  font-family: inherit;
  font-size: 10.5px;
  line-height: 1;
  padding: 3px 5px;
  border-radius: 5px;
  background: var(--bg-hover);
  border: 1px solid var(--border-soft);
  color: var(--text-2);
}

.tip-plus {
  font-size: 10px;
  color: var(--text-3);
}

/* 删除这类危险操作，提示也带红，和图标悬停一致 */
.ctx-tip.danger .tip-label {
  color: var(--danger);
}
</style>
