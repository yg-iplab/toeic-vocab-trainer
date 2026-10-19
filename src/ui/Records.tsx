// 記録画面（ミス一覧・周回ごとの成績・範囲別の進み具合）
import { useMemo, useState } from "react";
import { groupStats, missedItems, noLabel, roundStats } from "../data/stats";
import { formatDateTime } from "../lib/date";
import type { Item, Round } from "../types";
import { ProgressBar, StatusBadge, TopBar } from "./components";
import type { Store } from "./store";

type Tab = "miss" | "round" | "range";

export function Records({
  store,
  onOpen,
  onMissedRound,
}: {
  store: Store;
  onOpen: (id: string) => void;
  onMissedRound: (round: Round, ids: string[]) => void;
}) {
  const [tab, setTab] = useState<Tab>("miss");
  const [query, setQuery] = useState("");
  const missed = useMemo(() => missedItems(store.items, store.cards), [store.items, store.cards]);
  const rounds = useMemo(() => roundStats(store.rounds, store.logs), [store.rounds, store.logs]);
  const groups = useMemo(() => groupStats(store.items, store.cards), [store.items, store.cards]);

  const q = query.trim().toLowerCase();
  const searched: Item[] = q
    ? store.items.filter((i) => i.word.toLowerCase().includes(q) || i.ja.includes(query.trim()) || noLabel(i) === q.padStart(3, "0") || String(i.no) === q)
    : [];

  return (
    <div className="screen">
      <TopBar title="記録" />
      <div className="seg tabs" role="tablist">
        <button className={tab === "miss" ? "on" : ""} onClick={() => setTab("miss")}>
          ミス一覧
        </button>
        <button className={tab === "round" ? "on" : ""} onClick={() => setTab("round")}>
          周回
        </button>
        <button className={tab === "range" ? "on" : ""} onClick={() => setTab("range")}>
          範囲別
        </button>
      </div>

      {tab === "miss" && (
        <>
          <input className="search" type="search" placeholder="単語・訳・番号で探す" value={query} onChange={(e) => setQuery(e.target.value)} />
          {q ? (
            <ul className="list">
              {searched.slice(0, 100).map((i) => {
                const c = store.cards.get(i.id);
                return (
                  <li key={i.id}>
                    <button className="row" onClick={() => onOpen(i.id)}>
                      <span className="no">{noLabel(i)}</span>
                      <span className="w" lang="en">
                        {i.word}
                      </span>
                      <span className="j">{i.ja}</span>
                      <StatusBadge status={c?.status ?? "new"} />
                    </button>
                  </li>
                );
              })}
              {searched.length === 0 && <li className="empty">見つかりません</li>}
            </ul>
          ) : missed.length === 0 ? (
            <p className="empty">まだミスはありません。</p>
          ) : (
            <>
              <p className="sub">ミスした語 {missed.length}語（ミス回数の多い順）</p>
              <ul className="list">
                {missed.map(({ item, card }) => (
                  <li key={item.id}>
                    <button className="row" onClick={() => onOpen(item.id)}>
                      <span className="no">{noLabel(item)}</span>
                      <span className="w" lang="en">
                        {item.word}
                      </span>
                      <span className="j">{item.ja}</span>
                      <span className="miss">×{card.miss_count}</span>
                      <StatusBadge status={card.status} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {tab === "round" &&
        (rounds.length === 0 ? (
          <p className="empty">まだ周回がありません。</p>
        ) : (
          rounds.map((s) => {
            const rate = s.answered ? Math.round((s.correct / s.answered) * 100) : 0;
            return (
              <section key={s.round.rid} className="card">
                <h2>{s.round.label}</h2>
                <ProgressBar value={s.round.cursor} max={s.round.itemIds.length} />
                <p className="sub">
                  {s.answered}/{s.round.itemIds.length}語・正答率 {rate}%・ミス {s.missedIds.length}語
                  <br />
                  開始 {formatDateTime(s.round.startedAt)}
                  {s.round.finishedAt !== undefined && `・終了 ${formatDateTime(s.round.finishedAt)}`}
                </p>
                {s.round.finishedAt !== undefined && s.missedIds.length > 0 && (
                  <button className="btn small" onClick={() => onMissedRound(s.round, s.missedIds)}>
                    この周のミスだけもう1周
                  </button>
                )}
              </section>
            );
          })
        ))}

      {tab === "range" && (
        <ul className="list groups">
          {groups.map((g) => (
            <li key={g.key} className="group">
              <p className="g-label">{g.label}</p>
              <ProgressBar value={g.studied} max={g.total} />
              <p className="sub">
                解いた {g.studied}/{g.total}・覚えた {g.known}・ミス中 <b className={g.missed ? "ng" : ""}>{g.missed}</b>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
