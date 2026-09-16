<script setup lang="ts">
import { inNL, winCtl } from "../bridge";
import { maximized, toggleWindowMax } from "../windowState";
</script>

<template>
  <header class="title-bar" @dblclick.self="toggleWindowMax">
    <button class="logo-btn" title="LiteMark · 设置" @click="$emit('logo')">
      <span class="logo-dot" />
      <span class="logo-text">LiteMark</span>
    </button>

    <div class="title-drag" @mousedown="winCtl.drag()" @dblclick="toggleWindowMax" />

    <div class="title-right">
      <span v-if="!inNL" class="env-badge">浏览器预览</span>
      <template v-if="inNL">
        <button class="tb-btn icon-btn" title="最小化" @click="winCtl.minimize()">
          <svg viewBox="0 0 12 12" width="12" height="12"><path d="M1 6h10" stroke="currentColor" stroke-width="1.1" fill="none" /></svg>
        </button>
        <button class="tb-btn icon-btn" :title="maximized ? '还原' : '最大化'" @click="toggleWindowMax">
          <svg v-if="!maximized" viewBox="0 0 12 12" width="12" height="12"><rect x="1.5" y="1.5" width="9" height="9" rx="1.5" stroke="currentColor" stroke-width="1.1" fill="none" /></svg>
          <svg v-else viewBox="0 0 12 12" width="12" height="12"><rect x="1" y="3" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.1" fill="none" /><path d="M3.5 3V2a1 1 0 0 1 1-1H10a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-1" stroke="currentColor" stroke-width="1.1" fill="none" /></svg>
        </button>
        <button class="tb-btn icon-btn close" title="关闭" @click="winCtl.close()">
          <svg viewBox="0 0 12 12" width="12" height="12"><path d="M1.5 1.5l9 9m0-9l-9 9" stroke="currentColor" stroke-width="1.1" /></svg>
        </button>
      </template>
    </div>
  </header>
</template>

<style scoped>
.title-bar {
  height: 42px;
  flex: none;
  display: flex;
  align-items: center;
  padding: 0 8px;
  border-bottom: 1px solid var(--border-faint);
  /* 外框层，与标签栏 / 侧栏 / 状态栏同色 */
  background: var(--bg-chrome);
}

.logo-btn {
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  border: none;
  background: transparent;
  color: var(--text-2);
  font-size: 12.5px;
  font-weight: 600;
  padding: 5px 8px;
  border-radius: var(--radius-item);
  cursor: default;
  white-space: nowrap;
  transition: background 0.12s ease, color 0.12s ease;
}
.logo-btn:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}

.logo-dot {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent), #9b6ef5);
  box-shadow: 0 0 8px var(--accent-soft);
}

.logo-text {
  letter-spacing: 0.02em;
}

.title-drag {
  flex: 1;
  height: 100%;
}

.title-right {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
}

.env-badge {
  font-size: 11px;
  color: var(--text-3);
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  padding: 2px 10px;
  margin-right: 6px;
}

.tb-btn {
  border: none;
  background: transparent;
  color: var(--text-2);
  border-radius: var(--radius-item);
  cursor: default;
  white-space: nowrap;
  flex: none;
  transition: background 0.12s ease, color 0.12s ease;
}

.icon-btn {
  width: 34px;
  height: 30px;
  display: grid;
  place-items: center;
}
.icon-btn:hover {
  background: var(--bg-hover);
}
.icon-btn.close:hover {
  background: var(--danger);
  color: #fff;
}
</style>
