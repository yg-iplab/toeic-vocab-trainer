// 文法の解き方（Drive の deru1000/tips/*.md）を読み、問題ごとにどの解き方を見せるかを決める
// ファイルの形（中身で見分ける）:
//   # 第N章《…》の解き方…        ← 見出しの「第N章」で章を決める。「…使い方…」は巻頭
//   （変換のメモ・元ファイルとの対応表）
//   ---                           ← 最初の区切り線から後ろが本体
//   ## …
import { parseMarkdown, type Block } from "../lib/markdown";
import type { DeruItem, Item, TipsDoc } from "../types";
import { sameSectionTag, sectionTag } from "./sections";
import { unescapeMd } from "./parseKinfre";

export const INTRO_KEY = "intro";

/** 見出しから、どの章の解き方かを決める（解き方のファイルでなければ null） */
export function tipsHeading(text: string): { key: string; order: number; title: string } | null {
  if (/^\s*[-*]\s*(id\s*[:：]\s*deru1000-|番号\s*[:：]\s*kinfre-)/m.test(text)) return null;
  const first = text.split(/\r?\n/).find((l) => l.trim());
  const h1 = first && /^\\?#\s+(.+?)\s*$/.exec(first.trim());
  if (!h1) return null;
  const title = unescapeMd(h1[1]).replace(/\s+#+$/, "");
  const ch = /第\s*(\d+)\s*章/.exec(title);
  if (ch) {
    const n = Number(ch[1]);
    return { key: `c${String(n).padStart(2, "0")}`, order: n, title };
  }
  if (/使い方/.test(title)) return { key: INTRO_KEY, order: 0, title };
  return null;
}

/** 解き方のファイル1本を読む（解き方でなければ null） */
export function parseTipsFile(fileName: string, text: string, now: number): TipsDoc | null {
  const head = tipsHeading(text);
  if (!head) return null;
  // Drive の表示で行頭に \# \- が付いたものは外す（ふつうの .md ならそのまま）
  const md = /^\\#\s/m.test(text) ? text.split(/\r?\n/).map(unescapeMd).join("\n") : text;
  return { ...head, md, fileName, importedAt: now };
}

/** 画面に出す形。見出しは画面の上に出し、最初の区切り線より前（変換のメモ）は畳んで見せる */
export function tipsView(doc: Pick<TipsDoc, "md">): { preface: Block[]; body: Block[] } {
  const blocks = parseMarkdown(doc.md);
  const rest = blocks[0]?.t === "h" && blocks[0].level === 1 ? blocks.slice(1) : blocks;
  const hr = rest.findIndex((b) => b.t === "hr");
  if (hr < 0 || rest.slice(0, hr).some((b) => b.t === "h")) return { preface: [], body: rest };
  return { preface: rest.slice(0, hr), body: rest.slice(hr + 1) };
}

/**
 * 分野 → いちばん問題の多い章（模試の問題に、同じ分野の章の解き方を出すため）
 * 章（c01〜）の問題だけで数える。教材から決めるので、章名をコードに書かない
 */
export function sectionChapterIndex(items: Item[]): (section: string) => string | undefined {
  const counts = new Map<string, Map<string, number>>();
  for (const i of items) {
    if (i.deck !== "deru1000" || !/^c\d+$/.test(i.chapter) || !i.section) continue;
    const tag = sectionTag(i.section);
    const byCh = counts.get(tag) ?? new Map<string, number>();
    byCh.set(i.chapter, (byCh.get(i.chapter) ?? 0) + 1);
    counts.set(tag, byCh);
  }
  const cache = new Map<string, string | undefined>();
  return (section: string) => {
    const tag = sectionTag(section);
    if (cache.has(tag)) return cache.get(tag);
    const sum = new Map<string, number>();
    for (const [t, byCh] of counts) {
      if (!sameSectionTag(t, tag)) continue;
      for (const [ch, n] of byCh) sum.set(ch, (sum.get(ch) ?? 0) + n);
    }
    let best: string | undefined;
    let bestN = 0;
    for (const [ch, n] of [...sum].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (n > bestN) {
        best = ch;
        bestN = n;
      }
    }
    cache.set(tag, best);
    return best;
  };
}

export type TipsRef = { doc: TipsDoc; viaSection: boolean };

/** この問題に見せる解き方。章の解き方があればそれ、なければ（模試など）同じ分野の章の解き方 */
export function tipsForItem(
  item: DeruItem,
  tips: Map<string, TipsDoc>,
  chapterOfSection: (section: string) => string | undefined,
): TipsRef | undefined {
  const own = tips.get(item.chapter);
  if (own) return { doc: own, viaSection: false };
  const key = item.section ? chapterOfSection(item.section) : undefined;
  const doc = key ? tips.get(key) : undefined;
  return doc ? { doc, viaSection: true } : undefined;
}

/** 問題に合わせた解き方のボタン名（模試の問題は「この分野の解き方（第N章）」） */
export function tipsButtonLabel(ref: TipsRef): string {
  return ref.viaSection ? `この分野の解き方（第${ref.doc.order}章）` : "この章の解き方";
}

/** 解き方の一覧（巻頭 → 第1章 → …） */
export function sortedTips(tips: Map<string, TipsDoc>): TipsDoc[] {
  return [...tips.values()].sort((a, b) => a.order - b.order);
}
