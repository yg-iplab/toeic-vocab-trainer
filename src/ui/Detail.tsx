// 1語の詳細（教材の訳・自分のメモ・回答履歴）
import { useState } from "react";
import { db } from "../data/db";
import { formatDateTime } from "../lib/date";
import { RATING_LABEL } from "../srs/rating";
import { ItemInfo, StatusBadge, TopBar, WordHead } from "./components";
import type { Store } from "./store";

export function Detail({ store, id, onBack }: { store: Store; id: string; onBack: () => void }) {
  const item = store.itemsById.get(id);
  const card = store.cards.get(id);
  const note = store.notes.get(id);
  const [mnemonic, setMnemonic] = useState(note?.mnemonic ?? "");
  const [wrong, setWrong] = useState(note?.wrong_note ?? "");
  const [example, setExample] = useState(note?.custom_example ?? "");
  const [saved, setSaved] = useState(false);

  if (!item) {
    return (
      <div className="screen">
        <TopBar title="詳細" onBack={onBack} />
        <p className="empty">この語は教材データにありません（{id}）。</p>
      </div>
    );
  }

  const logs = store.logs.filter((l) => l.id === id).sort((a, b) => b.ts - a.ts);

  const save = async () => {
    await db.notes.put({ id, mnemonic: mnemonic.trim(), wrong_note: wrong.trim(), custom_example: example.trim(), updated_at: Date.now() });
    await store.reload();
    setSaved(true);
  };

  return (
    <div className="screen detail">
      <TopBar title="詳細" onBack={onBack} />
      <section className="card">
        <WordHead item={item} />
        <p className="sub">
          {item.section}
          {item.track !== undefined && ` / track ${item.track}`}
        </p>
        <ItemInfo item={item} />
      </section>

      <section className="card">
        <h2>状態</h2>
        <p>
          <StatusBadge status={card?.status ?? "new"} /> ミス {card?.miss_count ?? 0}回・正解 {card?.correct_count ?? 0}回
        </p>
        {card && card.fsrs.state !== 0 && <p className="sub">次に出す目安：{formatDateTime(card.due)}</p>}
      </section>

      <section className="card form">
        <h2>自分のメモ</h2>
        <label>
          覚え方
          <textarea value={mnemonic} onChange={(e) => (setMnemonic(e.target.value), setSaved(false))} rows={2} />
        </label>
        <label>
          どこを間違えたか
          <textarea value={wrong} onChange={(e) => (setWrong(e.target.value), setSaved(false))} rows={2} />
        </label>
        <label>
          自分の例文
          <textarea value={example} onChange={(e) => (setExample(e.target.value), setSaved(false))} rows={2} lang="en" />
        </label>
        <button className="btn" onClick={save}>
          {saved ? "保存しました" : "メモを保存"}
        </button>
      </section>

      <section className="card">
        <h2>回答の履歴（{logs.length}回）</h2>
        {logs.length === 0 ? (
          <p className="empty">まだ解いていません。</p>
        ) : (
          <table className="history">
            <thead>
              <tr>
                <th>日時</th>
                <th>どこで</th>
                <th>結果</th>
                <th>秒</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.seq ?? l.ts}>
                  <td>{formatDateTime(l.ts)}</td>
                  <td>
                    {l.mode === "round" ? `${l.round}周目` : "今日の学習"}
                    {l.retry && "（もう一度）"}
                  </td>
                  <td className={l.correct ? "ok" : "ng"}>
                    {l.correct ? "○" : "×"} {RATING_LABEL[l.rating]}
                    {l.unsure && "・あやふや"}
                    {!l.correct && l.chosen && store.itemsById.get(l.chosen) && (
                      <span className="confused-cell">
                        {" "}
                        ← <span lang="en">{store.itemsById.get(l.chosen)!.word}</span> と混同
                      </span>
                    )}
                  </td>
                  <td>{(l.ms / 1000).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
