// 記録画面（ミス一覧・周回ごとの成績・範囲別の進み具合）
import { useMemo, useState } from "react";
import { roundDeck } from "../data/rounds";
import { groupStats, itemsOfDeck, missedItems, noLabel, roundStats, unit } from "../data/stats";
import { formatDateTime } from "../lib/date";
import type { Item, Round } from "../types";
import { ProgressBar, RowText, StatusBadge, TopBar } from "./components";
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
  // 表示中の教材（ホームで切り替え）の分だけ出す
  const deck = store.settings.deck;
  const u = unit(deck);
  const items = useMemo(() => itemsOfDeck(store.items, deck), [store.items, deck]);
  const missed = useMemo(() => missedItems(items, store.cards), [items, store.cards]);
  const rounds = useMemo(
    () => roundStats(store.rounds.filter((r) => roundDeck(r) === deck), store.logs),
    [store.rounds, store.logs, deck],
  );
  const groups = useMemo(() => groupStats(items, store.cards, store.chapters), [items, store.cards, store.chapters]);

  const q = query.trim().toLowerCase();
  const matches = (i: Item) => {
    if (String(i.no) === q || noLabel(i) === q.padStart(noLabel(i).length, "0")) return true;
    if (i.deck === "deru1000") return i.stem.toLowerCase().includes(q) || i.section.includes(query.trim()) || i.block.includes(query.trim());
    return i.word.toLowerCase().includes(q) || i.ja.includes(query.trim());
  };
  const searched: Item[] = q ? items.filter(matches) : [];

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
          <input
            className="search"
            type="search"
            placeholder={deck === "deru1000" ? "番号・英文・分野で探す" : "単語・訳・番号で探す"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {q ? (
            <ul className="list">
              {searched.slice(0, 100).map((i) => {
                const c = store.cards.get(i.id);
                return (
                  <li key={i.id}>
                    <button className="row" onClick={() => onOpen(i.id)}>
                      <span className="no">{noLabel(i)}</span>
                      <RowText item={i} />
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
              <p className="sub">
                ミスした{deck === "deru1000" ? "問題" : "語"} {missed.length}
                {u}（ミス回数の多い順）
              </p>
              <ul className="list">
                {missed.map(({ item, card }) => (
                  <li key={item.id}>
                    <button className="row" onClick={() => onOpen(item.id)}>
                      <span className="no">{noLabel(item)}</span>
                      <RowText item={item} />
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
                  {s.answered}/{s.round.itemIds.length}
                  {u}・正答率 {rate}%・ミス {s.missedIds.length}
                  {u}
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
