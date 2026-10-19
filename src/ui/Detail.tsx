// 1問・1語の詳細（教材の訳や解説・自分のメモ・回答履歴）
import { useState } from "react";
import { db } from "../data/db";
import { tipsForItem } from "../data/tips";
import { formatDateTime } from "../lib/date";
import { RATING_LABEL } from "../srs/rating";
import { LETTERS, type ReviewLog } from "../types";
import { choiceLabel, ItemInfo, Part5Head, Part5Info, StatusBadge, TopBar, WordHead } from "./components";
import type { Store } from "./store";
import { TipsSheetFor } from "./Tips";

export function Detail({ store, id, onBack }: { store: Store; id: string; onBack: () => void }) {
  const item = store.itemsById.get(id);
  const card = store.cards.get(id);
  const note = store.notes.get(id);
  const [mnemonic, setMnemonic] = useState(note?.mnemonic ?? "");
  const [wrong, setWrong] = useState(note?.wrong_note ?? "");
  // 単語は「自分の例文」（custom_example）、文法は「メモ」（custom_note）。既存オーバーレイの項目名に合わせる
  const [extra, setExtra] = useState((item?.deck === "deru1000" ? note?.custom_note : note?.custom_example) ?? "");
  const [saved, setSaved] = useState(false);
  const [tipsOpen, setTipsOpen] = useState(false);

  if (!item) {
    return (
      <div className="screen">
        <TopBar title="詳細" onBack={onBack} />
        <p className="empty">この問題は教材データにありません（{id}）。</p>
      </div>
    );
  }

  const logs = store.logs.filter((l) => l.id === id).sort((a, b) => b.ts - a.ts);
  const chapter = item.deck === "deru1000" ? store.chapters.get(item.chapter) : undefined;
  const tipsRef = item.deck === "deru1000" ? tipsForItem(item, store.tips, store.chapterOfSection) : undefined;

  const save = async () => {
    const extraField = item.deck === "deru1000" ? { custom_note: extra.trim() } : { custom_example: extra.trim() };
    await db.notes.put({ ...note, id, mnemonic: mnemonic.trim(), wrong_note: wrong.trim(), ...extraField, updated_at: Date.now() });
    await store.reload();
    setSaved(true);
  };

  const chosenText = (l: ReviewLog) => {
    if (l.correct || !l.chosen) return null;
    if (item.deck === "deru1000") {
      return <span className="confused-cell"> ← ({l.chosen}) を選択</span>;
    }
    const other = store.itemsById.get(l.chosen);
    return other?.deck === "kinfre" ? (
      <span className="confused-cell">
        {" "}
        ← <span lang="en">{other.word}</span> と混同
      </span>
    ) : null;
  };

  return (
    <div className="screen detail">
      <TopBar title="詳細" onBack={onBack} />
      {item.deck === "deru1000" ? (
        <section className="card">
          <Part5Head item={item} chapter={chapter} />
          <ul className="p5-choice-list" lang="en">
            {item.choices.map((_, i) => (
              <li key={i} className={LETTERS[i] === item.answer ? "correct" : ""}>
                {choiceLabel(item, i)}
              </li>
            ))}
          </ul>
          <Part5Info
            item={item}
            chapter={chapter}
            openExplanation
            tips={tipsRef}
            onOpenTips={() => setTipsOpen(true)}
            speechRate={store.settings.speechRate}
          />
        </section>
      ) : (
        <section className="card">
          <WordHead item={item} />
          <p className="sub">
            {item.section}
            {item.track !== undefined && ` / track ${item.track}`}
          </p>
          <ItemInfo item={item} speechRate={store.settings.speechRate} />
        </section>
      )}

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
          {item.deck === "deru1000" ? "メモ" : "自分の例文"}
          <textarea
            value={extra}
            onChange={(e) => (setExtra(e.target.value), setSaved(false))}
            rows={2}
            lang={item.deck === "deru1000" ? undefined : "en"}
          />
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
                    {chosenText(l)}
                  </td>
                  <td>{(l.ms / 1000).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {tipsOpen && tipsRef && <TipsSheetFor tipsRef={tipsRef} onClose={() => setTipsOpen(false)} />}
    </div>
  );
}
