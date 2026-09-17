/**
 * HTML 支持的「完整版」：md 文件里的 HTML 在即时渲染模式下显示真实渲染效果，
 * 存盘原样写回（无损），编辑走源码模式。
 *
 * Milkdown 的 commonmark preset 自带一个 `html` 原子节点（inline atom，value 存
 * 原始 HTML 文本，序列化原样输出）——但它把 HTML 当**源码文本**显示。这里在它
 * 之上补两块：
 *
 *   1. lmHtmlPair（remark 预处理）：把段落 / 标题里成对的行内标签
 *      `<mark>xx</mark>`（含嵌套 `<b><i>x</i></b>`）合并成一个 html 节点，
 *      值 = 各 mdast 节点原文拼接 —— 否则一对标签会变成两个孤立原子，中间文字
 *      还露在编辑器里，渲染不出来。只吞 text / html 节点，中间出现 strong、em
 *      等 markdown 语法就不合并（保持现状的源码小块），保证往返无损。
 *
 *   2. htmlNodeView（NodeView）：把 html 节点渲染成真实效果。
 *      · 渲染进 **Shadow DOM**：文件里的 `<style>`、class 命名都不会污染编辑器 UI
 *      · 渲染前过一遍净化器：剥 `<script>/<iframe>` 等、on* 属性、javascript: 链接
 *      · 「成对 / void 标签」才渲染；孤立开 / 闭标签回退成源码小块（和旧行为一致）
 *      · 多行或块级标签（div/table/details…）按块显示，其余按行内显示
 *      · 双击切换 渲染 ↔ 源码 查看；点击渲染区里的 <a> 一律拦截（防 WebView 被导航走）
 *
 * 值永远存在 attrs.value 里原样进出，文档侧不碰一个字节。
 */
import type { Ctx } from "@milkdown/kit/ctx";
import { nodeViewCtx, SchemaReady } from "@milkdown/kit/core";
import type { Node as PMNode } from "@milkdown/kit/prose/model";
import type { NodeView, NodeViewConstructor } from "@milkdown/kit/prose/view";
import { $remark } from "@milkdown/kit/utils";

/* ---------------- 标签分析 ---------------- */

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** 行内渲染时按块显示的标签（多行值也一律按块） */
const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "canvas", "center", "colgroup",
  "dd", "details", "dialog", "div", "dl", "dt", "fieldset", "figcaption",
  "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "head",
  "header", "hgroup", "hr", "html", "legend", "li", "main", "menu", "nav",
  "ol", "optgroup", "option", "p", "picture", "pre", "section", "select",
  "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
  "video", "audio",
]);

interface TagInfo { name: string; kind: "open" | "close" | "void" }

/** 读出一段 html 文本的第一个标签。不是标签（或残缺）返回 null。 */
function firstTag(text: string): TagInfo | null {
  const m = /^<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/.exec(text.trim());
  if (!m) return null;
  const name = m[2].toLowerCase();
  if (m[1]) return { name, kind: "close" };
  if (m[3] || VOID_TAGS.has(name)) return { name, kind: "void" };
  return { name, kind: "open" };
}

/* ---------------- remark 预处理：合并成对的行内标签 ---------------- */

interface MdNode { type: string; value?: string; children?: MdNode[] }

function mergeInlineHtml(children: MdNode[]): MdNode[] {
  const out: MdNode[] = [];
  let i = 0;
  while (i < children.length) {
    const c = children[i];
    const info = c && c.type === "html" && typeof c.value === "string" ? firstTag(c.value) : null;
    if (!info || info.kind !== "open") {
      if (c) out.push(c);
      i++;
      continue;
    }
    // 向后找同层同名闭合；中间只允许 text / html（嵌套标签靠深度计数吞进去）
    let depth = 1;
    let j = i + 1;
    let paired = -1;
    for (; j < children.length; j++) {
      const n = children[j];
      if (!n) break;
      if (n.type === "text") continue;
      if (n.type !== "html") break;
      const ni = firstTag(n.value ?? "");
      if (!ni) break;
      if (ni.kind === "open") depth++;
      else if (ni.kind === "close") {
        if (depth > 1) depth--;
        else if (ni.name === info.name) { paired = j; break; }
        else break;
      }
      // void：继续吞
    }
    if (paired > i) {
      const value = children.slice(i, paired + 1).map((n) => n.value ?? "").join("");
      out.push({ type: "html", value });
      i = paired + 1;
    } else {
      out.push(c);
      i++;
    }
  }
  return out;
}

/**
 * 注册顺序在 commonmark 之后：它的 remarkHTMLTransformer 已把块级 HTML 包进
 * paragraph，所以这里只需要处理 paragraph / heading 的行内 children。
 */
export const lmHtmlPair = $remark("lmHtmlPair", () => () => (tree: MdNode) => {
  const walk = (node: MdNode): void => {
    const kids = node.children;
    if (!kids) return;
    let next = kids;
    if (node.type === "paragraph" || node.type === "heading") {
      next = mergeInlineHtml(kids);
      node.children = next;
    }
    for (const k of next) walk(k);
  };
  walk(tree);
});

/* ---------------- 渲染前净化 ---------------- */

const BAD_TAGS = "script,iframe,frame,frameset,object,embed,link,meta,base,portal";
const URL_ATTRS = ["href", "src", "xlink:href", "action", "formaction", "poster"];

function sanitize(src: string): string {
  const tpl = document.createElement("template");
  tpl.innerHTML = src;
  tpl.content.querySelectorAll(BAD_TAGS).forEach((el) => el.remove());
  tpl.content.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) { el.removeAttribute(attr.name); continue; }
      if (URL_ATTRS.includes(name)) {
        const v = attr.value.trim().toLowerCase();
        if (v.startsWith("javascript:") || (v.startsWith("data:") && !v.startsWith("data:image"))) {
          el.removeAttribute(attr.name);
        }
      }
    }
  });
  return tpl.innerHTML;
}

/* ---------------- NodeView ---------------- */

/** 能不能渲染：成对标签或单个 void 标签才渲染，孤开 / 闭标签回退源码小块 */
function renderable(text: string): { ok: boolean; block: boolean } {
  const t = text.trim();
  const first = firstTag(t);
  if (!first) return { ok: false, block: false };
  if (first.kind === "void") return { ok: true, block: BLOCK_TAGS.has(first.name) };
  if (first.kind !== "open") return { ok: false, block: false };
  if (new RegExp(`</${first.name}\\s*>`, "i").test(t)) {
    return { ok: true, block: t.includes("\n") || BLOCK_TAGS.has(first.name) };
  }
  // 没有闭合标签：块级（多行）值照常渲染 —— 徽章类 HTML 的 </div> 常隔空行另起一段，
  // Shadow DOM 里浏览器会自动闭合，源码不受影响；行内的孤立开标签渲染不出东西，保持源码块
  if (t.includes("\n")) return { ok: true, block: true };
  return { ok: false, block: false };
}

class HtmlAtomView implements NodeView {
  dom: HTMLElement;
  private shadow: ShadowRoot;
  private node: PMNode;
  private showRaw = false;
  private onClick = (e: Event): void => {
    // 渲染区里的链接只拦不放：WebView 里导航走 = 编辑器整个被顶掉
    const target = e.target as Element | null;
    if (target && target.closest("a")) e.preventDefault();
  };
  private onDblClick = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
    this.showRaw = !this.showRaw;
    this.render();
  };

  constructor(node: PMNode) {
    this.node = node;
    const block = renderable(String(node.attrs.value ?? "")).block;
    this.dom = document.createElement(block ? "div" : "span");
    this.dom.className = "lm-html-host";
    this.dom.setAttribute("contenteditable", "false");
    this.dom.setAttribute("data-html-host", "");
    this.shadow = this.dom.attachShadow({ mode: "open" });
    this.dom.addEventListener("dblclick", this.onDblClick);
    this.dom.addEventListener("click", this.onClick, true);
    this.render();
  }

  private render(): void {
    const value = String(this.node.attrs.value ?? "");
    const info = renderable(value);
    if (this.showRaw || !info.ok) {
      this.dom.classList.add("lm-html-raw");
      this.dom.classList.toggle("lm-html-multiline", info.block || value.includes("\n"));
      this.shadow.innerHTML = "";
      const code = document.createElement("code");
      code.textContent = value;
      this.shadow.appendChild(code);
      return;
    }
    this.dom.classList.remove("lm-html-raw", "lm-html-multiline");
    this.dom.classList.toggle("lm-html-block", info.block);
    this.shadow.innerHTML = sanitize(value);
  }

  update(node: PMNode): boolean {
    if (node.type.name !== "html") return false;
    this.node = node;
    this.render();
    return true;
  }

  ignoreMutation(): boolean { return true; }
  stopEvent(e: Event): boolean { return e.type === "dblclick"; }
  selectNode(): void { this.dom.classList.add("lm-html-selected"); }
  deselectNode(): void { this.dom.classList.remove("lm-html-selected"); }
  destroy(): void {
    this.dom.removeEventListener("dblclick", this.onDblClick);
    this.dom.removeEventListener("click", this.onClick, true);
  }
}

/**
 * 给内置的 `html` 节点挂 NodeView。preset-commonmark 没导出 htmlSchema，
 * 所以不走 $view，直接往 nodeViewCtx 塞一条（key = PM 节点名 "html"）。
 * nodeViewCtx 的官方类型标成了 NodeView[]（按 mark 布局推的），实际存的是
 * [节点名, 构造器] 二元组 —— 这里按实际运行时形状操作。
 */
type NodeViewEntry = [string, NodeViewConstructor];

export const htmlNodeView = (ctx: Ctx) => async () => {
  await ctx.wait(SchemaReady);
  ctx.update(nodeViewCtx, ((ps: NodeViewEntry[]) => [
    ...ps,
    ["html", (node: PMNode) => new HtmlAtomView(node)],
  ]) as never);
  return () => {
    ctx.update(nodeViewCtx, ((ps: NodeViewEntry[]) =>
      ps.filter((x) => x[0] !== "html")) as never);
  };
};
