// 忘却曲線（FSRS）で「次にいつ出すか」を決める部分
import {
  BasicLearningStepsStrategy,
  createEmptyCard,
  fsrs,
  Rating as FsrsRating,
  State,
  StrategyMode,
  type Card,
  type FSRS,
  type Grade,
  type TLearningStepsStrategy,
} from "ts-fsrs";
import { localDay } from "../lib/date";
import type { CardState, Rating, Status, StoredFsrs } from "../types";

const STATE_REVIEW = 2;
/** この日数以上もつ見込みになったら「覚えた」 */
export const KNOWN_STABILITY_DAYS = 21;

/**
 * 学習の段階（覚えはじめの「1分 → 10分」と、忘れたあとの「10分」）の進め方（v0.8〜）
 * ts-fsrs の標準では「難しい」（遅い正解・あやふや）は段階が進まず、何度正解しても6分後にまた出る。
 * ここでは「難しい」でも「正解」と同じだけ段階を進める。記憶の強さの計算は「難しい」のまま（次の復習は速い正解より早い）
 */
export const advanceOnHard: TLearningStepsStrategy = (params, state, curStep) => {
  const base = BasicLearningStepsStrategy(params, state, curStep);
  if (state === State.Review || !base[FsrsRating.Hard]) return base;
  const out = { ...base };
  const good = base[FsrsRating.Good];
  if (good) out[FsrsRating.Hard] = { ...good };
  else delete out[FsrsRating.Hard]; // 最後の段階：「正解」と同じく、日単位の復習へ
  return out;
};

export function makeScheduler(retention: number): FSRS {
  return fsrs({ request_retention: retention, enable_fuzz: true, enable_short_term: true }).useStrategy(
    StrategyMode.LEARNING_STEPS,
    advanceOnHard,
  );
}

export function toStored(card: Card): StoredFsrs {
  return {
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.getTime() : null,
  };
}

export function fromStored(s: StoredFsrs): Card {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsed_days,
    scheduled_days: s.scheduled_days,
    learning_steps: s.learning_steps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    last_review: s.last_review === null ? undefined : new Date(s.last_review),
  };
}

export function emptyState(id: string, now: number): CardState {
  const fsrsCard = toStored(createEmptyCard(new Date(now)));
  return { id, due: fsrsCard.due, fsrs: fsrsCard, status: "new", miss_count: 0, correct_count: 0 };
}

/**
 * 状態の決め方（既存オーバーレイの new / learning / known / missed に合わせる）
 * - missed: 最後の回答が×
 * - known: FSRS が「復習」段階で、21日以上もつ見込み
 * - learning: それ以外で1回以上解いた
 */
export function statusOf(f: StoredFsrs, lastCorrect: boolean | undefined): Status {
  if (lastCorrect === undefined) return "new";
  if (!lastCorrect) return "missed";
  if (f.state === STATE_REVIEW && f.stability >= KNOWN_STABILITY_DAYS) return "known";
  return "learning";
}

/** 1回答ぶん状態を進める */
export function applyReview(
  prev: CardState | undefined,
  id: string,
  rating: Rating,
  now: number,
  scheduler: FSRS,
): CardState {
  const base = prev ?? emptyState(id, now);
  const result = scheduler.next(fromStored(base.fsrs), new Date(now), rating as Grade);
  const fsrsCard = toStored(result.card);
  const correct = rating > 1;
  return {
    id,
    due: fsrsCard.due,
    fsrs: fsrsCard,
    miss_count: base.miss_count + (correct ? 0 : 1),
    correct_count: base.correct_count + (correct ? 1 : 0),
    last_reviewed: localDay(now),
    last_correct: correct,
    status: statusOf(fsrsCard, correct),
  };
}

/** いま思い出せる確率（0〜1）。まだ解いていない語は 0 */
export function retrievability(state: CardState | undefined, now: number, scheduler: FSRS): number {
  if (!state || state.fsrs.state === 0) return 0;
  return scheduler.get_retrievability(fromStored(state.fsrs), new Date(now), false);
}

/** 4つの評価それぞれの「次に出す日時」（めくるモードのボタン表示用） */
export function previewDue(state: CardState | undefined, id: string, now: number, scheduler: FSRS) {
  const base = state ?? emptyState(id, now);
  const preview = scheduler.repeat(fromStored(base.fsrs), new Date(now));
  return {
    1: preview[1].card.due.getTime(),
    2: preview[2].card.due.getTime(),
    3: preview[3].card.due.getTime(),
    4: preview[4].card.due.getTime(),
  } as Record<Rating, number>;
}
