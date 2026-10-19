// 周回の始め方を選ぶ画面（表示中の教材ごとに範囲の選び方が変わる）
import { useEffect, useMemo, useState } from "react";
import { unit } from "../data/stats";
import { isMockChapter, roundItemIds, type RoundScope } from "../srs/session";
import type { DeruItem, KinfreItem, Round } from "../types";
import { TopBar } from "./components";
import type { Store } from "./store";

type Props = {
  store: Store;
  activeRound?: Round;
  nextNo: number;
  onStart: (scope: RoundScope, label: string, order: Round["order"]) => void;
  onBack: () => void;
};

type Picked = { scope: RoundScope; label: string };

export function RoundSetup(props: Props) {
  const deck = props.store.settings.deck;
  const [order, setOrder] = useState<Round["order"]>("seq");
  const [picked, setPicked] = useState<Picked | null>(null);
  const scope = picked ?? { scope: { kind: "all" } as RoundScope, label: "" };
  const count = roundItemIds(props.store.items, scope.scope, "seq", Math.random, deck).length;
  const { activeRound, nextNo } = props;

  return (
    <div className="screen">
      <TopBar title="周回を始める" onBack={props.onBack} />
      {activeRound && (
        <p className="card warn">
          進行中の「{activeRound.label}」（{activeRound.cursor}/{activeRound.itemIds.length}）は、ここで終了扱いになります。記録は残ります。
        </p>
      )}
      <section className="card form">
        <h2>範囲</h2>
        {deck === "deru1000" ? <DeruScope store={props.store} onChange={setPicked} /> : <KinfreScope store={props.store} onChange={setPicked} />}
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
      <button className="btn big" disabled={count === 0 || !picked} onClick={() => picked && props.onStart(picked.scope, picked.label, order)}>
        {nextNo}周目を始める（{count}
        {unit(deck)}）
      </button>
    </div>
  );
}

/** 選んだ範囲が変わったら親に知らせる */
function useReport(onChange: (p: Picked) => void, p: Picked) {
  const key = JSON.stringify(p);
  useEffect(() => onChange(p), [key]);
}

function KinfreScope({ store, onChange }: { store: Store; onChange: (p: Picked) => void }) {
  type Choice = "all" | "section" | "track" | "range";
  const main = useMemo(() => store.items.filter((i): i is KinfreItem => i.deck === "kinfre" && i.part === "main"), [store.items]);
  const sections = useMemo(() => [...new Set(main.map((i) => i.section))], [main]);
  const tracks = useMemo(() => [...new Set(main.map((i) => i.track).filter((t): t is number => t !== undefined))], [main]);
  const maxNo = main.reduce((m, i) => Math.max(m, i.no), 0);

  const [choice, setChoice] = useState<Choice>("all");
  const [section, setSection] = useState(sections[0] ?? "");
  const [track, setTrack] = useState(tracks[0] ?? 1);
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(Math.min(100, maxNo || 100));

  const picked = ((): Picked => {
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
  useReport(onChange, picked);

  return (
    <>
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
    </>
  );
}

function DeruScope({ store, onChange }: { store: Store; onChange: (p: Picked) => void }) {
  type Choice = "all" | "chapters" | "mocks" | "chapter" | "block" | "mock" | "range";
  const items = useMemo(() => store.items.filter((i): i is DeruItem => i.deck === "deru1000"), [store.items]);
  const keys = useMemo(() => {
    const present = new Set(items.map((i) => i.chapter));
    const order = (k: string) => store.chapters.get(k)?.order ?? 999;
    return [...present].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  }, [items, store.chapters]);
  const chapterKeys = keys.filter((k) => !isMockChapter(k));
  const mockKeys = keys.filter(isMockChapter);
  const labelOf = (k: string) => store.chapters.get(k)?.label ?? k;
  const minNo = items.reduce((m, i) => Math.min(m, i.no), Infinity);
  const maxNo = items.reduce((m, i) => Math.max(m, i.no), 0);

  const [choice, setChoice] = useState<Choice>(chapterKeys.length ? "chapter" : mockKeys.length ? "mock" : "all");
  const [chapter, setChapter] = useState(chapterKeys[0] ?? "");
  const [blockChapter, setBlockChapter] = useState(chapterKeys[0] ?? "");
  const blocks = useMemo(
    () => [...new Set(items.filter((i) => i.chapter === blockChapter).sort((a, b) => a.order - b.order).map((i) => i.block))],
    [items, blockChapter],
  );
  const [block, setBlock] = useState(blocks[0] ?? "");
  const [mock, setMock] = useState(mockKeys[0] ?? "");
  const [from, setFrom] = useState(Number.isFinite(minNo) ? minNo : 1);
  const [to, setTo] = useState(Number.isFinite(minNo) ? Math.min(maxNo, minNo + 29) : 30);
  const blockNow = blocks.includes(block) ? block : (blocks[0] ?? "");

  const count = (kind: RoundScope) => roundItemIds(store.items, kind, "seq", Math.random, "deru1000").length;

  const picked = ((): Picked => {
    switch (choice) {
      case "all":
        return { scope: { kind: "all" }, label: "文法すべて" };
      case "chapters":
        return { scope: { kind: "chapters" }, label: "章すべて" };
      case "mocks":
        return { scope: { kind: "mocks" }, label: "模試すべて" };
      case "chapter":
        return { scope: { kind: "chapter", chapter }, label: labelOf(chapter) };
      case "block":
        return { scope: { kind: "block", chapter: blockChapter, block: blockNow }, label: `${labelOf(blockChapter)}・${blockNow}` };
      case "mock":
        return { scope: { kind: "chapter", chapter: mock }, label: labelOf(mock) };
      case "range":
        return { scope: { kind: "range", from, to }, label: `${String(from).padStart(4, "0")}–${String(to).padStart(4, "0")}` };
    }
  })();
  useReport(onChange, picked);

  const radio = (c: Choice, text: string) => (
    <label className="radio">
      <input type="radio" checked={choice === c} onChange={() => setChoice(c)} /> {text}
    </label>
  );
  const chapterSelect = (value: string, set: (v: string) => void, list: string[], aria: string) => (
    <select value={value} onChange={(e) => set(e.target.value)} aria-label={aria}>
      {list.map((k) => (
        <option key={k} value={k}>
          {labelOf(k)}（{count({ kind: "chapter", chapter: k })}問）
        </option>
      ))}
    </select>
  );

  return (
    <>
      {chapterKeys.length > 0 && radio("chapter", "章ごと")}
      {choice === "chapter" && chapterSelect(chapter, setChapter, chapterKeys, "章")}
      {chapterKeys.length > 0 && radio("block", "ブロックごと（章の中の区切り）")}
      {choice === "block" && (
        <>
          {chapterSelect(blockChapter, setBlockChapter, chapterKeys, "ブロックの章")}
          <select value={blockNow} onChange={(e) => setBlock(e.target.value)} aria-label="ブロック">
            {blocks.map((b) => (
              <option key={b} value={b}>
                {b}（{count({ kind: "block", chapter: blockChapter, block: b })}問）
              </option>
            ))}
          </select>
        </>
      )}
      {mockKeys.length > 0 && radio("mock", "模試セットごと")}
      {choice === "mock" && chapterSelect(mock, setMock, mockKeys, "模試セット")}
      {chapterKeys.length > 0 && radio("chapters", `章すべて（${count({ kind: "chapters" })}問）`)}
      {mockKeys.length > 0 && radio("mocks", `模試すべて（${count({ kind: "mocks" })}問）`)}
      {radio("all", `すべて（${items.length}問）`)}
      {radio("range", "番号で指定")}
      {choice === "range" && (
        <div className="range-inputs">
          <input type="number" inputMode="numeric" min={minNo} max={maxNo} value={from} onChange={(e) => setFrom(Number(e.target.value))} aria-label="から" />
          <span>〜</span>
          <input type="number" inputMode="numeric" min={minNo} max={maxNo} value={to} onChange={(e) => setTo(Number(e.target.value))} aria-label="まで" />
        </div>
      )}
    </>
  );
}
