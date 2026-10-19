// 周回の始め方を選ぶ画面
import { useMemo, useState } from "react";
import { roundItemIds, type RoundScope } from "../srs/session";
import type { Round } from "../types";
import { TopBar } from "./components";
import type { Store } from "./store";

type Choice = "all" | "section" | "track" | "range";

export function RoundSetup({
  store,
  activeRound,
  nextNo,
  onStart,
  onBack,
}: {
  store: Store;
  activeRound?: Round;
  nextNo: number;
  onStart: (scope: RoundScope, label: string, order: Round["order"]) => void;
  onBack: () => void;
}) {
  const main = store.items.filter((i) => i.part === "main");
  const sections = useMemo(() => [...new Set(main.map((i) => i.section))], [main]);
  const tracks = useMemo(() => [...new Set(main.map((i) => i.track).filter((t): t is number => t !== undefined))], [main]);
  const maxNo = main.reduce((m, i) => Math.max(m, i.no), 0);

  const [choice, setChoice] = useState<Choice>("all");
  const [section, setSection] = useState(sections[0] ?? "");
  const [track, setTrack] = useState(tracks[0] ?? 1);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(Math.min(100, maxNo || 100));
  const [order, setOrder] = useState<Round["order"]>("seq");

  const { scope, label } = ((): { scope: RoundScope; label: string } => {
    switch (choice) {
      case "all":
        return { scope: { kind: "all" }, label: `本編 1–${maxNo}` };
      case "section":
        return { scope: { kind: "section", section }, label: section };
      case "track":
        return { scope: { kind: "track", track }, label: `track ${track}` };
      case "range":
        return { scope: { kind: "range", from, to }, label: `${from}–${to}` };
    }
  })();
  const count = roundItemIds(store.items, scope, "seq", Math.random).length;

  return (
    <div className="screen">
      <TopBar title="周回を始める" onBack={onBack} />
      {activeRound && (
        <p className="card warn">
          進行中の「{activeRound.label}」（{activeRound.cursor}/{activeRound.itemIds.length}）は、ここで終了扱いになります。記録は残ります。
        </p>
      )}
      <section className="card form">
        <h2>範囲</h2>
        <label className="radio">
          <input type="radio" checked={choice === "all"} onChange={() => setChoice("all")} /> 本編すべて（1–{maxNo}）
        </label>
        <label className="radio">
          <input type="radio" checked={choice === "section"} onChange={() => setChoice("section")} /> レベル別
        </label>
        {choice === "section" && (
          <select value={section} onChange={(e) => setSection(e.target.value)}>
            {sections.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        )}
        <label className="radio">
          <input type="radio" checked={choice === "track"} onChange={() => setChoice("track")} /> track 別（100語ずつ）
        </label>
        {choice === "track" && (
          <select value={track} onChange={(e) => setTrack(Number(e.target.value))}>
            {tracks.map((t) => (
              <option key={t} value={t}>
                track {t}
              </option>
            ))}
          </select>
        )}
        <label className="radio">
          <input type="radio" checked={choice === "range"} onChange={() => setChoice("range")} /> 番号で指定
        </label>
        {choice === "range" && (
          <div className="range-inputs">
            <input type="number" inputMode="numeric" min={1} max={maxNo} value={from} onChange={(e) => setFrom(Number(e.target.value))} />
            <span>〜</span>
            <input type="number" inputMode="numeric" min={1} max={maxNo} value={to} onChange={(e) => setTo(Number(e.target.value))} />
          </div>
        )}
        <h2>順番</h2>
        <div className="seg">
          <button className={order === "seq" ? "on" : ""} onClick={() => setOrder("seq")}>
            番号順
          </button>
          <button className={order === "shuffle" ? "on" : ""} onClick={() => setOrder("shuffle")}>
            シャッフル
          </button>
        </div>
      </section>
      <button className="btn big" disabled={count === 0} onClick={() => onStart(scope, label, order)}>
        {nextNo}周目を始める（{count}語）
      </button>
    </div>
  );
}
