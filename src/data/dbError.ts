// 端末内のデータベースを開けなかったときに、理由と対処を出す（「読み込み中…」のまま止まらないように）
// 記録を消す操作は案内しない（Safari の「Web サイトデータを消去」などをすると記録が消える）

export type DbErrorHelp = { name: string; title: string; steps: string[] };

/** Dexie はエラーを包むことがある（OpenFailedError の中に VersionError など）。中の名前を取り出す */
export function dbErrorName(e: unknown): string {
  const err = e as { name?: string; inner?: { name?: string } } | null;
  return err?.inner?.name ?? err?.name ?? "Error";
}

export function dbErrorHelp(e: unknown): DbErrorHelp {
  const name = dbErrorName(e);
  const reopen = "アプリを完全に閉じて（ホーム画面の下から上へスワイプして消す）、もう一度開く";
  const tell = "それでも直らなければ、この画面の文をそのまま AI に伝える";
  switch (name) {
    case "VersionError":
      return {
        name,
        title: "この端末には、いま開いている版より新しい版のアプリで作った記録があります",
        steps: [`電波のある所で、${reopen}（新しい版が読み込まれます）`, tell],
      };
    case "QuotaExceededError":
      return {
        name,
        title: "端末の空き容量が足りず、記録を開けません",
        steps: ["写真やアプリを消して空きを作る", reopen, tell],
      };
    case "InvalidStateError":
    case "SecurityError":
      return {
        name,
        title: "このブラウザの状態では、端末の中に記録を保存できません（プライベートブラウズなど）",
        steps: ["ホーム画面に追加したアプリのアイコンから開く", tell],
      };
    default:
      return {
        name,
        title: "端末の中のデータベースに、一時的につながりません",
        steps: [reopen, "直らなければ iPhone を再起動してから開く", tell],
      };
  }
}
