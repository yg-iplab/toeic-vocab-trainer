// 端末内のデータベースを開けなかったときの画面（理由と対処。記録を消す操作は案内しない）
import { dbErrorHelp } from "../data/dbError";

export function DbErrorScreen({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const help = dbErrorHelp(error);
  const detail = (error as { message?: string } | null)?.message ?? "";
  return (
    <div className="screen db-error" role="alert">
      <section className="card warn">
        <h2>記録のデータベースを開けません</h2>
        <p>{help.title}</p>
        <ol className="steps">
          {help.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="sub">記録は消えていません。Safari の「履歴と Web サイトデータを消去」はしないでください（記録が消えます）。</p>
        <button className="btn" onClick={onRetry}>
          もう一度読み込む
        </button>
        <p className="sub db-error-detail">
          エラー：{help.name}
          {detail ? `（${detail}）` : ""}
        </p>
      </section>
    </div>
  );
}
