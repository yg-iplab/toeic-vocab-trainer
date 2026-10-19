// 解き方（tips/*.md）を画面に出すための、小さな Markdown 読み取り
// 対応：見出し・段落・箇条書き／番号付きリスト（入れ子・続きの段落）・表・引用・コードの枠・区切り線、
//       文中の **太字**・`コード`・<u>下線</u>・<br>・\ のエスケープ
// HTML として埋め込まず、画面側（ui/Markdown.tsx）で React の要素に組み立てる。知らないタグは文字のまま出す

export type Inline =
  | { t: "text"; v: string }
  | { t: "b"; c: Inline[] }
  | { t: "u"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "br" };

export type Align = "left" | "center" | "right" | undefined;

export type Block =
  | { t: "h"; level: number; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "list"; ordered: boolean; start: number; items: Block[][] }
  | { t: "table"; head: Inline[][]; align: Align[]; rows: Inline[][][] }
  | { t: "quote"; c: Block[] }
  | { t: "code"; v: string }
  | { t: "hr" };

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|~<>]/;

/** 文中の飾りを読む */
export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let k = 0;
  while (k < s.length) {
    const ch = s[k];
    const rest = s.slice(k);
    if (ch === "\\" && k + 1 < s.length && ESCAPABLE.test(s[k + 1])) {
      buf += s[k + 1];
      k += 2;
      continue;
    }
    if (ch === "`") {
      const end = s.indexOf("`", k + 1);
      if (end > k + 1) {
        flush();
        out.push({ t: "code", v: s.slice(k + 1, end) });
        k = end + 1;
        continue;
      }
    }
    const br = /^(<br\s*\/?>|\n)/i.exec(rest);
    if (br) {
      flush();
      out.push({ t: "br" });
      k += br[0].length;
      continue;
    }
    if (/^<u>/i.test(rest)) {
      const end = s.slice(k + 3).search(/<\/u>/i);
      if (end >= 0) {
        flush();
        out.push({ t: "u", c: parseInline(s.slice(k + 3, k + 3 + end)) });
        k += 3 + end + 4;
        continue;
      }
    }
    if (rest.startsWith("**")) {
      const end = s.indexOf("**", k + 2);
      if (end > k + 2) {
        flush();
        out.push({ t: "b", c: parseInline(s.slice(k + 2, end)) });
        k = end + 2;
        continue;
      }
    }
    buf += ch;
    k++;
  }
  flush();
  return out;
}

/** 行の頭の空白の数（タブは4つ分） */
function indentOf(line: string): number {
  return /^ */.exec(line)![0].length;
}

/** 行の頭の空白を、最大 n 個まで外す */
function dedent(line: string, n: number): string {
  return line.slice(Math.min(n, indentOf(line)));
}

type Marker = { ordered: boolean; num: number; ind: number; width: number; rest: string };

/** 箇条書き（- * +）・番号付き（1. 1)）の行か */
function listMarker(line: string): Marker | null {
  const m = /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/.exec(line);
  if (!m) return null;
  const ordered = /\d/.test(m[2]);
  return {
    ordered,
    num: ordered ? Number.parseInt(m[2], 10) : 1,
    ind: m[1].length,
    // 中身が始まる位置。続きの行はここまで字下げしてあれば同じ項目
    width: m[1].length + m[2].length + Math.min(m[3].length || 1, 4),
    rest: m[4],
  };
}

const isHr = (line: string) => /^ {0,3}([-*_])( *\1){2,} *$/.test(line);
const isHeading = (line: string) => /^ {0,3}#{1,6}( |$)/.test(line);
const isFence = (line: string) => /^ {0,3}(```|~~~)/.test(line);
const isQuote = (line: string) => /^ {0,3}>/.test(line);
const isTableSep = (line: string) => line.includes("|") && /^ *\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/.test(line);

function isTableStart(lines: string[], i: number): boolean {
  return lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]);
}

/** 段落の途中で、新しいまとまりが始まる行か */
function startsBlock(lines: string[], i: number): boolean {
  const l = lines[i];
  return isHr(l) || isHeading(l) || isFence(l) || isQuote(l) || listMarker(l) !== null || isTableStart(lines, i);
}

/** 表の1行をマスに分ける（\| と `…` の中の | は区切りにしない） */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  let inCode = false;
  for (let k = 0; k < s.length; k++) {
    const ch = s[k];
    if (ch === "\\" && s[k + 1] === "|") {
      cur += "\\|";
      k++;
      continue;
    }
    if (ch === "`") inCode = !inCode;
    if (ch === "|" && !inCode) {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function alignOf(cell: string): Align {
  const c = cell.trim();
  if (c.startsWith(":") && c.endsWith(":")) return "center";
  if (c.endsWith(":")) return "right";
  if (c.startsWith(":")) return "left";
  return undefined;
}

/** 段落の行をつなぐ（改行はそのまま改行として見せる。太字が行をまたいでもよい） */
function paragraph(lines: string[]): Inline[] {
  return parseInline(lines.map((l) => l.trim()).join("\n"));
}

function parseLines(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    if (isFence(line)) {
      const ind = indentOf(line);
      const mark = line.trim().slice(0, 3);
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(mark)) body.push(dedent(lines[i++], ind));
      i++; // 閉じの ```
      out.push({ t: "code", v: body.join("\n") });
      continue;
    }

    const h = /^ {0,3}(#{1,6})(?: +(.*?))?(?: +#+)? *$/.exec(line);
    if (h) {
      out.push({ t: "h", level: h[1].length, c: parseInline(h[2] ?? "") });
      i++;
      continue;
    }

    if (isHr(line)) {
      out.push({ t: "hr" });
      i++;
      continue;
    }

    if (isTableStart(lines, i)) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map(alignOf);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        const cells = splitRow(lines[i++]);
        while (cells.length < head.length) cells.push("");
        rows.push(cells.map(parseInline));
      }
      out.push({ t: "table", head: head.map(parseInline), align, rows });
      continue;
    }

    if (isQuote(line)) {
      const body: string[] = [];
      // 引用の続き：> で始まる行と、段落の途中の > の無い行
      while (i < lines.length && lines[i].trim() && (isQuote(lines[i]) || !startsBlock(lines, i))) {
        body.push(lines[i].replace(/^ {0,3}> ?/, ""));
        i++;
      }
      out.push({ t: "quote", c: parseLines(body) });
      continue;
    }

    const first = listMarker(line);
    if (first) {
      const items: string[][] = [];
      let cur: string[] = [];
      let contentInd = first.width;
      while (i < lines.length) {
        const l = lines[i];
        const m = listMarker(l);
        if (m && m.ind < contentInd) {
          if (m.ordered !== first.ordered) break; // 別の種類のリストが始まる
          cur = [m.rest];
          items.push(cur);
          contentInd = m.width;
          i++;
          continue;
        }
        if (!l.trim()) {
          // 空行のあと、字下げした行か同じ種類の次の項目が来れば、リストは続く
          let j = i + 1;
          while (j < lines.length && !lines[j].trim()) j++;
          const nm = j < lines.length ? listMarker(lines[j]) : null;
          if (j < lines.length && (indentOf(lines[j]) >= contentInd || (nm && nm.ind < contentInd && nm.ordered === first.ordered))) {
            cur.push("");
            i++;
            continue;
          }
          break;
        }
        if (indentOf(l) >= contentInd) {
          cur.push(dedent(l, contentInd));
          i++;
          continue;
        }
        // 字下げの無い続きの行（段落の途中で、新しいまとまりではない行）
        const prev = cur[cur.length - 1];
        if (prev !== undefined && prev.trim() && !startsBlock(lines, i)) {
          cur.push(l.trim());
          i++;
          continue;
        }
        break;
      }
      out.push({ t: "list", ordered: first.ordered, start: first.num, items: items.map(parseLines) });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !startsBlock(lines, i))) para.push(lines[i++]);
    out.push({ t: "p", c: paragraph(para) });
  }
  return out;
}

export function parseMarkdown(text: string): Block[] {
  return parseLines(text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n"));
}

/** 文中の飾りを外した文字だけ（見出しの一覧や検索用） */
export function inlineText(c: Inline[]): string {
  return c.map((x) => (x.t === "text" || x.t === "code" ? x.v : x.t === "br" ? " " : inlineText(x.c))).join("");
}
