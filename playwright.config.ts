import { defineConfig, devices } from "@playwright/test";

// iPhone の画面サイズで、公開版と同じビルドを動かして確かめる
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: {
    ...devices["iPhone 13"],
    browserName: "chromium",
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
