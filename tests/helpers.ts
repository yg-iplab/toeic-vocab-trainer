// テスト用の共通部品（教材本文は使わず、架空のデータだけで作る）
import type { Item } from "../src/types";

export function fakeItem(no: number, over: Partial<Item> = {}): Item {
  return {
    id: `kinfre-${String(no).padStart(4, "0")}`,
    deck: "kinfre",
    part: "main",
    no,
    order: no,
    section: no <= 50 ? "テストA" : "テストB",
    track: Math.ceil(no / 25),
    word: `word${no}`,
    pos: [no % 3 === 0 ? "動" : "名"],
    ja: `意味${no}`,
    ...over,
  };
}

export function fakeItems(n: number): Item[] {
  return Array.from({ length: n }, (_, i) => fakeItem(i + 1));
}
