// アプリ全体で使うデータの形
// 項目名は既存スキーマ（10_Projects/toeic800/knowledge/schema.md・deru1000_schema.md）に合わせる

/** 教材の種類。kinfre＝単語、deru1000＝文法（Part 5） */
export type Deck = "kinfre" | "deru1000";
export const DECKS: Deck[] = ["kinfre", "deru1000"];

/** 番号の接頭辞から教材を見分ける（記録側は id しか持たないため） */
export function deckOf(id: string): Deck {
  return id.startsWith("deru1000-") ? "deru1000" : "kinfre";
}

/** 教材の1問・1語に共通する部分（読み込むだけ。アプリは書き換えない） */
type ItemBase = {
  id: string;
  no: number;
  order: number; // 並び順（教材の中で）
  section: string;
  quality?: string;
};

/** 単語の1語 */
export type KinfreItem = ItemBase & {
  deck: "kinfre";
  // id: "kinfre-0032" / "kinfre-s01-0021"
  part: "main" | string; // 本編は "main"、Supplement は "s01" など
  track?: number;
  word: string;
  pos: string[];
  ja: string;
  example_en?: string;
  example_ja?: string;
  example_en_blank?: string;
  notes_right?: string;
  appear_parts?: string[];
  mnemonic_src?: string; // 章ファイルに既に書かれていた覚え方
  wrong_note_src?: string; // 章ファイルに既に書かれていたミス
};

/** 文法（Part 5）の1問。選択肢は本のまま（アプリで作らない） */
export type DeruItem = ItemBase & {
  deck: "deru1000";
  // id: "deru1000-0042"
  chapter: string; // 章は "c01"〜、模試セットは "m01"〜
  block: string; // ブロック（末尾の（…）を外したもの）
  blockFull?: string; // 章ファイルの block の値そのまま
  stem: string; // 空所は -------
  choices: string[]; // (A)(B)… の記号を外した本文
  answer: string; // "A"〜
  explanation?: string;
  translation?: string;
  vocab?: string;
};

export type Item = KinfreItem | DeruItem;

/** 文法の章・模試セット（章ファイルの先頭から取る。端末の中だけに置く） */
export type ChapterInfo = {
  key: string; // "c01" / "m01"
  deck: "deru1000";
  label: string; // 章ファイルの見出し
  order: number;
  tips: { k: string; v: string }[]; // 章ファイル冒頭の要点（解き方の手順など）
};

/** 文法の解き方（Drive の deru1000/tips/*.md 1本）。教材なので端末の中だけに置き、バックアップには入れない */
export type TipsDoc = {
  key: string; // 章は "c01"〜（ChapterInfo.key と同じ）、巻頭（使い方のページ）は "intro"
  title: string; // ファイルの見出し
  order: number; // 巻頭 0、章は章の番号
  md: string; // ファイルの中身（Markdown）
  fileName: string;
  importedAt: number;
};

/** FSRS のカード（保存用に日付を数値にしたもの） */
export type StoredFsrs = {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number; // 0=New 1=Learning 2=Review 3=Relearning
  last_review: number | null;
};

export type Status = "new" | "learning" | "known" | "missed";

/** 1問の「いまの状態」。ReviewLog を足すたびに更新する */
export type CardState = {
  id: string;
  due: number; // 次に出す日時（ミリ秒）。検索用に fsrs.due と同じ値を持つ
  fsrs: StoredFsrs;
  status: Status;
  miss_count: number;
  correct_count: number;
  last_reviewed?: string; // YYYY-MM-DD
  last_correct?: boolean;
};

export type Mode = "round" | "daily";
export type Format = "mc" | "flip" | "part5"; // 4択 / めくる / Part 5
export type KinfreFormat = "mc" | "flip";
export type Rating = 1 | 2 | 3 | 4; // もう一度 / 難しい / 正解 / 簡単

/** 1回答 = 1行。消さずに足していく（記録の正本） */
export type ReviewLog = {
  seq?: number;
  id: string;
  ts: number; // 回答した日時（ミリ秒）
  day: string; // YYYY-MM-DD（端末の日付）
  mode: Mode;
  round?: number; // 何周目か
  rid?: number; // どの周回か（Round.rid）
  format: Format;
  correct: boolean;
  // 選んだ答え。単語は取り違えた語の番号、文法は選んだ記号（"B"）。教材の文は入れない
  chosen?: string;
  ms: number;
  unsure: boolean;
  rating: Rating;
  retry: boolean; // セット内のもう一度
};

/** 自分のメモ（既存オーバーレイと同じ項目。単語は custom_example、文法は custom_note） */
export type UserNote = {
  id: string;
  mnemonic?: string;
  wrong_note?: string;
  custom_example?: string;
  custom_note?: string;
  updated_at?: number;
};

/** 周回（1周目・2周目…）。進行中の周回は教材ごとに1つ */
export type Round = {
  rid?: number;
  deck: Deck; // 版1の記録には無い（読み込むときに kinfre を入れる）
  no: number; // 何周目か（教材ごと）
  label: string;
  itemIds: string[];
  cursor: number; // 次に出す位置
  order: "seq" | "shuffle";
  startedAt: number;
  finishedAt?: number;
  parentRid?: number; // 「ミスだけもう1周」の元になった周回
};

export type Settings = {
  deck: Deck; // ホームで表示中の教材
  // 単語
  setSize: number;
  hardMs: number; // これより遅い正解は「難しい」扱い
  newPerDay: number;
  format: KinfreFormat;
  includeSupplement: boolean;
  // 文法（Part 5）
  deruSetSize: number;
  deruHardMs: number;
  deruNewPerDay: number;
  deruAlwaysExplain: boolean; // 回答後、正誤・あやふやに関係なく解説と全訳を開いておく（自動で次へは進まない）
  // 共通
  reviewRatio: number; // 今日の学習で復習が占める割合
  examDate: string; // YYYY-MM-DD
  retention: number; // FSRS の目標保持率
  autoNext: boolean;
  speechRate: number; // 発音ボタンの読み上げの速さ（1 がふつう）
};

export const DEFAULT_SETTINGS: Settings = {
  deck: "kinfre",
  setSize: 10,
  hardMs: 3000,
  newPerDay: 20,
  format: "mc",
  includeSupplement: false,
  deruSetSize: 10,
  deruHardMs: 30000, // 本の目安は1問20〜30秒
  deruNewPerDay: 20,
  deruAlwaysExplain: true,
  reviewRatio: 0.7,
  examDate: "2026-12-19",
  retention: 0.9,
  autoNext: true,
  speechRate: 0.9,
};

/** 教材ごとに分かれている設定を取り出す */
export function deckSettings(s: Settings, deck: Deck): { setSize: number; hardMs: number; newPerDay: number } {
  return deck === "deru1000"
    ? { setSize: s.deruSetSize, hardMs: s.deruHardMs, newPerDay: s.deruNewPerDay }
    : { setSize: s.setSize, hardMs: s.hardMs, newPerDay: s.newPerDay };
}

/** 出題1問分 */
export type Question = {
  item: Item;
  choices?: string[]; // 4択・Part 5 のとき（表示する選択肢）
  choiceIds?: string[]; // 記録用：単語は各選択肢がどの語の訳か、文法は記号（"A"…）
  answerIndex?: number;
  retry: boolean;
  // similar＝最近ミスした分野と同じ分野の、まだ解いていない問題（文法の類題）
  source: "due" | "leech" | "new" | "similar" | "other" | "round" | "retry";
};

export const LETTERS = "ABCDEFGH";
