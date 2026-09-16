/**
 * 所见即所得模式下，把光标所在这一行的 Markdown 标记就地显示出来（Typora 风）。
 *
 * 走 ProseMirror 的 Decoration —— 纯视图层，**不改文档**，所以不影响保存内容、
 * 不进入撤销栈：
 *   - 块级前缀（## / > / - / 1. / ```lang）插在该行内容起点
 *   - 行内标记（** * ~~ ` [ ](url)）按每个 mark 的起止位置各插一个零宽 widget
 *
 * decorations 由 state 驱动，每次输入 / 光标移动都会重算，标记因此随文本实时变动。
 *
 * ⚠️ 两个实测要点：
 *   1. 块级前缀必须插在 `$from.start()`（textblock 内容里），不能插在 `$from.before()`。
 *      插在块外时，行内 span 夹在两个块元素之间会被浏览器包成匿名块，前缀会单独占一行。
 *   2. GFM 删除线的 schema id 是 `strike_through`，不是 `strikethrough`。
 */
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import type { EditorState } from "@milkdown/kit/prose/state";
import type { Mark, ResolvedPos } from "@milkdown/kit/prose/model";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

/** 受支持的 mark → [开标记, 闭标记] */
const TOKENS: Record<string, (m: Mark) => [string, string]> = {
  strong: () => ["**", "**"],
  emphasis: () => ["*", "*"],
  strike_through: () => ["~~", "~~"],
  inlineCode: () => ["`", "`"],
  link: (m) => ["[", `](${m.attrs.href ?? ""})`],
};

/** 中文输入法组字期间不重算行内标记：widget 频繁增删会打断组字 */
let composing = false;

function tokAt(
  text: string,
  kind: "pre" | "open" | "end",
  key: string,
  pos: number,
  side: number,
): Decoration {
  const dom = document.createElement("span");
  dom.className = `lm-src-tok lm-src-${kind}`;
  dom.textContent = text;
  dom.setAttribute("contenteditable", "false");
  dom.setAttribute("aria-hidden", "true");
  return Decoration.widget(pos, dom, { key, side });
}

/** 这一行的块级前缀：引用符 / 列表符号 / 标题井号 / 代码围栏 */
function blockPrefix($from: ResolvedPos): string {
  const parts: string[] = [];
  for (let d = 1; d <= $from.depth; d++) {
    const name = $from.node(d).type.name;
    if (name === "blockquote") {
      parts.push("> ");
    } else if (name === "list_item") {
      const parent = $from.node(d - 1);
      if (parent.type.name === "ordered_list") {
        const start = Number(parent.attrs.start ?? 1) || 1;
        parts.push(`${start + $from.index(d - 1)}. `);
      } else if (parent.type.name === "bullet_list") {
        parts.push("- ");
      }
    }
  }
  const self = $from.parent;
  if (self.type.name === "heading") {
    parts.push("#".repeat(Number(self.attrs.level) || 1) + " ");
  } else if (self.type.name === "code_block") {
    parts.push("```" + String(self.attrs.language ?? "") + "\n");
  }
  return parts.join("");
}

function build(state: EditorState): DecorationSet {
  const { selection } = state;
  const $from = selection.$from;
  if ($from.depth < 1) return DecorationSet.empty;
  const block = $from.parent;
  if (!block.isTextblock) return DecorationSet.empty;

  const out: Decoration[] = [];
  const start = $from.start();
  let n = 0;

  const prefix = blockPrefix($from);
  if (prefix) out.push(tokAt(prefix, "pre", `pre:${n++}`, start, -1));

  if (block.type.name === "code_block") {
    out.push(tokAt("```", "end", `fence:${n++}`, $from.end(), 1));
  } else if (!composing) {
    /** 上一个文本节点携带的标记，用于比较出「在这里开/闭了哪些标记」 */
    let prev: readonly Mark[] = [];

    const closed = (marks: readonly Mark[], pos: number) => {
      // 倒序：内层标记先闭合
      for (let i = marks.length - 1; i >= 0; i--) {
        const m = marks[i];
        const tok = TOKENS[m.type.name];
        if (tok) out.push(tokAt(tok(m)[1], "end", `c:${n++}`, pos, 1));
      }
    };

    block.content.forEach((child, offset) => {
      const pos = start + offset;
      const cur: readonly Mark[] = child.isText
        ? child.marks.filter((m) => TOKENS[m.type.name])
        : [];

      closed(
        prev.filter((m) => !cur.some((x) => x.eq(m))),
        pos,
      );
      for (const m of cur) {
        if (prev.some((x) => x.eq(m))) continue;
        const tok = TOKENS[m.type.name];
        if (tok) out.push(tokAt(tok(m)[0], "open", `o:${n++}`, pos, -1));
      }
      prev = cur;
    });

    closed(prev, $from.end());
  }

  // 稳定排序：同一位置按插入顺序（前缀在前、开标记在后）
  out.sort((a, b) => a.from - b.from);
  return DecorationSet.create(state.doc, out);
}

export const srcMarks = $prose(
  () =>
    new Plugin({
      key: new PluginKey("lmSrcMarks"),
      props: {
        decorations: (state) => build(state),
        handleDOMEvents: {
          compositionstart: () => {
            composing = true;
            return false;
          },
          compositionend: () => {
            composing = false;
            return false;
          },
        },
      },
      view: () => ({
        // 兜底：万一 compositionend 没走到，用 view 的实时状态把标志纠回来
        update: (v) => {
          if (!v.composing) composing = false;
        },
        destroy: () => {
          composing = false;
        },
      }),
    }),
);
