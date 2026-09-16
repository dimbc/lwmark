<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from "vue";
import { Milkdown, useEditor } from "@milkdown/vue";
import {
  Editor,
  rootCtx,
  defaultValueCtx,
} from "@milkdown/kit/core";
import {
  commonmark,
  toggleStrongCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  createCodeBlockCommand,
  insertHrCommand,
  wrapInHeadingCommand,
  turnIntoTextCommand,
  sinkListItemCommand,
  liftListItemCommand,
  insertImageCommand,
} from "@milkdown/kit/preset/commonmark";
import {
  gfm,
  toggleStrikethroughCommand,
  insertTableCommand,
} from "@milkdown/kit/preset/gfm";
import { history, undoCommand, redoCommand } from "@milkdown/kit/plugin/history";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { callCommand } from "@milkdown/kit/utils";
import {
  fileToBase64,
  inNL,
  localImageBlobUrl,
  picgoUpload,
  saveClipboardImage,
} from "../bridge";
import { transformSource } from "../sourceFormat";
import { srcMarks } from "../srcMarks";
import { codeHighlight } from "../codeHighlight";
import { loadPicgo } from "../picgo";
import TableHandles from "./TableHandles.vue";
import ImageBar from "./ImageBar.vue";
import CodeLang from "./CodeLang.vue";

/** source = true 时改用纯文本 textarea，命令直接改文本 */
const props = defineProps<{ initial: string; source?: boolean }>();
const emit = defineEmits<{
  update: [md: string];
  /** 图床相关的提示（上传失败等），交给 App 弹轻提示 */
  notify: [payload: { msg: string; bad?: boolean }];
}>();

/**
 * ⚠️ @milkdown/vue 的 useEditor 只返回 `{ loading, get }`（见其 lib/index.js），
 * 解构 editorRef / getEditor 会拿到 undefined。编辑器实例要用 `get()` 取，
 * 且 create() 是异步的——就绪前 `get()` 返回 undefined，必须轮询等待。
 */
const { get } = useEditor((root) =>
  Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, props.initial);
      ctx.get(listenerCtx).markdownUpdated((_ctx, md) => emit("update", md));
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(listener)
    .use(srcMarks)
    // 代码块语法高亮（纯 Decoration，不改文档）
    .use(codeHighlight)
);

/** 等编辑器实例就绪（create 完成前 get() 为 undefined） */
async function ready(timeout = 5000): Promise<Editor> {
  const t0 = Date.now();
  for (;;) {
    const editor = get();
    if (editor) return editor;
    if (Date.now() - t0 > timeout) throw new Error("编辑器尚未就绪");
    await new Promise((r) => window.setTimeout(r, 30));
  }
}

/* ---------- 源码模式 ---------- */
/** 文本框内容；只在切进源码模式时从 props 取一次，之后自己持有，避免 IME 组字被打断 */
const srcText = ref(props.initial);
const srcEl = ref<HTMLTextAreaElement | null>(null);

watch(
  () => props.source,
  (on) => {
    if (on) srcText.value = props.initial;
  },
);

function onSourceInput() {
  emit("update", srcText.value);
}

/** 当前光标 / 选区；没有焦点时退回文末 */
function caretOf(): [number, number] {
  const el = srcEl.value;
  if (!el) {
    const len = srcText.value.length;
    return [len, len];
  }
  return [el.selectionStart, el.selectionEnd];
}

function replaceRange(text: string, start: number, end: number) {
  srcText.value = text;
  const el = srcEl.value;
  if (el) {
    nextTick(() => {
      el.focus();
      el.setSelectionRange(start, end);
    });
  }
  emit("update", text);
}

function applySource(cmd: string): boolean {
  const [s, e] = caretOf();
  const res = transformSource(cmd, srcText.value, s, e);
  if (!res) return false;
  replaceRange(res.text, res.start, res.end);
  return true;
}

export type EditorCommand =
  | "bold"
  | "italic"
  | "strike"
  | "inlineCode"
  | "bulletList"
  | "orderedList"
  | "blockquote"
  | "codeBlock"
  | "hr"
  | "table"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "paragraph"
  | "indent"
  | "outdent"
  | "undo"
  | "redo";

const heading = (level: number) => () => callCommand(wrapInHeadingCommand.key, level);

/**
 * Milkdown 的命令必须经 `callCommand(key, payload)` 包成 `(ctx) => boolean`
 * 才能交给 `editorRef.action()`；直接传裸 command 会被当成 ctx 回调调用，
 * dispatch 为 undefined → 命令静默失效。
 */
const commandMap: Record<EditorCommand, () => unknown> = {
  bold: () => callCommand(toggleStrongCommand.key),
  italic: () => callCommand(toggleEmphasisCommand.key),
  strike: () => callCommand(toggleStrikethroughCommand.key),
  inlineCode: () => callCommand(toggleInlineCodeCommand.key),
  bulletList: () => callCommand(wrapInBulletListCommand.key),
  orderedList: () => callCommand(wrapInOrderedListCommand.key),
  blockquote: () => callCommand(wrapInBlockquoteCommand.key),
  codeBlock: () => callCommand(createCodeBlockCommand.key),
  hr: () => callCommand(insertHrCommand.key),
  table: () => callCommand(insertTableCommand.key, { row: 3, col: 3 }),
  h1: heading(1),
  h2: heading(2),
  h3: heading(3),
  h4: heading(4),
  h5: heading(5),
  h6: heading(6),
  paragraph: () => callCommand(turnIntoTextCommand.key),
  indent: () => callCommand(sinkListItemCommand.key),
  outdent: () => callCommand(liftListItemCommand.key),
  undo: () => callCommand(undoCommand.key),
  redo: () => callCommand(redoCommand.key),
};

async function exec(cmd: EditorCommand): Promise<boolean> {
  if (props.source) {
    // 撤销 / 重做交回浏览器原生栈，其余命令直接改文本
    if (cmd === "undo" || cmd === "redo") {
      srcEl.value?.focus();
      document.execCommand(cmd);
      return true;
    }
    return applySource(cmd);
  }
  try {
    const editor = await ready();
    const build = commandMap[cmd];
    if (!build) return false;
    editor.action(build() as never);
    return true;
  } catch (e) {
    console.error("[LiteMark] 命令执行失败：", cmd, e);
    return false;
  }
}

/* ---------- 图片 ---------- */
const hostRef = ref<HTMLElement | null>(null);
/** 原路径 → 可显示的 blob URL */
const urlCache = new Map<string, string>();
/** 读取失败的路径，不再重复尝试 */
const failed = new Set<string>();
/** 正在读取的路径 */
const pending = new Set<string>();
/** img 元素 → 它在文档里的原始 src（防止被 blob URL 覆盖后丢失原值） */
const originMap = new WeakMap<HTMLImageElement, string>();
let observer: MutationObserver | null = null;

/** 本来就能直接显示的地址（远程 / 内嵌 / 已转换） */
const isDisplayable = (src: string) => /^(https?:|data:|blob:|file:)/i.test(src);

function markMissing(img: HTMLImageElement, original: string) {
  img.classList.add("lm-img-missing");
  img.title = `无法读取本地图片：${original}`;
}

function applyImg(img: HTMLImageElement) {
  const src = img.getAttribute("src") || "";
  if (!src) return;

  let original = originMap.get(img);
  if (!original) {
    if (isDisplayable(src)) return; // 已经是可直接显示的地址
    original = src;
    originMap.set(img, original);
  }

  const cached = urlCache.get(original);
  if (cached) {
    if (src !== cached) img.setAttribute("src", cached);
    img.classList.remove("lm-img-missing");
    return;
  }
  if (failed.has(original)) {
    markMissing(img, original);
    return;
  }
  if (pending.has(original)) return;

  pending.add(original);
  localImageBlobUrl(original).then((url) => {
    pending.delete(original);
    if (!url) {
      failed.add(original);
      document
        .querySelectorAll<HTMLImageElement>("img")
        .forEach((el) => {
          if (originMap.get(el) === original) markMissing(el, original);
        });
      return;
    }
    urlCache.set(original, url);
    document.querySelectorAll<HTMLImageElement>("img").forEach((el) => {
      if (originMap.get(el) === original) {
        el.setAttribute("src", url);
        el.classList.remove("lm-img-missing");
      }
    });
  });
}

/** 扫描编辑器里的 img，把本地路径换成可显示的 blob URL（只改 DOM，不动 Markdown） */
function syncImages() {
  hostRef.value?.querySelectorAll<HTMLImageElement>("img").forEach(applyImg);
}

onMounted(() => {
  const root = hostRef.value;
  if (!root) return;
  observer = new MutationObserver(() => syncImages());
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  });
  syncImages();
});

onBeforeUnmount(() => observer?.disconnect());

/**
 * 链接条改完地址后回调：那个 img 缓存的原值已经作废，必须丢掉，
 * 否则 syncImages 会拿旧 original 去查 cache，把图又换回原来那张。
 */
function onImageChanged(img: HTMLImageElement) {
  originMap.delete(img);
  window.setTimeout(syncImages, 20);
}

/** 插入图片节点（src 写原值，预览另做转换）；源码模式下直接写 Markdown */
async function insertImage(src: string, alt = "图片", title = ""): Promise<void> {
  if (!src) return;
  if (props.source) {
    const [s, e] = caretOf();
    const md = `![${alt}](${src}${title ? ` "${title}"` : ""})`;
    const t = srcText.value;
    replaceRange(t.slice(0, s) + md + t.slice(e), s + md.length, s + md.length);
    return;
  }
  try {
    const editor = await ready();
    editor.action(
      callCommand(insertImageCommand.key, { src, alt, title }) as never,
    );
    // DOM 变化后补一次，避免 observer 批量回调时序问题
    window.setTimeout(syncImages, 30);
  } catch (e) {
    console.error("[LiteMark] 插入图片失败：", e);
  }
}

/** 粘贴图片：落盘到临时目录后引用绝对路径（开了图床则先上传）；浏览器模式退回 data URL */
async function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items;
  if (!items) return;
  let file: File | null = null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === "file" && it.type.startsWith("image/")) {
      file = it.getAsFile();
      break;
    }
  }
  if (!file) return;
  // capture 阶段先拦下，避免 ProseMirror 再插入一份
  e.preventDefault();
  e.stopPropagation();
  const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
  const b64 = await fileToBase64(file);
  if (inNL) {
    const saved = await saveClipboardImage(b64, ext);
    if (saved) {
      const c = loadPicgo();
      if (c.on && c.onPaste) {
        emit("notify", { msg: "正在上传到图床…" });
        const up = await picgoUpload(c.server, saved);
        if (up.url) {
          await insertImage(up.url, "粘贴的图片");
          return;
        }
        // 上传失败不打断：退回本地路径，但要让用户知道
        emit("notify", {
          msg: `图床上传失败，已用本地路径：${up.error}`,
          bad: true,
        });
      }
      await insertImage(saved, "粘贴的图片");
      return;
    }
  }
  await insertImage(`data:${file.type};base64,${b64}`, "粘贴的图片");
}

defineExpose({ exec, insertImage });
</script>

<template>
  <div
    ref="hostRef"
    class="editor-scroll"
    :class="{ 'src-mode': source }"
    @paste.capture="onPaste"
  >
    <div class="editor-page">
      <Milkdown v-show="!source" />
      <textarea
        v-if="source"
        ref="srcEl"
        v-model="srcText"
        class="src-area"
        spellcheck="false"
        @input="onSourceInput"
      />
    </div>
    <TableHandles :host="hostRef" :source="!!source" :editor="ready" />
    <ImageBar
      :host="hostRef"
      :source="!!source"
      :editor="ready"
      :changed="onImageChanged"
      @notify="(p) => emit('notify', p)"
    />
    <CodeLang :host="hostRef" :source="!!source" :editor="ready" />
  </div>
</template>
