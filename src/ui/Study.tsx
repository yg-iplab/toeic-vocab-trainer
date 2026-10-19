// 学習画面（単語：4択 / めくる、文法：Part 5）
import { useEffect, useMemo, useRef, useState } from "react";
import { recordAnswer } from "../data/record";
import { formatInterval } from "../lib/date";
import { RATING_LABEL, ratingForChoice } from "../srs/rating";
import { previewDue } from "../srs/scheduler";
import { poolOf, requeueIfWrong } from "../srs/session";
import { deckSettings, type CardState, type Deck, type Format, type Question, type Rating } from "../types";
import { choiceLabel, ItemInfo, Part5Head, Part5Info, ProgressBar, WordHead } from "./components";
import type { Store } from "./store";

export type Session = {
  deck: Deck;
  mode: "daily" | "round";
  label: string;
  questions: Question[];
  rid?: number;
  roundNo?: number;
};

export type AnswerResult = { q: Question; correct: boolean; rating: Rating; ms: number; unsure: boolean };

type Feedback = { chosen?: number; correct: boolean; rating: Rating; card: CardState; unsure: boolean };

/** 文法の解いている時間（目安の秒数を過ぎたら色を変える） */
function Timer({ startedAt, limitMs }: { startedAt: number; limitMs: number }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const t = setInterval(() => setNow(performance.now()), 500);
    return () => clearInterval(t);
  }, []);
  const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <span className={`timer ${sec * 1000 > limitMs ? "over" : ""}`} aria-label="経過秒数">
      {sec}秒
    </span>
  );
}

export function Study({
  store,
  session,
  onFinish,
}: {
  store: Store;
  session: Session;
  onFinish: (results: AnswerResult[]) => void;
}) {
  const { settings, scheduler } = store;
  const pool = useMemo(() => poolOf(store.items, settings, session.deck), [store.items, settings, session.deck]);
  const [queue, setQueue] = useState<Question[]>(session.questions);
  const [index, setIndex] = useState(0);
  const [unsure, setUnsure] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [results, setResults] = useState<AnswerResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(() => performance.now());
  const retries = useRef(new Map<string, number>());
  const revealMs = useRef(0);
  const busy = useRef(false);
  const cardsSeen = useRef(new Map<string, CardState>());

  const q = queue[index];
  const format: Format = q?.item.deck === "deru1000" ? "part5" : q?.choices ? "mc" : "flip";
  const hardMs = deckSettings(settings, session.deck).hardMs;

  useEffect(() => {
    setStartedAt(performance.now());
    setUnsure(false);
    setRevealed(false);
    setFeedback(null);
  }, [index]);

  // 直前の回答で増えた「もう一度」と結果を取りこぼさないよう、最新の値を受け取れるようにする
  const goNext = (curQueue: Question[] = queue, curResults: AnswerResult[] = results) => {
    if (index + 1 >= curQueue.length) onFinish(curResults);
    else setIndex(index + 1);
  };

  // 迷わず正解したときは、テンポよく自動で次へ
  useEffect(() => {
    if (!feedback || !feedback.correct || feedback.rating !== 3 || !settings.autoNext) return;
    const t = setTimeout(() => goNext(), 700);
    return () => clearTimeout(t);
    // feedback が変わったときだけ動かす
  }, [feedback]);

  async function submit(correct: boolean, rating: Rating, ms: number, chosen?: string) {
    if (busy.current || !q) return null;
    busy.current = true;
    try {
      const card = await recordAnswer(
        {
          id: q.item.id,
          mode: session.mode,
          rid: session.rid,
          roundNo: session.roundNo,
          format,
          correct,
          chosen,
          ms,
          unsure,
          rating,
          retry: q.retry,
          now: Date.now(),
        },
        scheduler,
      );
      cardsSeen.current.set(q.item.id, card);
      const nextQueue = requeueIfWrong(queue, q, correct, retries.current, pool, settings.format, Math.random);
      const nextResults = q.retry ? results : [...results, { q, correct, rating, ms, unsure }];
      setQueue(nextQueue);
      setResults(nextResults);
      setError(null);
      return { card, nextQueue, nextResults };
    } catch (e) {
      setError(`記録に失敗しました：${(e as Error).message}`);
      return null;
    } finally {
      busy.current = false;
    }
  }

  async function choose(i: number) {
    if (feedback || !q?.choices) return;
    const ms = performance.now() - startedAt;
    const correct = i === q.answerIndex;
    const rating = ratingForChoice(correct, ms, unsure, hardMs);
    const done = await submit(correct, rating, ms, q.choiceIds?.[i]);
    if (done) setFeedback({ chosen: i, correct, rating, card: done.card, unsure });
  }

  function reveal() {
    revealMs.current = performance.now() - startedAt;
    setRevealed(true);
  }

  async function rate(r: Rating) {
    const done = await submit(r > 1, r, revealMs.current);
    if (done) goNext(done.nextQueue, done.nextResults);
  }

  if (!q) {
    return (
      <div className="screen">
        <p className="empty">出題できる問題がありません。</p>
        <button className="btn" onClick={() => onFinish(results)}>
          ホームへ
        </button>
      </div>
    );
  }

  const note = store.notes.get(q.item.id);
  const card = cardsSeen.current.get(q.item.id) ?? store.cards.get(q.item.id);
  const previews = format === "flip" && revealed ? previewDue(card, q.item.id, Date.now(), scheduler) : null;
  const item = q.item;
  const chapter = item.deck === "deru1000" ? store.chapters.get(item.chapter) : undefined;

  return (
    <div className={`screen study ${format === "part5" ? "part5" : ""}`}>
      <div className="study-top">
        <button
          className="icon-btn"
          onClick={() => {
            if (confirm("ここでやめますか？（ここまでの回答は保存済みです）")) onFinish(results);
          }}
        >
          ✕ やめる
        </button>
        <span className="study-label">{session.label}</span>
        <span className="study-count">
          {index + 1} / {queue.length}
        </span>
      </div>
      <ProgressBar value={index} max={queue.length} label="セットの進み具合" />
      {q.retry && <p className="retry-tag">さっき間違えた{item.deck === "deru1000" ? "問題" : "語"}：もう一度</p>}

      {item.deck === "deru1000" ? (
        <>
          <Part5Head item={item} chapter={chapter} />
          {!feedback && <Timer key={index} startedAt={startedAt} limitMs={hardMs} />}
        </>
      ) : (
        <WordHead item={item} />
      )}

      {(format === "mc" || format === "part5") && q.choices && (
        <>
          <div className={`choices ${format === "part5" ? "p5-choices" : ""}`}>
            {q.choices.map((c, i) => {
              let cls = "choice";
              if (feedback) {
                if (i === q.answerIndex) cls += " correct";
                else if (i === feedback.chosen) cls += " wrong";
                else cls += " dim";
              }
              return (
                <button
                  key={i}
                  className={cls}
                  onClick={() => choose(i)}
                  disabled={!!feedback}
                  lang={format === "part5" ? "en" : undefined}
                >
                  {item.deck === "deru1000" ? choiceLabel(item, i) : c}
                </button>
              );
            })}
          </div>
          {!feedback && (
            <button className={`unsure ${unsure ? "on" : ""}`} onClick={() => setUnsure(!unsure)} aria-pressed={unsure}>
              🤔 あやふや{unsure ? "（オン）" : ""}
            </button>
          )}
        </>
      )}

      {format === "flip" && !revealed && (
        <button className="btn big" onClick={reveal}>
          答えを見る
        </button>
      )}

      {format === "flip" && revealed && previews && item.deck === "kinfre" && (
        <>
          <ItemInfo item={item} note={note} card={card} />
          <div className="rate-grid">
            {([1, 2, 3, 4] as Rating[]).map((r) => (
              <button key={r} className={`rate rate-${r}`} onClick={() => rate(r)}>
                {RATING_LABEL[r]}
                <small>{formatInterval(Date.now(), previews[r])}</small>
              </button>
            ))}
          </div>
        </>
      )}

      {feedback && (
        <div className={`feedback ${feedback.correct ? "ok" : "ng"}`}>
          <p className="verdict">
            {feedback.correct ? "○ 正解" : "× 不正解"}
            <small>
              {RATING_LABEL[feedback.rating]}・次は{formatInterval(Date.now(), feedback.card.due)}
            </small>
          </p>
          {item.deck === "kinfre" &&
            !feedback.correct &&
            feedback.chosen !== undefined &&
            (() => {
              const picked = store.itemsById.get(q.choiceIds?.[feedback.chosen] ?? "");
              return picked?.deck === "kinfre" ? (
                <p className="confused">
                  選んだ「{picked.ja}」は <b lang="en">{picked.word}</b> の意味
                </p>
              ) : null;
            })()}
          {item.deck === "deru1000" ? (
            <Part5Info
              item={item}
              chapter={chapter}
              openExplanation={!feedback.correct || feedback.unsure}
              note={note}
              card={feedback.card}
            />
          ) : (
            <ItemInfo item={item} note={note} card={feedback.card} />
          )}
          <button className="btn big" onClick={() => goNext()}>
            次へ
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
