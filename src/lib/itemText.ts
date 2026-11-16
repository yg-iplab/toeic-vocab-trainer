// 回答後に見せる教材の文の整え方（例文・語彙）。教材の文そのものは書き換えず、見せ方だけを決める

type ExampleSource = { word: string; example_en?: string; example_en_blank?: string };

/** 回答後に見せる例文。全文（例文EN）を優先する。穴あき（頭文字＋---）は出題用なので、全文が無いときだけ */
export function exampleText(item: ExampleSource): string | undefined {
  return item.example_en ?? item.example_en_blank;
}

/**
 * 例文に見出し語が入っていないか（教材データを作ったときの読み取り漏れ。赤字の語が落ちて頭文字だけ残るなど）
 * 活用形（-s・-ed・-ing など）も入っている扱いにするため、見出し語の最初の語の語幹（末尾3文字を除く・最低3文字）で探す
 */
export function exampleMissesWord(item: ExampleSource): boolean {
  const text = exampleText(item);
  const head = item.word.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z'-]/g, "") ?? "";
  if (!text || !head) return false;
  const stem = head.slice(0, Math.max(3, head.length - 3));
  return !text.toLowerCase().includes(stem);
}

/** 見出し語の最初の語（小文字・前後の記号なし）と、その語幹（末尾3文字を除く・最低3文字） */
function headOf(word: string): { head: string; stem: string } {
  const head = (word.trim().split(/\s+/)[0] ?? "").toLowerCase().replace(/[^a-z0-9'-]/g, "").replace(/^[-']+|[-']+$/g, "");
  return { head, stem: head.slice(0, Math.max(3, head.length - 3)) };
}

/** 語の芯（小文字・前後の記号を外す。語の中のハイフンは残す） */
const coreOf = (token: string) => token.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");

/** いくつかの語の中で、見出し語に当たるもの（同じ語 → 見出し語で始まる語 → 語幹で始まる語 の順）。無ければ -1 */
function findHead(cores: (string | null)[], word: string): number {
  const { head, stem } = headOf(word);
  if (!head) return -1;
  for (const ok of [(c: string) => c === head, (c: string) => c.startsWith(head), (c: string) => c.startsWith(stem)]) {
    const i = cores.findIndex((c) => c !== null && c !== "" && ok(c));
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * 例文の読み取りのかけらを、表示のときだけ落とす（v0.8〜。章ファイルは書き換えない）
 * - 全角の英数字・記号を半角に（NFKC）
 * - 見出し語の語のすぐ前後に残ったハイフン、隣に1つだけ立つハイフン・「頭文字＋---」のかけらを落とす
 *   （公式音声の聞き取りで補った語のそばに、元の穴あきの印が残っているため）
 * - 見出し語が例文に無いとき（⚠ の語）は、穴の手がかりを残すため何も落とさない。ハイフンでつないだ本物の語は変えない
 */
export function cleanExample(text: string, word: string): string {
  const t = text.normalize("NFKC");
  const parts = t.split(/(\s+)/); // 偶数番目が語、奇数番目が空白
  const hit = findHead(
    parts.map((p, i) => (i % 2 === 0 ? coreOf(p) : null)),
    word,
  );
  if (hit < 0) return t;
  const w = word.trim();
  if (!w.startsWith("-")) parts[hit] = parts[hit].replace(/^-+/, "");
  if (!w.endsWith("-")) parts[hit] = parts[hit].replace(/-+(?=[^A-Za-z0-9]*$)/, "");
  // かけら：ハイフンと記号（| ! = _ ~ *）だけの語、または「頭文字1〜3字＋ハイフン2つ以上」。見出し語の隣から続く分だけ落とす
  const junk = (p: string) => /^[-|!=_~*]*-[-|!=_~*]*[.,;:!?]?$/.test(p) || /^[A-Za-z]{1,3}-{2,}[.,;:!?]?$/.test(p);
  for (const dir of [-1, 1]) {
    for (let j = hit + 2 * dir; j >= 0 && j < parts.length && junk(parts[j]); j += 2 * dir) {
      parts[j] = parts[j].match(/[.,;:!?]$/)?.[0] ?? ""; // 句読点は残す
      parts[j - dir] = ""; // 見出し語の側の空白
    }
  }
  return parts
    .join("")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export type TextPart = { text: string; hit: boolean };

/** 例文の中の見出し語を太字にするための区切り（2語以上の見出し語は、続いて出てくればまとめて） */
export function highlightParts(text: string, word: string): TextPart[] {
  const split = (at: number, len: number): TextPart[] =>
    [
      { text: text.slice(0, at), hit: false },
      { text: text.slice(at, at + len), hit: true },
      { text: text.slice(at + len), hit: false },
    ].filter((p) => p.text !== "");
  const words = word.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`\\b${words.map(esc).join("\\s+")}\\b`, "i").exec(text);
    if (m) return split(m.index, m[0].length);
  }
  const tokens = [...text.matchAll(/[A-Za-z0-9][A-Za-z0-9'-]*[A-Za-z0-9]|[A-Za-z0-9]/g)];
  const i = findHead(
    tokens.map((m) => coreOf(m[0])),
    word,
  );
  if (i < 0) return [{ text, hit: false }];
  return split(tokens[i].index ?? 0, tokens[i][0].length);
}

export type VocabPair = { en: string; ja: string };

// 「英語（日本語の訳）」の組。英語は直前の英字の並び、かっこの中には かな・漢字・〜 を含むもの
const PAIR = /([A-Za-z][A-Za-z'’ -]*[A-Za-z])\s*[（(]([^（）()]*[぀-ヿ一-鿿〜～][^（）()]*)[)）]/g;

/**
 * 解説の中に出てくる「英語（訳）」の組を拾う（本に語注〔注〕が無い問題の語彙の代わり）
 * 英語は最後の5語まで、訳は30文字までのものだけ。同じ英語は1回だけ
 */
export function vocabFromExplanation(explanation: string | undefined, max = 8): VocabPair[] {
  if (!explanation) return [];
  const out: VocabPair[] = [];
  const seen = new Set<string>();
  for (const m of explanation.matchAll(PAIR)) {
    const en = m[1].trim().split(/\s+/).slice(-5).join(" ");
    const ja = m[2].trim();
    if (en.length < 2 || ja.length > 30) continue;
    const key = en.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ en, ja });
    if (out.length >= max) break;
  }
  return out;
}
