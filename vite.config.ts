/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base を相対パスにして、GitHub Pages のサブパス（/リポジトリ名/）でもそのまま動くようにする
export default defineConfig({
  base: "./",
  plugins: [react()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
