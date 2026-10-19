// 教材ファイルを中身で読み分ける（単語の章ファイル・JSONL ／ 文法の章ファイル ／ 文法の解き方）
import { isDeruText, parseDeruMarkdown } from "./parseDeru";
import { parseKinfreFile, type ParseResult } from "./parseKinfre";
import { parseTipsFile } from "./tips";

export function parseMaterialFile(name: string, text: string, now = Date.now()): ParseResult {
  if (/\.jsonl$/i.test(name)) return parseKinfreFile(name, text);
  if (isDeruText(text)) return parseDeruMarkdown(text, name);
  const tips = parseTipsFile(name, text, now);
  if (tips) return { items: [], skipped: [], tips: [tips] };
  return parseKinfreFile(name, text);
}
