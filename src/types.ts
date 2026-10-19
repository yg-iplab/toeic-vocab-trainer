// アプリ全体で使うデータの形
// 項目名は既存スキーマ（10_Projects/toeic800/knowledge/schema.md）に合わせる

/** 教材の1語（読み込むだけ。アプリは書き換えない） */
export type Item = {
  id: string; // "kinfre-0032" / "kinfre-s01-0021"
  deck: "kinfre";
  part: "main" | string; // 本編は "main"、Supplement は "s01" など
  no: number;
  order: number; // 並び順（本編 → Supplement の順）
  section: string;
  track?: number;
  word: string;
  pos: string[];
  ja: string;
  example_en?: string;
  example_ja?: string;
  example_en_blank?: string;
  notes_right?: string;
  appear_parts?: string[];
  quality?: string;
  mnemonic_src?: string; // 章ファイルに既に書かれていた覚え方
  wrong_note_src?: string; // 章ファイルに既に書かれていたミス
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

/** 1語の「いまの状態」。ReviewLog を足すたびに更新する */
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
export type Format = "mc" | "flip"; // 4択 / めくる
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
  chosen?: string; // 4択で選んだ選択肢の語の番号（教材の文は入れない）
  ms: number;
  unsure: boolean;
  rating: Rating;
  retry: boolean; // セット内のもう一度
};

/** 自分のメモ（既存オーバーレイと同じ項目） */
export type UserNote = {
  id: string;
  mnemonic?: string;
  wrong_note?: string;
  custom_example?: string;
  updated_at?: number;
};

/** 周回（1周目・2周目…） */
export type Round = {
  rid?: number;
  no: number; // 何周目か
  label: string;
  itemIds: string[];
  cursor: number; // 次に出す位置
  order: "seq" | "shuffle";
  startedAt: number;
  finishedAt?: number;
  parentRid?: number; // 「ミスだけもう1周」の元になった周回
};

export type Settings = {
  setSize: number;
  hardMs: number; // これより遅い正解は「難しい」扱い
  reviewRatio: number; // 今日の学習で復習が占める割合
  newPerDay: number;
  examDate: string; // YYYY-MM-DD
  retention: number; // FSRS の目標保持率
  autoNext: boolean;
  format: Format;
  includeSupplement: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  setSize: 10,
  hardMs: 3000,
  reviewRatio: 0.7,
  newPerDay: 20,
  examDate: "2026-12-19",
  retention: 0.9,
  autoNext: true,
  format: "mc",
  includeSupplement: false,
};

/** 出題1問分 */
export type Question = {
  item: Item;
  choices?: string[]; // 4択のときだけ（表示する訳）
  choiceIds?: string[]; // 各選択肢がどの語の訳か
  answerIndex?: number;
  retry: boolean;
  source: "due" | "leech" | "new" | "other" | "round" | "retry";
};
