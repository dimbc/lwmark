/**
 * 标题折叠：鼠标移到标题行时左侧浮出一枚小箭头，点一下把它「辖下」的内容收起来。
 *
 * 纯视图层 —— 被折起来的块只是挂个 class 由 CSS 隐藏（`display:none`），
 * 文档一个字都不动：
 *   · 保存 / 导出 / 字数统计拿到的 Markdown 与展开时完全一致
 *   · 折叠不进撤销栈，Ctrl+Z 不会「撤销掉一次折叠」
 *
 * 折叠集合存在 plugin state 里（`Set<标题起始位置>`），位置随 `tr.mapping` 走，
 * 所以边折叠边编辑不会串位；跨会话「按文件记住」由外部通过 setFoldIO 注入读写，
 * 标题转成 `级别|文本|第几次出现` 这样的 key —— 文本没改的标题，重新打开仍能对上。
 *
 * ⚠️ 四个实测要点：
 *   1. 只处理**顶层**标题。引用块 / 列表项里的标题不给箭头 —— 折叠范围要按「同一
 *      父节点里往后扫到同级标题」算，嵌套场景下把兄弟块整体 `display:none` 会牵动
 *      ProseMirror 的 DOM 测量，收益不值这个风险。
 *   2. 折叠区间严格从标题的**下一个兄弟**开始，不含标题自身。否则光标停在标题上
 *      就被判成「躲进折叠区」而自动弹开，看着像点了没反应。
 *   3. 选区一旦落进折叠区（方向键能钻进去），必须立刻展开，否则 ProseMirror 要在
 *      `display:none` 的节点里找 DOM 位置，选区会错乱。
 *   4. 箭头用绝对定位、以标题元素为包含块（`left: -22px`），所以在文档流里占 0 宽。
 *      这样它插在哪个位置都不影响排版，也不会和 srcMarks 的 `## ` 前缀抢位子。
 */
import { Plugin, PluginKey, TextSelection } from "@milkdown/kit/prose/state";
import type { EditorState, Transaction } from "@milkdown/kit/prose/state";
import type { Node as PMNode } from "@milkdown/kit/prose/model";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { EditorView } from "@milkdown/kit/prose/view";
import { $prose } from "@milkdown/kit/utils";

export interface FoldState {
  /** 被折叠的顶层标题的起始位置 */
  folded: Set<number>;
}

/** 插件 meta：三种一次性指令，不走文档、不进撤销栈 */
interface FoldMeta {
  /** 整体替换（恢复上次的折叠） */
  set?: number[];
  /** 收起 / 展开某一个 */
  toggle?: number;
  /** 只展开某一个 */
  remove?: number;
}

export const headingFoldKey = new PluginKey<FoldState>("lmHeadingFold");

/* ---------- 文档结构 ---------- */

interface Head {
  /** 标题节点起始位置 */
  pos: number;
  level: number;
  /** 辖下内容的区间 [from, to)。空标题时 from === to */
  from: number;
  to: number;
  text: string;
}

/**
 * 扫一遍顶层节点，算出每个标题「辖下」的范围。
 *
 * 用栈表达层级：遇到 H2 就把它上面所有 level ≥ 2 的标题封口。所以折叠 H1 会把
 * 它下面的 H2 / H3 连同正文一起藏掉，H2 折起来又不影响前面那个 H1 的其余部分。
 */
function scanHeads(doc: PMNode): Head[] {
  const heads: Head[] = [];
  const open: Head[] = [];

  const closeFrom = (level: number, end: number) => {
    while (open.length && open[open.length - 1].level >= level) open.pop()!.to = end;
  };

  doc.forEach((node, offset) => {
    const end = offset + node.nodeSize;
    if (node.type.name === "heading") {
      const level = Number(node.attrs.level) || 1;
      closeFrom(level, offset); // 上一个同级（或更浅）标题的内容止于这里
      const h: Head = { pos: offset, level, from: end, to: end, text: node.textContent };
      heads.push(h);
      open.push(h);
      return;
    }
    // 非标题：所有还开着的标题，内容都延到这里
    for (const h of open) h.to = end;
  });

  const docEnd = doc.content.size;
  for (const h of open) h.to = docEnd;
  return heads;
}

/* ---------- 与外部（持久化）的接口 ---------- */

/** 由宿主注入的读写；不注入就纯粹不记忆 */
let foldIO: { load: () => string[]; save: (keys: string[]) => void } | null = null;

export function setFoldIO(io: { load: () => string[]; save: (keys: string[]) => void } | null): void {
  foldIO = io;
}

/**
 * 给每个标题编一个稳定的 key：`级别|文本|同级同文本的第几次出现`。
 * 位置会随编辑漂移，文本基本不会 —— 所以用文本当身份，重新打开时还能对上。
 */
function headIndex(doc: PMNode): { key: string; pos: number }[] {
  const seq = new Map<string, number>();
  return scanHeads(doc).map((h) => {
    const base = `${h.level}|${h.text}`;
    const n = (seq.get(base) ?? 0) + 1;
    seq.set(base, n);
    return { key: `${base}|${n}`, pos: h.pos };
  });
}

/* ---------- 大纲快照（给侧栏大纲面板用） ---------- */

export interface OutlineItem {
  key: string;
  level: number;
  text: string;
  folded: boolean;
  /** 辖下有没有内容：没有就不给箭头 */
  hasKids: boolean;
  /** 祖先标题处于折叠态：大纲里这一条要整条藏起来（树形收起） */
  hidden?: boolean;
  /** 仅源码模式的文本大纲带：0 起的行号 */
  line?: number;
}

export interface OutlineSnapshot {
  items: OutlineItem[];
  /** 光标所在的最深标题 key；不在任何标题里为 null */
  activeKey: string | null;
}

/** 编辑器 → 宿主的推流通道；宿主在编辑器创建前注册 */
let reporter: ((snap: OutlineSnapshot) => void) | null = null;

export function setFoldReporter(fn: ((snap: OutlineSnapshot) => void) | null): void {
  reporter = fn;
}

/** 由当前文档状态算一份大纲快照（纯函数，可重复调） */
export function snapshot(state: EditorState): OutlineSnapshot {
  const st = headingFoldKey.getState(state);
  const heads = scanHeads(state.doc);
  const seq = new Map<string, number>();
  // 树形收起：某个标题折着，它后面所有比它深的条目都算「藏起来」，
  // 直到出现同级或更浅的条目为止（大纲列表与正文折叠表现一致）
  let hiddenAbove: number | null = null;
  const items = heads.map((h) => {
    const base = `${h.level}|${h.text}`;
    const n = (seq.get(base) ?? 0) + 1;
    seq.set(base, n);
    let hidden = false;
    if (hiddenAbove != null) {
      if (h.level > hiddenAbove) hidden = true;
      else hiddenAbove = null;
    }
    const folded = st?.folded.has(h.pos) ?? false;
    if (folded && !hidden && h.to > h.from) hiddenAbove = h.level;
    return {
      key: `${base}|${n}`,
      level: h.level,
      text: h.text,
      folded,
      hasKids: h.to > h.from,
      hidden,
    };
  });

  // 倒序找第一个「范围罩住光标」的标题：包含关系下 pos 更靠后 = 更深
  const { from } = state.selection;
  let activeKey: string | null = null;
  for (let i = heads.length - 1; i >= 0; i--) {
    if (from >= heads[i].pos && from < heads[i].to) {
      activeKey = items[i].key;
      break;
    }
  }
  return { items, activeKey };
}

/** 按大纲 key 找标题位置；找不到（被删了 / 文本对不上）返回 -1 */
export function headingPosByKey(state: EditorState, key: string): number {
  for (const h of headIndex(state.doc)) if (h.key === key) return h.pos;
  return -1;
}

/** 源码模式的大纲：按行解析 Markdown，跳过代码块围栏里的 # */
export function parseTextOutline(text: string): OutlineItem[] {
  const out: OutlineItem[] = [];
  const seq = new Map<string, number>();
  let fence: string | null = null;
  const lines = text.split(/\r\n|\r|\n/);
  lines.forEach((line, i) => {
    const f = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return;
    }
    if (fence) return;
    const h = line.match(/^(#{1,6})\s+(.*)\S\s*$/);
    if (!h) return;
    const level = h[1].length;
    const base = `${level}|${h[2]}`;
    const n = (seq.get(base) ?? 0) + 1;
    seq.set(base, n);
    out.push({ key: `${base}|${n}`, level, text: h[2], folded: false, hasKids: false, line: i });
  });
  return out;
}

/** 当前折叠状态 → 可持久化的 key 列表 */
export function readFoldedKeys(state: EditorState): string[] {
  const st = headingFoldKey.getState(state);
  if (!st || !st.folded.size) return [];
  return headIndex(state.doc)
    .filter((h) => st.folded.has(h.pos))
    .map((h) => h.key);
}

/** 把 key 列表还原成折叠状态（对不上的直接丢掉，不报错） */
export function applyFoldedKeys(view: EditorView, keys: string[]): void {
  if (!keys.length) return;
  const want = new Set(keys);
  const pos = headIndex(view.state.doc)
    .filter((h) => want.has(h.key))
    .map((h) => h.pos);
  if (!pos.length) return;
  view.dispatch(view.state.tr.setMeta(headingFoldKey, { set: pos } as FoldMeta));
}

/* ---------- 折叠 / 展开 ---------- */

/** 收起或展开某个标题；折叠时若光标正躲在这一节里，把它提到标题上 */
export function toggleFold(view: EditorView, pos: number): void {
  const st = headingFoldKey.getState(view.state);
  if (!st) return;
  const willFold = !st.folded.has(pos);
  const tr = view.state.tr.setMeta(headingFoldKey, { toggle: pos } as FoldMeta);

  if (willFold) {
    const head = scanHeads(view.state.doc).find((h) => h.pos === pos);
    const { from } = view.state.selection;
    if (head && head.to > head.from && from >= head.from && from <= head.to) {
      // 光标就在被收起的那一段里：提到标题行末，否则折完立刻又被 autoUnfold 弹开
      tr.setSelection(TextSelection.near(view.state.doc.resolve(head.pos + 1), 1));
    }
  }
  view.dispatch(tr);
}

/** 选区钻进折叠区就地展开（方向键能钻进去，不展开选区会错乱） */
function autoUnfold(view: EditorView): void {
  const st = headingFoldKey.getState(view.state);
  if (!st || !st.folded.size) return;
  const { from, to } = view.state.selection;
  for (const h of scanHeads(view.state.doc)) {
    if (!st.folded.has(h.pos) || h.to <= h.from) continue;
    if (from >= h.from && to <= h.to) {
      view.dispatch(view.state.tr.setMeta(headingFoldKey, { remove: h.pos } as FoldMeta));
      return;
    }
  }
}

/* ---------- 视图 ---------- */

/** 向下的 chevron；折叠态整体转 -90° 就是向右，等于「收起来了」 */
const ARROW = "M2.7 4.4 6.5 8.2 10.3 4.4";

function foldButton(pos: number, folded: boolean, view: () => EditorView | null): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "lm-fold-anchor";
  wrap.setAttribute("contenteditable", "false");
  wrap.setAttribute("aria-hidden", "true");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.tabIndex = -1;
  btn.className = "lm-fold-btn" + (folded ? " folded" : "");
  btn.title = folded ? "展开这一节" : "折叠这一节";
  btn.innerHTML =
    '<svg viewBox="0 0 13 13" width="13" height="13" fill="none" stroke="currentColor"' +
    ' stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    `<path d="${ARROW}"/></svg>`;

  // mousedown 必须拦掉：不抢焦点、不起拖选，否则点一下先把光标甩进标题
  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const v = view();
    if (v) toggleFold(v, pos);
  });

  wrap.appendChild(btn);
  return wrap;
}

function build(
  state: EditorState,
  make: (pos: number, folded: boolean) => HTMLElement,
): DecorationSet {
  const st = headingFoldKey.getState(state);
  const folded = st?.folded ?? new Set<number>();
  const heads = scanHeads(state.doc);
  const decos: Decoration[] = [];

  // 折叠区间：只有真有内容的标题才算，合不合并都无所谓（下面按顶层节点整体判断）
  const ranges = heads
    .filter((h) => folded.has(h.pos) && h.to > h.from)
    .map((h) => ({ from: h.from, to: h.to }));

  if (ranges.length) {
    state.doc.forEach((node, offset) => {
      const end = offset + node.nodeSize;
      if (ranges.some((r) => offset >= r.from && end <= r.to)) {
        decos.push(Decoration.node(offset, end, { class: "lm-fold-hidden" }));
      }
    });
  }

  for (const h of heads) {
    if (h.to <= h.from) continue; // 空标题：没东西可折，不出箭头
    const on = folded.has(h.pos);
    decos.push(
      Decoration.widget(h.pos + 1, () => make(h.pos, on), {
        key: `lm-fold:${h.pos}:${on ? 1 : 0}`,
        side: -1,
        stopEvent: () => true,
      }),
    );
  }

  return decos.length ? DecorationSet.create(state.doc, decos) : DecorationSet.empty;
}

/**
 * 插件本体。单独导出工厂：Node 侧能脱离 Milkdown 容器做状态级集成测试
 * （apply / snapshot / toggle 逻辑），编辑器里仍走 $prose 挂载。
 */
export function makeHeadingFoldPlugin(): Plugin<FoldState> {
  // 插件实例自己的 view 引用；widget 的点击靠它 dispatch，不用全局变量
  let view: EditorView | null = null;

  return new Plugin<FoldState>({
    key: headingFoldKey,
    state: {
      init: () => ({ folded: new Set<number>() }),
      apply: (tr: Transaction, value: FoldState, _old, newState) => {
        const meta = tr.getMeta(headingFoldKey) as FoldMeta | undefined;
        if (meta?.set) return { folded: new Set(meta.set) };
        if (meta?.toggle != null) {
          const next = new Set(value.folded);
          if (next.has(meta.toggle)) next.delete(meta.toggle);
          else next.add(meta.toggle);
          return { folded: next };
        }
        if (meta?.remove != null) {
          if (!value.folded.has(meta.remove)) return value;
          const next = new Set(value.folded);
          next.delete(meta.remove);
          return { folded: next };
        }
        if (!tr.docChanged || !value.folded.size) return value;
        // 位置随编辑走，标题被删掉的（deleted）就丢掉
        const next = new Set<number>();
        for (const pos of value.folded) {
          const r = tr.mapping.mapResult(pos);
          if (!r.deleted) next.add(r.pos);
        }
        return next.size || value.folded.size ? { folded: next } : value;
      },
    },
    props: {
      decorations: (state) => build(state, (pos, folded) => foldButton(pos, folded, () => view)),
    },
    view: (v) => {
      view = v;
      // 恢复上次的折叠。view 刚建好就 dispatch 会让某些插件拿不到完整状态，推到下一拍
      window.setTimeout(() => {
        if (view !== v) return;
        const saved = foldIO?.load();
        if (saved?.length) applyFoldedKeys(v, saved);
        reporter?.(snapshot(v.state));
      }, 0);

      return {
        // ⚠️ PM 的插件视图 update 签名是 (view, prevState)：nv 是 EditorView，
        // prev 已经是旧 EditorState（不是旧 view，没有 .state）——写成 prev.state
        // 会在第一次 dispatch 时抛 TypeError，把推流和持久化一起炸掉
        update: (nv, prev) => {
          view = nv;
          autoUnfold(nv);
          // 文档 / 选区 / 折叠集任一变了，大纲面板就要跟着刷新
          const changed =
            nv.state.doc !== prev.doc ||
            nv.state.selection !== prev.selection ||
            headingFoldKey.getState(nv.state)?.folded !==
              headingFoldKey.getState(prev)?.folded;
          if (changed) reporter?.(snapshot(nv.state));
          // 集合每次变更都是新对象，引用不等即「折叠状态变了」
          const now = headingFoldKey.getState(nv.state)?.folded;
          const was = headingFoldKey.getState(prev)?.folded;
          if (now !== was) foldIO?.save(readFoldedKeys(nv.state));
        },
        destroy: () => {
          view = null;
        },
      };
    },
  });
}

export const headingFold = $prose(() => makeHeadingFoldPlugin());
