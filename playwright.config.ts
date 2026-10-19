import { defineConfig, devices } from "@playwright/test";

// iPhone の画面サイズで、公開版と同じビルドを動かして確かめる
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: {
    ...devices["iPhone 13"],
    browserName: "chromium",
    // Playwright 用のブラウザを入れられないときは、PW_CHANNEL=chrome で Mac の Google Chrome を使う
    channel: process.env.PW_CHANNEL || undefined,
    baseURL: "http://localhost:4173/",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  },
  webServer: {
    command: "npx vite build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
