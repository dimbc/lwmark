<script setup lang="ts">
export interface Tab {
  path: string | null;
  name: string;
  text: string;
  dirty: boolean;
}

const props = defineProps<{ tabs: Tab[]; active: number }>();
const emit = defineEmits<{ select: [i: number]; close: [i: number] }>();

function close(i: number, e: MouseEvent) {
  e.stopPropagation();
  emit("close", i);
}
</script>

<template>
  <div v-if="tabs.length > 1 || tabs[0]?.path" class="tabs-bar">
    <div
      v-for="(tab, i) in tabs"
      :key="tab.path ?? 'untitled-' + i"
      class="tab"
      :class="{ active: i === active }"
      :title="tab.path ?? tab.name"
      @click="emit('select', i)"
    >
      <span class="tab-name">{{ tab.name }}</span>
      <span v-if="tab.dirty" class="dirty-dot" />
      <button class="tab-close" title="关闭标签页" @click="close(i, $event)">
        <svg viewBox="0 0 10 10" width="9" height="9"><path d="M2 2l6 6m0-6l-6 6" stroke="currentColor" stroke-width="1.1" /></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.tabs-bar {
  flex: none;
  display: flex;
  align-items: flex-end;
  gap: 4px;
  padding: 4px 8px 0;
  border-bottom: 1px solid var(--border-faint);
  background: var(--bg-glass);
  overflow-x: auto;
  scrollbar-width: none;
}
.tabs-bar::-webkit-scrollbar {
  display: none;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 8px 0 12px;
  max-width: 180px;
  border-radius: 8px 8px 0 0;
  font-size: 12.5px;
  color: var(--text-3);
  cursor: default;
  user-select: none;
  transition: background 0.12s ease, color 0.12s ease;
}
.tab:hover {
  background: var(--bg-hover);
}
.tab.active {
  background: var(--bg-hover);
  color: var(--text-1);
  box-shadow: inset 0 -2px 0 var(--accent);
}

.tab-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dirty-dot {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}

.tab-close {
  flex: none;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border: none;
  background: transparent;
  color: var(--text-3);
  border-radius: 4px;
  cursor: default;
  opacity: 0;
  transition: opacity 0.1s ease, background 0.1s ease;
}
.tab:hover .tab-close,
.tab.active .tab-close {
  opacity: 1;
}
.tab-close:hover {
  background: var(--border-soft);
  color: var(--text-1);
}
</style>
