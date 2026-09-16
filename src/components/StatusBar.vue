<script setup lang="ts">
import { computed } from "vue";
import { ICON_PATHS } from "../icons";

const props = defineProps<{
  fileName: string;
  dirty: boolean;
  words: number;
  chars: number;
  /** 当前是否处于源码模式（底栏左下角的模式按钮） */
  source: boolean;
  /** 切换模式的当前键位，只用于悬停提示 */
  modeKey?: string;
}>();

const emit = defineEmits<{ toggleMode: []; settings: [] }>();

const modeName = computed(() => (props.source ? "源码模式" : "所见即所得"));
const modeTip = computed(
  () =>
    `当前：${modeName.value} · 点击切到${props.source ? "所见即所得" : "源码"}` +
    (props.modeKey ? `（${props.modeKey}）` : ""),
);
</script>

<template>
  <footer class="status-bar">
    <div class="status-left">
      <button class="set-btn" title="设置" @click="emit('settings')">
        <svg
          class="mode-ico"
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path :d="ICON_PATHS.settings" />
        </svg>
      </button>
      <button class="mode-btn" :class="{ src: source }" :title="modeTip" @click="emit('toggleMode')">
        <svg
          class="mode-ico"
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          stroke-width="1.3"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path :d="ICON_PATHS.source" />
        </svg>
        <span class="mode-name">{{ modeName }}</span>
      </button>
      <span class="vsep" />
      <span class="doc-name">{{ fileName }}</span>
      <span v-if="dirty" class="dirty-dot" title="未保存" />
    </div>
    <div class="status-right">
      <span>{{ words }} 字</span>
      <span class="sep">·</span>
      <span>{{ chars }} 字符</span>
    </div>
  </footer>
</template>

<style scoped>
.status-bar {
  height: 30px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  font-size: 11.5px;
  color: var(--text-3);
  border-top: 1px solid var(--border-faint);
  /* 外框层，与标题栏 / 标签栏 / 侧栏同色 */
  background: var(--bg-chrome);
}

.status-left,
.status-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 左下角最左端：设置入口（只有齿轮，无文字） */
.set-btn {
  display: inline-flex;
  align-items: center;
  height: 21px;
  /* 抵消按钮自身的内边距，让图标与上方内容的 16px 边距对齐 */
  margin-left: -5px;
  padding: 0 5px;
  border: none;
  background: transparent;
  color: var(--text-3);
  line-height: 1;
  border-radius: var(--radius-item);
  cursor: default;
  transition: background 0.1s ease, color 0.1s ease;
}

.set-btn:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.set-btn:active {
  background: var(--bg-active);
}

/* 模式按钮：显示当前模式名，点一下切换 */
.mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 21px;
  padding: 0 7px;
  border: none;
  background: transparent;
  color: var(--text-2);
  font-family: inherit;
  font-size: 11.5px;
  line-height: 1;
  border-radius: var(--radius-item);
  cursor: default;
  transition: background 0.1s ease, color 0.1s ease;
}

.mode-btn:hover {
  background: var(--accent-soft);
  color: var(--accent);
}

.mode-btn:active {
  background: var(--bg-active);
}

/* 源码模式下用强调色，一眼能看出现在不在所见即所得 */
.mode-btn.src {
  color: var(--accent);
}

.mode-ico {
  width: 13px;
  height: 13px;
  flex: none;
  display: block;
}

.mode-name {
  white-space: nowrap;
}

.vsep {
  width: 1px;
  height: 12px;
  background: var(--border-soft);
}

.doc-name {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dirty-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}

.sep {
  opacity: 0.5;
}
</style>
