// ブラウザに「このアプリのデータを勝手に消さないで」と頼む（navigator.storage.persist）
// iPhone ではホーム画面に追加したアプリのとき許可されやすい。起動のたびに頼む

export type PersistState = "persisted" | "not-persisted" | "unsupported";

export async function ensurePersisted(): Promise<PersistState> {
  const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!storage?.persist || !storage.persisted) return "unsupported";
  try {
    if (await storage.persisted()) return "persisted";
    return (await storage.persist()) ? "persisted" : "not-persisted";
  } catch {
    return "not-persisted";
  }
}

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true;
}
