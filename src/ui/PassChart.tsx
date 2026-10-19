// 進捗グラフ：章・模試セット（単語は track）ごとに、周回ごとの正答率を横棒で並べる
// いちばん新しい周を強調し、前の周は灰色。どの棒にも値を書くので、色だけに頼らない
import { CHART_PASSES, type GroupPasses } from "../data/stats";

const pct = (correct: number, answered: number) => (answered ? Math.round((correct / answered) * 100) : 0);

export function PassChart({ groups, unit }: { groups: GroupPasses[]; unit: string }) {
  return (
    <section className="card">
      <h2>周回ごとの正答率</h2>
      <p className="sub">
        各周の最初の回答だけで数えます（その場のもう一度・ミスだけの周回は入れません）。新しい周が濃い色、前の周は灰色。範囲ごとに直近{CHART_PASSES}周まで。
      </p>
      {groups.length === 0 ? (
        <p className="empty">周回の記録がまだありません。</p>
      ) : (
        <ul className="pass-chart">
          {groups.map((g) => {
            const last = g.passes[g.passes.length - 1];
            const prev = g.passes[g.passes.length - 2];
            const diff = prev ? pct(last.correct, last.answered) - pct(prev.correct, prev.answered) : null;
            return (
              <li key={g.key}>
                <p className="g-label">
                  {g.label}
                  {diff !== null && <span className="pass-diff">前の周から {diff >= 0 ? `+${diff}` : `−${-diff}`}pt</span>}
                </p>
                {g.passes.map((p) => {
                  const rate = pct(p.correct, p.answered);
                  const latest = p === last;
                  return (
                    <div key={p.rid} className="pass-row" title={`${p.no}周目：${p.answered}${unit}中 ${p.correct}${unit}正解`}>
                      <span className="pass-no">{p.no}周目</span>
                      <span className="pass-track" aria-hidden>
                        <span className={`pass-bar ${latest ? "latest" : ""}`} style={{ width: `${rate}%` }} />
                      </span>
                      <span className="pass-val">
                        {rate}%<small>
                          {p.correct}/{p.answered}
                        </small>
                      </span>
                    </div>
                  );
                })}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
