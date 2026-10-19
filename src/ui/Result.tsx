// セット結果の画面
import { noLabel, unit } from "../data/stats";
import type { Round } from "../types";
import { ProgressBar, RowText } from "./components";
import type { AnswerResult, Session } from "./Study";

export function Result({
  session,
  results,
  round,
  roundMissedIds,
  onAgain,
  onMissedRound,
  onHome,
  onOpen,
}: {
  session: Session;
  results: AnswerResult[];
  round?: Round;
  roundMissedIds: string[];
  onAgain: () => void;
  onMissedRound: () => void;
  onHome: () => void;
  onOpen: (id: string) => void;
}) {
  const correct = results.filter((r) => r.correct).length;
  const misses = results.filter((r) => !r.correct);
  const unsure = results.filter((r) => r.correct && r.rating === 2);
  const roundDone = round !== undefined && round.finishedAt !== undefined;
  const u = unit(session.deck);
  const what = session.deck === "deru1000" ? "問題" : "語";

  return (
    <div className="screen result">
      <section className="card score">
        <p className="score-label">{session.label}</p>
        <p className="score-num">
          {correct} <span>/ {results.length} 正解</span>
        </p>
        <p className="sub">回答はすべて保存しました。ミスした{what}は忘却曲線に合わせて早めに戻ってきます。</p>
      </section>

      {round && (
        <section className="card">
          <h2>{roundDone ? "周回完了！" : "周回の進み具合"}</h2>
          <p className="round-label">{round.label}</p>
          <ProgressBar value={round.cursor} max={round.itemIds.length} />
          <p className="sub">
            {round.cursor} / {round.itemIds.length} {u}
            {roundDone && `・この周のミス ${roundMissedIds.length}${u}`}
          </p>
          {roundDone && roundMissedIds.length > 0 && (
            <button className="btn" onClick={onMissedRound}>
              ミスだけもう1周（{roundMissedIds.length}
              {u}）
            </button>
          )}
        </section>
      )}

      {misses.length > 0 && (
        <section className="card">
          <h2>ミスした{what}</h2>
          <ul className="list">
            {misses.map((r) => (
              <li key={r.q.item.id}>
                <button className="row" onClick={() => onOpen(r.q.item.id)}>
                  <span className="no">{noLabel(r.q.item)}</span>
                  <RowText item={r.q.item} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {unsure.length > 0 && (
        <section className="card">
          <h2>正解したけど遅い・あやふや</h2>
          <ul className="list">
            {unsure.map((r) => (
              <li key={r.q.item.id}>
                <button className="row" onClick={() => onOpen(r.q.item.id)}>
                  <span className="no">{noLabel(r.q.item)}</span>
                  <RowText item={r.q.item} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!(round && roundDone) && (
        <button className="btn big" onClick={onAgain}>
          {session.mode === "round" ? "続きの問題へ" : "もう1セット"}
        </button>
      )}
      <button className="btn ghost" onClick={onHome}>
        ホームへ
      </button>
    </div>
  );
}
