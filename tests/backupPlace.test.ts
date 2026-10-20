// バックアップの保存先：書き出すたびに案内する場所を設定に持つ。共有にはファイルだけを渡す
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBackup, saveTextFile } from "../src/data/backup";
import { getSettings, saveSettings, setMeta, TrainerDB, useDatabase } from "../src/data/db";
import { DEFAULT_BACKUP_PLACE, DEFAULT_SETTINGS } from "../src/types";
import { backupDoneMessage } from "../src/ui/Settings";

let n = 0;
beforeEach(() => {
  useDatabase(new TrainerDB(`place-${++n}`));
});

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  delete g.navigator;
});

describe("バックアップの保存先", () => {
  it("既定は iCloud Drive の決まったフォルダ。前の版の設定（保存先なし）にも既定が足される", async () => {
    expect(DEFAULT_SETTINGS.backupPlace).toBe(DEFAULT_BACKUP_PLACE);
    expect(DEFAULT_BACKUP_PLACE).toContain("iCloud Drive");
    await setMeta("settings", { setSize: 15, speechRate: 0.8 }); // v0.4 までの設定
    expect(await getSettings()).toMatchObject({ setSize: 15, speechRate: 0.8, backupPlace: DEFAULT_BACKUP_PLACE, kinfreAlwaysExplain: true });
  });

  it("変えた保存先は残り、バックアップの設定にも入る（教材の文は入らない）", async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, backupPlace: "架空ドライブ › 保管" });
    expect((await getSettings()).backupPlace).toBe("架空ドライブ › 保管");
    const b = await buildBackup(Date.now());
    const settings = b.meta.find((m) => m.key === "settings")?.value as { backupPlace: string };
    expect(settings.backupPlace).toBe("架空ドライブ › 保管");
  });

  it("書き出したあとの案内に、ファイル名と保存先が出る", () => {
    expect(backupDoneMessage("toeic-trainer-backup-20261020-0703.json", DEFAULT_BACKUP_PLACE)).toBe(
      `バックアップ（toeic-trainer-backup-20261020-0703.json）を書き出しました。保存先「${DEFAULT_BACKUP_PLACE}」に入っているか、「ファイル」アプリで確かめてください。`,
    );
  });

  it("共有の画面にはファイルだけを渡す（title を渡すと iPhone がファイル名だけの .txt も保存するため）", async () => {
    const shared: ShareData[] = [];
    (globalThis as Record<string, unknown>).navigator = {
      canShare: () => true,
      share: async (d: ShareData) => void shared.push(d),
    };
    expect(await saveTextFile("x.json", "{}", "application/json")).toBe(true);
    expect(shared).toHaveLength(1);
    expect(Object.keys(shared[0])).toEqual(["files"]);
    expect(shared[0].files?.[0].name).toBe("x.json");
  });

  it("共有の画面で取り消したら、書き出していない扱い", async () => {
    (globalThis as Record<string, unknown>).navigator = {
      canShare: () => true,
      share: async () => {
        throw new DOMException("cancel", "AbortError");
      },
    };
    expect(await saveTextFile("x.json", "{}", "application/json")).toBe(false);
  });
});
