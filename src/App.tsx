// 画面の切り替え
import { useEffect, useState } from "react";
import { db } from "./data/db";
import { ensurePersisted, isStandalone } from "./data/persist";
import { pickActiveRound, pickNextRoundNo, roundDeck, startMissedRound, startRound } from "./data/rounds";
import { logsOfDeck, newIntroducedOn, recentMissIds, roundStats } from "./data/stats";
import { localDay } from "./lib/date";
import { buildDailySet, buildRoundSet, poolOf, type RoundScope } from "./srs/session";
import type { Round } from "./types";
import { Detail } from "./ui/Detail";
import { Home } from "./ui/Home";
import { Records } from "./ui/Records";
import { Result } from "./ui/Result";
import { RoundSetup } from "./ui/RoundSetup";
import { exportBackup, Settings } from "./ui/Settings";
import { useStore } from "./ui/store";
import { Study, type AnswerResult, type Session } from "./ui/Study";
import { TipsList } from "./ui/Tips";

type Tab = "home" | "records" | "settings";
type Screen =
  | { name: Tab }
  | { name: "roundSetup" }
  | { name: "tips" }
  | { name: "study"; session: Session }
  | { name: "result"; session: Session; results: AnswerResult[] }
  | { name: "detail"; id: string; back: Screen };

export default function App() {
  const store = useStore();
  const [screen, setScreen] = useState<Screen>({ name: "home" });
  const [studyKey, setStudyKey] = useState(0);
  const [standalone] = useState(isStandalone);

  // 起動のたびに「データを消さないで」と頼む
  useEffect(() => {
    void ensurePersisted();
  }, []);

  // 進行中の周回と「何周目」は、表示中の教材ごと
  const deck = store.settings.deck;
  const activeRound = pickActiveRound(store.rounds, deck);
  const nextNo = pickNextRoundNo(store.rounds, deck);

  const begin = (session: Session) => {
    if (session.questions.length === 0) {
      alert("いま出せる問題がありません。教材の読み込みや設定を確かめてください。");
      return;
    }
    setStudyKey((k) => k + 1);
    setScreen({ name: "study", session });
  };

  const startDaily = () => {
    const now = Date.now();
    const deckLogs = logsOfDeck(store.logs, deck);
    const questions = buildDailySet({
      items: store.items,
      cards: store.cards,
      settings: store.settings,
      now,
      rng: Math.random,
      scheduler: store.scheduler,
      newIntroducedToday: newIntroducedOn(deckLogs, localDay(now)),
      recentMissIds: recentMissIds(deckLogs, now),
    });
    begin({ deck, mode: "daily", label: "今日の学習", questions });
  };

  const continueRound = async (r: Round) => {
    const fresh = (await db.rounds.get(r.rid!)) ?? r;
    const rDeck = roundDeck(fresh);
    const questions = buildRoundSet(fresh, store.itemsById, poolOf(store.items, store.settings, rDeck), store.settings, Math.random);
    begin({ deck: rDeck, mode: "round", label: fresh.label, questions, rid: fresh.rid, roundNo: fresh.no });
  };

  const newRound = async (scope: RoundScope, label: string, order: Round["order"]) => {
    const r = await startRound(store.items, scope, label, order, Math.random, Date.now(), deck);
    await store.reload();
    await continueRound(r);
  };

  const missedRound = async (parent: Round, ids: string[]) => {
    const r = await startMissedRound(parent, ids, Date.now());
    await store.reload();
    await continueRound(r);
  };

  const finish = async (session: Session, results: AnswerResult[]) => {
    await store.reload();
    if (results.length === 0) setScreen({ name: "home" });
    else setScreen({ name: "result", session, results });
  };

  const tab: Tab | null = screen.name === "home" || screen.name === "records" || screen.name === "settings" ? screen.name : null;

  if (!store.loaded) return <div className="screen loading">読み込み中…</div>;

  let body;
  switch (screen.name) {
    case "home":
      body = (
        <Home
          store={store}
          activeRound={activeRound}
          standalone={standalone}
          onDaily={startDaily}
          onContinueRound={continueRound}
          onNewRound={() => setScreen({ name: "roundSetup" })}
          onBackup={() => exportBackup(store)}
          onGoSettings={() => setScreen({ name: "settings" })}
          onOpenTips={() => setScreen({ name: "tips" })}
        />
      );
      break;
    case "records":
      body = <Records store={store} onOpen={(id) => setScreen({ name: "detail", id, back: screen })} onMissedRound={missedRound} />;
      break;
    case "settings":
      body = <Settings store={store} />;
      break;
    case "tips":
      body = <TipsList store={store} onBack={() => setScreen({ name: "home" })} />;
      break;
    case "roundSetup":
      body = <RoundSetup store={store} activeRound={activeRound} nextNo={nextNo} onStart={newRound} onBack={() => setScreen({ name: "home" })} />;
      break;
    case "study":
      body = <Study key={studyKey} store={store} session={screen.session} onFinish={(res) => finish(screen.session, res)} />;
      break;
    case "result": {
      const round = screen.session.rid !== undefined ? store.rounds.find((r) => r.rid === screen.session.rid) : undefined;
      const missedIds = round ? (roundStats([round], store.logs)[0]?.missedIds ?? []) : [];
      body = (
        <Result
          session={screen.session}
          results={screen.results}
          round={round}
          roundMissedIds={missedIds}
          onAgain={() => (screen.session.mode === "round" && round ? continueRound(round) : startDaily())}
          onMissedRound={() => round && missedRound(round, missedIds)}
          onHome={() => setScreen({ name: "home" })}
          onOpen={(id) => setScreen({ name: "detail", id, back: screen })}
        />
      );
      break;
    }
    case "detail":
      body = <Detail key={screen.id} store={store} id={screen.id} onBack={() => setScreen(screen.back)} />;
      break;
  }

  return (
    <div className="app">
      <main>{body}</main>
      {tab && (
        <nav className="tabbar" aria-label="メニュー">
          {(
            [
              ["home", "ホーム", "⌂"],
              ["records", "記録", "☰"],
              ["settings", "設定", "⚙"],
            ] as const
          ).map(([name, label, icon]) => (
            <button key={name} className={tab === name ? "on" : ""} onClick={() => setScreen({ name })}>
              <span aria-hidden>{icon}</span>
              {label}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
