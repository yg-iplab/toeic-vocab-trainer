// ホーム画面（上で「単語」「文法」を切り替える。記録は1つのまま）
import { saveSettings } from "../data/db";
import { dayStats, logsOfDeck, unit } from "../data/stats";
import { daysUntil, formatDayJa, localDay, streakDays } from "../lib/date";
import { dueItems, poolOf } from "../srs/session";
import { deckSettings, type Deck, type KinfreFormat, type Round } from "../types";
import { ProgressBar } from "./components";
import type { Store } from "./store";

const BACKUP_REMIND_DAYS = 3;

export const DECK_LABEL: Record<Deck, string> = { kinfre: "単語", deru1000: "文法 Part 5" };

export function Home({
  store,
  activeRound,
  standalone,
  onDaily,
  onContinueRound,
  onNewRound,
  onBackup,
  onGoSettings,
}: {
  store: Store;
  activeRound?: Round;
  standalone: boolean;
  onDaily: () => void;
  onContinueRound: (r: Round) => void;
  onNewRound: () => void;
  onBackup: () => void;
  onGoSettings: () => void;
}) {
  const now = Date.now();
  const today = localDay(now);
  const { settings } = store;
  const deck = settings.deck;
  const u = unit(deck);
  const { setSize } = deckSettings(settings, deck);
  const left = daysUntil(settings.examDate, now);
  const pool = poolOf(store.items, settings);
  const due = dueItems(pool, store.cards, now, store.scheduler).length;
  const todayStat = dayStats(logsOfDeck(store.logs, deck), today);
  const streak = streakDays(
    store.logs.map((l) => l.day),
    now,
  );
  const studied = pool.filter((i) => (store.cards.get(i.id)?.status ?? "new") !== "new").length;
  const missedEver = pool.filter((i) => (store.cards.get(i.id)?.miss_count ?? 0) > 0).length;
  const hasItems = store.items.some((i) => i.deck === deck);

  const daysSinceBackup = store.lastBackupAt ? Math.floor((now - store.lastBackupAt) / 86400000) : null;
  const needBackup = store.logs.length > 0 && (daysSinceBackup === null || daysSinceBackup >= BACKUP_REMIND_DAYS);

  const update = async (patch: Partial<typeof settings>) => {
    await saveSettings({ ...settings, ...patch });
    await store.reload();
  };

  return (
    <div className="screen home">
      <section className="card exam">
        <p className="exam-label">TOEIC {formatDayJa(settings.examDate)}</p>
        <p className="exam-days">{left > 0 ? <>あと <b>{left}</b> 日</> : left === 0 ? "今日が本番" : "試験日を過ぎています"}</p>
      </section>

      <div className="seg deck-switch" role="group" aria-label="教材">
        {(["kinfre", "deru1000"] as const).map((d) => (
          <button key={d} className={deck === d ? "on" : ""} aria-pressed={deck === d} onClick={() => deck !== d && update({ deck: d })}>
            {DECK_LABEL[d]}
          </button>
        ))}
      </div>

      {!standalone && (
        <section className="card notice">
          <p>
            <b>ホーム画面に追加して使ってください。</b>
            Safari の共有ボタン →「ホーム画面に追加」。追加したアプリの中で教材を読み込むと、記録が消えにくくなります。
          </p>
        </section>
      )}

      {needBackup && (
        <section className="card warn">
          <p>
            {daysSinceBackup === null ? "まだバックアップがありません。" : `最後のバックアップから${daysSinceBackup}日たちました。`}
            記録を守るために書き出しておきましょう。
          </p>
          <button className="btn small" onClick={onBackup}>
            いま書き出す
          </button>
        </section>
      )}

      {!hasItems ? (
        <section className="card">
          <h2>はじめに</h2>
          <ol className="steps">
            <li>「設定」→「教材データを読み込む」</li>
            <li>
              Drive の <code>{deck === "deru1000" ? "deru1000/chapters" : "kinfre/chapters"}</code> の章ファイル（.md）をまとめて選ぶ
            </li>
            <li>ホームに戻って「周回を始める」</li>
          </ol>
          <button className="btn" onClick={onGoSettings}>
            設定を開く
          </button>
        </section>
      ) : (
        <>
          <section className="card">
            <h2>今日の学習</h2>
            <p className="kpi">
              復習の時期が来た{deck === "deru1000" ? "問題" : "語"} <b>{due}</b>
              <span className="sub">
                今日 {todayStat.answered}問・正解 {todayStat.correct}
              </span>
            </p>
            {deck === "kinfre" && (
              <div className="seg" role="group" aria-label="出題形式">
                {(["mc", "flip"] as KinfreFormat[]).map((f) => (
                  <button key={f} className={settings.format === f ? "on" : ""} onClick={() => update({ format: f })}>
                    {f === "mc" ? "4択" : "めくる"}
                  </button>
                ))}
              </div>
            )}
            <button className="btn big" onClick={onDaily}>
              今日の学習（{setSize}問）
            </button>
            <p className="hint">
              ミスした{deck === "deru1000" ? "問題" : "語"}・忘れかけの{deck === "deru1000" ? "問題" : "語"}が約{Math.round(settings.reviewRatio * 10)}割、ほかの
              {deck === "deru1000" ? "問題" : "語"}が約{10 - Math.round(settings.reviewRatio * 10)}割で出ます。
              {deck === "deru1000" && `目安は1問${deckSettings(settings, deck).hardMs / 1000}秒以内。`}
            </p>
          </section>

          <section className="card">
            <h2>周回</h2>
            {activeRound ? (
              <>
                <p className="round-label">{activeRound.label}</p>
                <ProgressBar value={activeRound.cursor} max={activeRound.itemIds.length} label="周回の進み具合" />
                <p className="sub">
                  {activeRound.cursor} / {activeRound.itemIds.length} {u}
                </p>
                <button className="btn big" onClick={() => onContinueRound(activeRound)}>
                  続きから（{Math.min(setSize, activeRound.itemIds.length - activeRound.cursor)}問）
                </button>
                <button className="btn ghost" onClick={onNewRound}>
                  別の周回を始める
                </button>
              </>
            ) : (
              <>
                <p className="sub">1周目・2周目と、範囲を決めて順番に回します。</p>
                <button className="btn big" onClick={onNewRound}>
                  周回を始める
                </button>
              </>
            )}
          </section>

          <section className="card stats-row">
            <div>
              <b>{streak}</b>
              <span>連続日数</span>
            </div>
            <div>
              <b>
                {studied}/{pool.length}
              </b>
              <span>解いた{deck === "deru1000" ? "問題" : "語"}</span>
            </div>
            <div>
              <b>{missedEver}</b>
              <span>ミスした{deck === "deru1000" ? "問題" : "語"}</span>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
