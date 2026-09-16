/* 源码模式下的 Markdown 文本变换：与 EditorPane 的 WYSIWYG 命令同名同义。
   全部是纯函数——传入文本 + 选区，返回新文本与新选区；undo / redo 交还浏览器原生栈。 */

export interface EditResult {
  text: string;
  /** 变换后应还原的选区 */
  start: number;
  end: number;
}

const lineStartOf = (t: string, i: number) => t.lastIndexOf("\n", i - 1) + 1;

function lineEndOf(t: string, i: number): number {
  const j = t.indexOf("\n", i);
  return j < 0 ? t.length : j;
}

/** 按行重写选区覆盖的整段文本，光标 / 选区一并映射到新位置 */
function rewriteLines(
  text: string,
  start: number,
  end: number,
  fn: (line: string) => string,
): EditResult {
  const bs = lineStartOf(text, start);
  const be = lineEndOf(text, end);
  const lines = text.slice(bs, be).split("\n");
  const mapped = lines.map(fn);

  const offs: number[] = [];
  let o = 0;
  for (const l of lines) {
    offs.push(o);
    o += l.length + 1;
  }

  const mapIdx = (idx: number) => {
    const rel = idx - bs;
    let i = 0;
    while (i + 1 < lines.length && offs[i + 1] <= rel) i++;
    let acc = 0;
    for (let k = 0; k < i; k++) acc += mapped[k].length - lines[k].length;
    // 空行加上前缀后光标落到前缀之后，可以直接接着写
    const inLine =
      start === end && lines[i] === ""
        ? mapped[i].length
        : Math.min(Math.max(rel - offs[i], 0), mapped[i].length);
    return bs + acc + offs[i] + inLine;
  };

  return {
    text: text.slice(0, bs) + mapped.join("\n") + text.slice(be),
    start: mapIdx(start),
    end: mapIdx(end),
  };
}

/** 行内标记：本身就带标记 → 去掉；标记在选区外侧 → 去掉；否则包上 */
function wrapSelection(
  text: string,
  start: number,
  end: number,
  mark: string,
): EditResult {
  const sel = text.slice(start, end);
  const ml = mark.length;

  if (sel.length >= ml * 2 && sel.startsWith(mark) && sel.endsWith(mark)) {
    const inner = sel.slice(ml, sel.length - ml);
    return {
      text: text.slice(0, start) + inner + text.slice(end),
      start,
      end: start + inner.length,
    };
  }

  const before = text.slice(Math.max(0, start - ml), start);
  const after = text.slice(end, end + ml);
  if (before === mark && after === mark) {
    return {
      text: text.slice(0, start - ml) + sel + text.slice(end + ml),
      start: start - ml,
      end: end - ml,
    };
  }

  return {
    text: text.slice(0, start) + mark + sel + mark + text.slice(end),
    start: start + ml,
    end: end + ml,
  };
}

/** 行级前缀（列表 / 引用）：整段都已是该前缀 → 去掉，否则统一替换成该前缀 */
function prefixLines(
  text: string,
  start: number,
  end: number,
  prefix: string,
  strip: RegExp,
  match: (line: string) => boolean,
): EditResult {
  const bs = lineStartOf(text, start);
  const be = lineEndOf(text, end);
  const scope = text.slice(bs, be).split("\n").filter((l) => l.trim() !== "");
  const all = scope.length > 0 && scope.every(match);
  return rewriteLines(text, start, end, (l) => {
    const bare = l.replace(strip, "");
    return all ? bare : prefix + bare;
  });
}

function heading(
  text: string,
  start: number,
  end: number,
  level: number,
): EditResult {
  const prefix = "#".repeat(level) + " ";
  const bs = lineStartOf(text, start);
  const be = lineEndOf(text, end);
  const scope = text.slice(bs, be).split("\n").filter((l) => l.trim() !== "");
  const all = scope.length > 0 && scope.every((l) => l.startsWith(prefix));
  return rewriteLines(text, start, end, (l) => {
    const bare = l.replace(/^#{1,6}\s+/, "");
    return all ? bare : prefix + bare;
  });
}

/** 块级插入：光标不在行首时先补一个换行，避免把所在行劈开 */
function insertBlock(
  text: string,
  start: number,
  end: number,
  inner: string,
  caretOffset: number,
): EditResult {
  const lead = start > 0 && text[start - 1] !== "\n" ? "\n" : "";
  const pos = start + lead.length + caretOffset;
  return {
    text: text.slice(0, start) + lead + inner + text.slice(end),
    start: pos,
    end: pos,
  };
}

const TABLE =
  "| 表头 1 | 表头 2 | 表头 3 |\n" +
  "| --- | --- | --- |\n" +
  "|  |  |  |\n" +
  "|  |  |  |\n";

const LIST_STRIP = /^([-*+]|\d+\.)\s+/;

/** 命令名与 EditorPane 的 EditorCommand 对齐；返回 null 表示交回原生处理 */
export function transformSource(
  cmd: string,
  text: string,
  start: number,
  end: number,
): EditResult | null {
  switch (cmd) {
    case "bold":
      return wrapSelection(text, start, end, "**");
    case "italic":
      return wrapSelection(text, start, end, "*");
    case "strike":
      return wrapSelection(text, start, end, "~~");
    case "inlineCode":
      return wrapSelection(text, start, end, "`");

    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return heading(text, start, end, Number(cmd.charAt(1)));

    case "paragraph":
      return rewriteLines(text, start, end, (l) =>
        l
          .replace(/^#{1,6}\s+/, "")
          .replace(/^>\s?/, "")
          .replace(LIST_STRIP, ""),
      );

    case "bulletList":
      return prefixLines(text, start, end, "- ", LIST_STRIP, (l) => /^[-*+]\s/.test(l));
    case "orderedList":
      return prefixLines(text, start, end, "1. ", LIST_STRIP, (l) => /^\d+\.\s/.test(l));
    case "blockquote":
      return prefixLines(text, start, end, "> ", /^>\s?/, (l) => /^>/.test(l));

    case "indent":
      return rewriteLines(text, start, end, (l) => (l.trim() === "" ? l : "  " + l));
    case "outdent":
      return rewriteLines(text, start, end, (l) => l.replace(/^ {1,2}/, ""));

    case "codeBlock":
      return insertBlock(
        text,
        start,
        end,
        "```\n" + text.slice(start, end) + "\n```\n",
        4,
      );
    case "hr":
      return insertBlock(text, start, end, "---\n", 4);
    case "table":
      return insertBlock(text, start, end, TABLE, TABLE.length);

    default:
      return null;
  }
}
