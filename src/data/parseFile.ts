// 教材ファイルを中身で読み分ける（単語の章ファイル・JSONL ／ 文法の章ファイル）
import { isDeruText, parseDeruMarkdown } from "./parseDeru";
import { parseKinfreFile, type ParseResult } from "./parseKinfre";

export function parseMaterialFile(name: string, text: string): ParseResult {
  if (!/\.jsonl$/i.test(name) && isDeruText(text)) return parseDeruMarkdown(text, name);
  return parseKinfreFile(name, text);
}
