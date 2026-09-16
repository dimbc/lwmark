/**
 * 代码块高亮的视图层：遍历文档里的 code_block，把 highlight.ts 算出的 token 区间
 * 转成 ProseMirror 的 inline Decoration。
 *
 * 纯视图层：不动文档、不进撤销栈，保存出来的 Markdown 与原来完全一致
 * （围栏里的语言标记也照旧由 code_block 的 language attr 负责）。
 *
 * decorations 由 state 驱动，输入 / 换选区都会重算；tokenize 结果在 highlight.ts 里
 * 带缓存，所以重复计算只发生在「代码真的变了」的时候。
 */
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorState } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";
import { highlight, resolveLang } from "./highlight";

/** 超长代码块不上色：一屏都放不下的块，上色收益低但每次重算都要跑正则 */
const MAX_LEN = 20000;

/**
 * 算出整篇文档的高亮 decorations。
 *
 * 单独导出是为了能脱离 DOM 做无头验证（造一个带 code_block 的 EditorState，
 * 直接调它，核对每个区间的偏移与类名），线上只有插件在用。
 */
export function buildCodeDecorations(state: EditorState): DecorationSet {
  const decos: Decoration[] = [];

  state.doc.descendants((node, pos) => {
    if (node.type.name !== "code_block") return true;
    const lang = resolveLang(String(node.attrs.language ?? ""));
    // 没标语言就保持素色；返回 false 表示不再往里遍历（代码块里只有文本）
    if (!lang) return false;

    const code = node.textContent;
    if (code.length > MAX_LEN) return false;

    // pos 是节点之前的位置，内容从 pos + 1 开始
    const base = pos + 1;
    for (const t of highlight(code, lang)) {
      decos.push(Decoration.inline(base + t.from, base + t.to, { class: t.cls }));
    }
    return false;
  });

  return decos.length ? DecorationSet.create(state.doc, decos) : DecorationSet.empty;
}

export const codeHighlight = $prose(
  () =>
    new Plugin({
      key: new PluginKey("lmCodeHighlight"),
      props: { decorations: (state) => buildCodeDecorations(state) },
    }),
);
