import { describe, expect, it } from "vitest";
import { dbErrorHelp, dbErrorName } from "../src/data/dbError";

describe("データベースを開けないときの案内", () => {
  it("Dexie が包んだエラーの中の名前を取り出す", () => {
    expect(dbErrorName({ name: "OpenFailedError", inner: { name: "VersionError" } })).toBe("VersionError");
    expect(dbErrorName({ name: "QuotaExceededError" })).toBe("QuotaExceededError");
    expect(dbErrorName(null)).toBe("Error");
  });

  it("古い版で開いた・容量不足・保存できない状態・それ以外で、対処が変わる", () => {
    expect(dbErrorHelp({ name: "OpenFailedError", inner: { name: "VersionError" } }).title).toContain("新しい版");
    expect(dbErrorHelp({ name: "QuotaExceededError" }).title).toContain("空き容量");
    expect(dbErrorHelp({ name: "InvalidStateError" }).steps[0]).toContain("ホーム画面");
    const other = dbErrorHelp({ name: "UnknownError" });
    expect(other.name).toBe("UnknownError");
    expect(other.steps.length).toBeGreaterThan(1);
  });

  it("記録を消す操作は案内しない", () => {
    for (const name of ["VersionError", "QuotaExceededError", "InvalidStateError", "UnknownError"]) {
      const text = JSON.stringify(dbErrorHelp({ name }));
      expect(text).not.toMatch(/消去|削除|リセット/);
    }
  });
});
