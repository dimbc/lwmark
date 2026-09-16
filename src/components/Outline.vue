<script setup lang="ts">
/**
 * 侧栏「大纲」面板：整篇文档的标题树。
 *
 * - 点标题文字 → 跳到正文对应位置（所见即所得模式光标落标题行，源码模式落对应行）
 * - 点折叠箭头 → 和正文标题左侧的箭头完全联动（同一条折叠状态）
 * - 光标所在的最深标题高亮（activeKey 由编辑器插件随选区推送）
 *
 * 数据由 App 传入：所见即所得模式来自 headingFold 插件的快照；源码模式是
 * App 用 parseTextOutline 现算的（无折叠概念，箭头一律不显示）。
 */
import type { OutlineItem } from "../headingFold";

defineProps<{
  items: OutlineItem[];
  activeKey: string | null;
}>();

const emit = defineEmits<{
  jump: [item: OutlineItem];
  toggle: [item: OutlineItem];
}>();
</script>

<template>
  <div class="outline" @contextmenu.stop>
    <div v-if="!items.length" class="outline-empty">
      <p>没有标题</p>
      <p class="hint">在正文里写一行「# 标题」试试</p>
    </div>
    <div v-else class="outline-scroll">
      <div
        v-for="item in items"
        :key="item.key"
        class="ol-item"
        :class="{ on: item.key === activeKey }"
        :style="{ paddingLeft: 10 + (item.level - 1) * 13 + 'px' }"
        :title="item.text"
        @click="emit('jump', item)"
      >
        <button
          v-if="item.hasKids"
          class="ol-chev"
          :class="{ folded: item.folded }"
          :title="item.folded ? '展开这一节' : '折叠这一节'"
          @click.stop="emit('toggle', item)"
        >
          <svg viewBox="0 0 10 10" width="9" height="9"><path d="M3 1.5l4 3.5-4 3.5" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round" /></svg>
        </button>
        <span v-else class="ol-chev none" />
        <span class="ol-text">{{ item.text || "(空标题)" }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.outline {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.outline-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: var(--text-3);
  font-size: 12px;
}

.outline-empty .hint {
  font-size: 11px;
  opacity: 0.75;
}

.outline-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 0 10px;
}

.outline-scroll::-webkit-scrollbar {
  width: 8px;
}

.outline-scroll::-webkit-scrollbar-thumb {
  background: var(--bg-active);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: content-box;
}

.ol-item {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 26px;
  margin: 0 8px 1px 0;
  border-radius: var(--radius-item);
  cursor: default;
  color: var(--text-2);
  transition: background 0.1s ease, color 0.1s ease;
}

.ol-item:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}

/* 光标所在的标题：常态就带一层淡底，扫一眼就知道自己看到哪了 */
.ol-item.on {
  background: var(--accent-soft);
  color: var(--accent);
}

.ol-chev {
  flex: none;
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  /* 箭头默认指向右（未折叠），展开态转 90° 朝下 —— 和正文折叠按钮同一个约定 */
  transform: rotate(90deg);
  transition: transform 0.12s ease, color 0.1s ease, background 0.1s ease;
}

.ol-chev.folded {
  transform: rotate(0deg);
}

.ol-chev:hover {
  color: var(--accent);
  background: var(--bg-active);
}

.ol-chev.none {
  cursor: default;
}

.ol-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  line-height: 1.3;
}
</style>
