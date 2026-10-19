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
