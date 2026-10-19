# TOEIC単語トレーナー（個人用・非公式）

単語帳の「周回」と「ミスの記録」と「忘却曲線での復習」をまとめた、iPhone・iPad・Mac の Safari で動く Web アプリ（PWA）です。

- 4択（テンポ重視）と、めくって自己採点（Anki 風）の2つの出し方
- 1問ごとに回答を端末内に保存。何周目で間違えたか、どの語と取り違えたかまで残る
- FSRS（[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)）で次の復習日を計算し、ミスした語を多めに、ほかの語も混ぜて出題
- バックアップ（JSON）を iCloud Drive などに書き出し・読み込みできる

**このリポジトリには教材データは入っていません。** アプリは空の器で、教材は利用者が自分の端末で読み込みます。書籍・出版社とは関係のない個人用ツールです。

## 開発

```bash
npm install      # 依存パッケージを入れる
npm run dev      # 手元で起動
npm test         # 単体テスト（Vitest）
npm run e2e      # 画面の自動操作テスト（Playwright・iPhone サイズ）
npm run build    # 公開用ファイルを dist/ に作る
```

`main` に push すると `.github/workflows/deploy.yml` が型チェック・テスト・ビルドをして GitHub Pages に公開します。
