# MITUBEI（ミツベイ）

株式会社Stark Lab の見積書作成・価格表管理システム。価格表から項目を選んで見積書を作り、PDF で出力します。
複数の企業が月額契約で使うマルチテナント SaaS です。

## 構成

```
mitsubei/
├── web/      Next.js（App Router）… 画面・BFF・PDF 生成（Vercel）
├── worker/   Cloudflare Workers + D1 … API・認証・データベース
└── shared/   画面と API で共通の金額計算・採番ロジック（外部依存なし）
```

```
ブラウザ ──(httpOnly Cookie)──▶ Next.js（/api/*）──(内部用の秘密値 + Cookie)──▶ Workers API ──▶ D1
```

- ブラウザが通信するのは Next.js だけです。Workers の URL と内部用の秘密値はブラウザに渡しません。
- Workers は `x-mitubei-internal-secret`（Next.js サーバーとだけ共有）がないリクエストをすべて拒否します。
- 技術：Next.js 16 / TypeScript（strict）/ Tailwind CSS 4 / Cloudflare Workers（Hono）/ D1 / Drizzle ORM / Zod / Better Auth / @react-pdf/renderer / Lucide React

## 実装済みの機能

| 画面 | 内容 |
|---|---|
| ホーム | 今月の作成件数、今月の見積金額合計（税込・税抜）、保存済み件数、最近の見積書、検索、新規作成 |
| 見積書作成・編集 | 基本情報、顧客から宛先を選択、明細の追加・削除・並び替え、価格表から追加（続けて複数追加）、直接入力、小数の数量・単価、税区分（10% / 8% / 非課税）、値引き、税率ごとの集計、下書き保存（Ctrl+S）、未保存の警告 |
| 見積書詳細 | PDF プレビュー・ダウンロード・印刷、発行、ステータス変更（発行済み / 受注 / 失注）、改訂版作成、複製、削除（確認ダイアログ・権限確認）、改訂の履歴 |
| 見積書履歴 | キーワード検索（番号・宛先・件名・工事名）、発行日の範囲、ステータス絞り込み、並び替え、ページ分割 |
| 価格表 | 登録・編集・削除・無効化、名前 / コード / 規格で検索、カテゴリ絞り込みと管理、価格順の並び替え、CSV 一括登録（文字コード自動判定・列の対応付け・プレビュー・行ごとの検証・重複時の上書き / スキップ）、CSV 出力（Excel 用 BOM 付き） |
| 顧客 | 登録・編集・削除（見積書の宛先は見積書側に保存されるため影響なし） |
| 設定 | 自社情報（会社名・住所・電話・メール・振込先・登録番号）、会社ロゴ、社印（角印。PDF の会社名に重ねて表示）、承認欄（「承認」「担当」などの押印枠。最大4つ）、採番ルール、明細金額と消費税の端数処理、有効期限・備考の初期値、一般社員の価格表編集の許可 |
| 社員管理（管理者） | 社員の追加、権限変更、利用停止・再開、パスワード再設定 |
| その他 | ログイン・ログアウト、パスワード変更、操作ログ（管理者）、利用規約・プライバシーポリシー・特定商取引法の表記（仮の文面）、PWA |

### 金額計算（`shared/calc.ts`）

- 浮動小数点を使わず、整数（BigInt）で計算します。数量は小数3桁、単価は小数2桁まで。DB には「数量×1000」「単価×100」の整数で保存します。
- 明細金額 = 数量 × 単価。1円未満は企業設定の端数処理（切り捨て / 四捨五入 / 切り上げ）。
- 消費税は **税率ごとの合計に対して、見積書1通につき1回だけ** 端数処理します（適格請求書等保存方式のルール）。明細ごとに税額を出して合計することはしません。
- 値引きは税抜金額で入力し、税率ごとの明細合計の比率で配分します（最大剰余法で、配分の合計は必ず値引き額に一致）。
- 保存時は API が同じロジックで計算し直します。画面から送られた金額は使いません。
- 見積書には計算に使った端数処理の設定を保存します。企業設定を変えても、過去の見積書の金額は変わりません。

### 見積書の確定と履歴

- **発行**すると内容が確定し、編集できなくなります。発行時点の自社情報（ロゴを含む）と見積書全体のスナップショットを `estimate_revisions` に保存します。
- 変更が必要なときは **改訂版を作成** します（`2026-0001-R1`、`-R2` …）。元の見積書はそのまま残り、同じ系列として関連付けられます。
- 価格表から追加した明細は、追加した時点の名称・単価を見積書に保存します。価格表の単価を変えても、作成済みの見積書は変わりません。
- 宛先も見積書側に保存するため、顧客情報を変えても作成済みの見積書は変わりません。
- 同時に編集した場合は、古い内容での保存を 409 で拒否します（楽観ロック）。

### 見積書番号の採番

- 書式：接頭辞（`{YYYY}` `{YY}` `{MM}` を置換）＋ゼロ埋めの連番。リセットは毎年・毎月・なしから選べます。既定は `2026-0001`。
- 企業 × 期間ごとのカウンターを `INSERT … ON CONFLICT DO UPDATE … RETURNING` の1文で進めるため、同時に作成しても重複しません（テストで20件同時作成を確認）。
- 番号は手入力でも変更できます。企業内で重複した場合は 409 を返します。手入力で使われた番号に自動採番が当たった場合は、次の番号を使います。

## 認証・権限・企業間のデータ分離

- **Better Auth**（オープンソース、無料）を Workers で動かし、ユーザー・セッションは D1 に保存します。
- パスワードは PBKDF2-SHA256（10万回、WebCrypto）でハッシュ化して保存します。平文では保存しません。
- セッション Cookie は署名付き・httpOnly・SameSite=Lax（本番は `__Secure-` 付きで Secure）、有効期限は14日です（`SESSION_TTL_DAYS`）。
- 自己登録はできません。企業と最初の管理者は運営者がスクリプトで作成し、社員は管理者が画面から追加します。会社コードや専用 URL だけでログインする方式はありません。
- 不正ログイン対策：IP ごとのレート制限（15分で30回）、メールアドレスごとの試行回数制限（15分で10回）、利用停止中の社員・契約停止中の企業はログイン不可。
- API 全体のレート制限：ユーザーごとに60秒で300回（Workers Rate Limiting）。
- **企業ID はセッションから Workers 側で確定** し、リクエスト本文やクエリの値は使いません。すべての SQL が `organization_id = セッションの企業` を条件にしています。他社の ID を指定した場合は 404 を返します（存在も明かしません）。
- 子テーブル（明細・改訂履歴・見積書の顧客・価格表のカテゴリ・企業設定のロゴ）は `(親ID, organization_id)` の複合外部キーで参照します。DB のレベルでも、別企業の親にぶら下がる行は作れません。

| 操作 | 管理者 | 一般社員 |
|---|---|---|
| 見積書の作成・編集・発行・複製・改訂 | ○ | ○ |
| 見積書の削除 | ○（すべて） | 自分が作った下書きのみ |
| 価格表の閲覧 | ○ | ○ |
| 価格表の登録・編集・CSV 一括登録 | ○ | 企業設定で許可した場合のみ |
| 顧客の登録・編集 | ○ | ○ |
| 企業設定・ロゴ・社員管理・操作ログ | ○ | × |

### その他のセキュリティ対策

- SQL インジェクション：すべてプレースホルダ（Drizzle / D1 の bind）。LIKE 検索の `% _ \` はエスケープします。
- XSS：React のエスケープに任せ、`dangerouslySetInnerHTML` は使いません。ロゴは PNG / JPEG のみで、ファイルの先頭のバイト列から形式とサイズを判定します（SVG は不可）。
- CSRF：状態を変えるリクエストは、Next.js と Workers の両方で Origin を確認します。Better Auth の CSRF 確認も有効です。
- CSV インジェクション：出力時、`= + - @` で始まるセルの先頭に `'` を付けます。
- セキュリティヘッダー：`X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、`Permissions-Policy`、CSP の `frame-ancestors`、本番は HSTS。
- ログには、メソッド・パス（ID は伏せ字）・ステータス・処理時間だけを出します。顧客情報や金額は出しません。Drizzle のエラー文に含まれるバインド値もログから除きます。
- 操作ログ（`audit_logs`）には、操作の種類・対象の ID・件数などだけを保存します（個人情報・金額は保存しない）。

## データベース（Cloudflare D1）

スキーマは `worker/src/db/schema.ts`（Drizzle）、マイグレーションは `worker/migrations/` にあります。

| テーブル | 内容 |
|---|---|
| `organizations` | 契約企業（`status`：active / suspended） |
| `users` / `sessions` / `accounts` / `verifications` / `rate_limits` | 認証（Better Auth） |
| `organization_memberships` | 所属と権限（admin / member、active / disabled）。初期版は1ユーザー1企業 |
| `organization_settings` | 自社情報・採番・端数処理・初期値・一般社員の価格表編集の許可 |
| `organization_logos` | 会社ロゴ（PNG / JPEG、300KB まで）。発行済みの見積書が参照するため、古いロゴも残す |
| `estimate_number_counters` | 見積書番号の連番（企業 × 期間） |
| `customers` | 顧客。`telkal_customer_id` は将来の TELKAL 連携用（企業内で一意） |
| `price_categories` / `price_items` | 価格表。単価は1/100円単位の整数、商品コードは企業内で一意 |
| `estimates` / `estimate_items` | 見積書と明細。宛先・単価・端数処理・発行時点の自社情報を見積書側に保存 |
| `estimate_revisions` | 発行時点のスナップショット（上書き防止・履歴） |
| `audit_logs` | 操作ログ |
| `login_attempts` | メールアドレスごとのログイン試行回数 |

### TELKAL との顧客 ID

- MITUBEI の顧客 ID（`customers.id`）は MITUBEI 独自の UUID です。
- TELKAL の顧客と対応付けるときは `customers.telkal_customer_id` に TELKAL 側の顧客 ID を保存します（企業内で一意）。初期版では自動同期はしません。

スキーマを変えたときは `cd worker && npm run db:generate` でマイグレーション SQL を作ります。

## 必要な環境変数

| 場所 | 変数 | 内容 |
|---|---|---|
| `web/.env.local`（本番は Vercel の環境変数） | `WORKER_API_URL` | Workers API の URL（ローカルは `http://localhost:8787`） |
| | `INTERNAL_API_SECRET` | Workers と共有する秘密値（32バイト以上のランダム文字列） |
| `worker/.dev.vars`（本番は `wrangler secret put`） | `INTERNAL_API_SECRET` | 上と同じ値 |
| | `BETTER_AUTH_SECRET` | セッション Cookie の署名用（32バイト以上のランダム文字列） |
| `worker/wrangler.jsonc` の `vars` | `APP_ORIGINS` | 画面の公開 URL（現在は `https://mitsubei-web.vercel.app`）。Cookie の発行先と Origin の確認に使う。ローカルは `.dev.vars` で `http://localhost:3000` に上書き |
| | `SESSION_TTL_DAYS` | セッションの有効日数（既定 14） |

秘密値は次のコマンドで作れます。

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`.dev.vars` と `.env.local` は `.gitignore` 済みです。コミットしないでください。

## ローカルで起動する

Node.js 22 以上が必要です。

```bash
cd worker && npm install && cp .dev.vars.example .dev.vars
```

`worker/.dev.vars` の2つの値を、上のコマンドで作ったランダムな文字列に変えます。続けてローカルの D1 を作り、テスト用データを入れます。

```bash
npm run db:migrate:local && npm run db:seed:local
```

```bash
npm run dev
```

別のターミナルで画面側を起動します。

```bash
cd web && npm install && cp .env.example .env.local
```

`web/.env.local` の `INTERNAL_API_SECRET` を `worker/.dev.vars` と同じ値にしてから、次を実行します。

```bash
npm run dev
```

http://localhost:3000 を開き、テスト用アカウントでログインします。

| 企業 | 権限 | メールアドレス | パスワード |
|---|---|---|---|
| 山田設備工業（テスト） | 管理者 | demo@example.com | mitubei-demo-2026 |
| 山田設備工業（テスト） | 一般社員 | staff@example.com | mitubei-staff-2026 |
| 別会社建設（テスト） | 管理者 | other@example.com | mitubei-other-2026 |

2社とも同じ名前の商品・顧客を持っていますが、それぞれ自社のものしか表示されません。

## PDF 生成

- `web/src/app/api/estimates/[id]/pdf/route.ts`（Next.js のサーバー側）で、`@react-pdf/renderer` を使って A4 縦の PDF を作ります。
- 日本語フォントは `web/assets/fonts/` の Noto Sans JP（Regular / Bold、SIL Open Font License 1.1、`OFL.txt` 同梱）です。PDF には使った文字だけを埋め込むため、ファイルは 50KB 前後です。
- 明細が多い場合は自動で改ページします。明細の行は途中で切らず、2ページ目以降には見積書番号・宛先の見出しを付けます。全ページの下部に「ページ番号 / 総ページ数」を表示します。
- 金額欄は 1兆円未満まで、桁があふれない幅にしています。日本語は文字単位で折り返し、英数字の型番は途中で切りません。
- ファイル名：`MITUBEI_見積書_<見積書番号>.pdf`。プレビューは画面内に表示し、ダウンロードと印刷のボタンがあります（スマートフォンでは別タブで開く）。
- 下書きの PDF は現在の企業設定、発行済みの PDF は発行時点の自社情報で作ります。

## テスト

```bash
cd worker && npm test
```

- `test/calc.test.ts`（17件）：小数の解析、端数処理、浮動小数点の誤差が出ないこと、税率ごとの税額計算、値引きの配分、大きな金額、採番の書式。
- `test/api.test.ts`（34件）：結合テストです。使い捨てのローカル D1 にマイグレーションとテスト用データを入れ、本物の Worker を起動して API を呼びます。開発用の DB には触れません。
  - 認証：秘密値なしの拒否、未ログイン、誤ったパスワード、サインアップ不可、試行回数のロック、ログアウト
  - CSRF：他の Origin・Origin なしの拒否
  - 企業間のデータ分離：他社の見積書（取得・編集・発行・複製・改訂・削除・PDF）、顧客、価格表、カテゴリ、ロゴ、一覧・集計、`organizationId` の混入
  - 権限：一般社員の価格表編集・企業設定・社員管理・削除の制限、社員の追加と停止、最後の管理者の保護
  - 見積書：サーバーでの再計算、入力値の検証、20件同時作成での採番の重複なし、手入力番号の重複、楽観ロック、発行後の上書き防止・改訂版・複製、価格表の単価変更の影響なし、発行済みの宛先・自社情報の固定、履歴の検索・絞り込み・ページ分割
  - 価格表：検索・カテゴリ・価格順、商品コードの重複、CSV 一括登録（新規・上書き・スキップ・カテゴリ作成・不正行の一括拒否）、CSV 出力

画面側のチェック：

```bash
cd web && npm run lint && npm run typecheck && npm run build
```

## 性能（ローカルでの実測）

価格表 2,000件以上・見積書数十件の状態で、ブラウザ → Next.js → Workers → D1 の応答時間を実測した値です。本番では Vercel・Workers・D1 の間の通信が加わるため、本番環境で改めて計測してください。保証値ではありません。

| 操作 | 目標 | ローカル実測 |
|---|---|---|
| 価格表の検索 | 500ms 以内 | 20〜35ms |
| 見積書履歴の検索・絞り込み | 500ms 以内 | 15〜20ms |
| 見積書の保存 | 1秒以内 | 約 100〜130ms |
| PDF 生成（6行） | 3秒以内 | 約 100ms（生成部分）／50〜140ms（ダウンロード全体） |
| PDF 生成（60行・3ページ） | 3秒以内 | 0.3〜0.9秒 |
| CSV 一括登録（2,000行） | — | 約 0.15秒 |

- 検索は企業ID を先頭にした複合インデックスを使い、件数取得と一覧取得を1回の D1 バッチで行います。一覧は30〜50件ずつのページ分割です。
- CSV 一括登録と明細の保存は、JSON をまとめて渡す1文（`json_each`）で処理します。D1 の「1リクエストあたりのクエリ数」の上限にかかりません。
- 画面には直近の API 応答時間を表示しています（500ms を超えると色が変わります）。Workers・BFF の応答には `Server-Timing` ヘッダーを付けています。
- キャッシュ：API の応答は `no-store` です。画面の一時キャッシュ（SWR）はログイン・ログアウト・セッション切れのたびにページごと破棄するため、別の企業のデータが混ざりません。

## PWA

- `manifest.webmanifest`、アプリアイコン（192 / 512 / maskable / apple-touch）、favicon（SVG）を用意しています。
- Service Worker（`web/public/sw.js`、本番のみ登録）がキャッシュするのは、ビルド済みの静的ファイル（`/_next/static/`）とアイコンだけです。API・画面の HTML・顧客情報・価格表・見積書はキャッシュしません。
- オフライン時は「接続されていません」の案内だけを表示します（オフラインでの編集は対象外）。

## バックアップと復元

- **D1 Time Travel**：D1 は過去の任意の時点に戻せます（Workers Paid で30日、Free で7日）。

```bash
npx wrangler d1 time-travel info mitubei
```

```bash
npx wrangler d1 time-travel restore mitubei --timestamp=2026-11-12T10:00:00+09:00
```

- **定期的な書き出し**：SQL ファイルとして保存できます。個人情報を含むため、保存先は暗号化された安全な場所にしてください。

```bash
npx wrangler d1 export mitubei --remote --output=backup-$(date +%Y%m%d).sql
```

- 書き出したファイルからの復元（新しい DB を作って取り込む）：

```bash
npx wrangler d1 execute mitubei-restore --remote --file=backup-20261112.sql
```

## 本番公開の手順（未実施）

本番へのデプロイ・有料プランの契約・課金設定は、まだ行っていません。実施前に必ず確認してください。

1. **Cloudflare D1**：ダッシュボードで D1 データベース `mitubei` を作り（Location は Asia-Pacific）、表示された Database ID を `worker/wrangler.jsonc` の `database_id` に設定します。
2. **Cloudflare Workers**：Workers & Pages → Import a repository で `msk-0604/mitsubei` を選び、Root directory を `worker`、Deploy command を `npm run deploy`（マイグレーション適用 → デプロイ）にします。Settings → Variables and Secrets に、Secret として `INTERNAL_API_SECRET` と `BETTER_AUTH_SECRET` を追加します。`APP_ORIGINS` は本番の画面 URL に変えます。
3. **Vercel**：`msk-0604/mitsubei` をインポートし、Root Directory を `web` にします（`../shared` を読むため「Include files outside the root directory」を有効のままにする）。環境変数 `WORKER_API_URL`（手順2の URL）と `INTERNAL_API_SECRET` を設定して再デプロイします。リージョンは `web/vercel.json` で東京（hnd1）に固定しています。
4. **最初の契約企業**：次のコマンドで、企業と管理者を本番の D1 に作ります（`worker` ディレクトリで、Cloudflare にログイン済みであること）。

```bash
MITUBEI_PASSWORD='10文字以上のパスワード' npm run org:create -- --org "株式会社〇〇" --name "山田 太郎" --email you@example.com --remote
```

## 本番公開までの残作業

- [ ] Cloudflare（D1・Workers）と Vercel の本番環境の作成、独自ドメインの設定
- [ ] Workers Paid・Vercel Pro の契約判断（下の費用を参照）
- [ ] 利用規約・プライバシーポリシー・特定商取引法の表記の正式な文面
- [ ] 本番環境での性能計測（価格表検索・履歴検索・保存・PDF 生成）
- [ ] 実機（iPhone / Android / iPad）での表示・PDF・印刷・ホーム画面追加の確認
- [ ] 実際のブラウザで、PDF をダウンロードしたときのファイル名を確認（ヘッダーと `download` 属性は設定済み。自動テストのヘッドレスブラウザでは確認できなかった）
- [ ] パスワードを忘れたときの再設定メール（現状は管理者が画面から再設定）。メール送信サービスの選定が必要
- [ ] 月額契約の課金（Stripe など）と、契約停止時の `organizations.status = suspended` の連携
- [ ] D1 の定期バックアップ（書き出し）の自動化
- [ ] エラー監視（個人情報を送らない設定で）

## 未実装の機能（初期開発の範囲外）

- オフラインでの見積書編集
- TELKAL との顧客の自動同期（顧客 ID の対応付け列のみ用意）
- 1ユーザーが複数企業に所属すること（初期版は1ユーザー1企業）
- 見積書のメール送信、請求書・納品書への変換
- ダークモード
- 二段階認証

## 月額インフラ費用の概算

2026年11月時点の公開価格表からの概算です。最新の料金は各社のページで確認してください。

| サービス | プラン | 月額 | 備考 |
|---|---|---|---|
| Cloudflare Workers + D1 | Workers Paid | 5ドル | D1 の読み取り・書き込み・保存容量（5GB）の大きな無料枠を含む。無料プランは1リクエストのCPU時間が10msまでで、ログイン時のパスワード照合が上限を超える場合があるため、本番は Paid を推奨 |
| Vercel | Pro | 1人あたり20ドル | Hobby プランは商用利用不可 |
| ロゴ画像の保存 | D1 内に保存 | 0円 | R2 は使っていない（R2 は月10GB まで無料。将来、添付ファイルなどを扱う場合に検討） |
| 認証 | Better Auth（オープンソース） | 0円 | 外部の認証サービスは不使用 |
| 独自ドメイン | — | 年1,500〜3,000円程度 | 任意 |

**合計：月25ドル前後（約4,000円）から。** 数十社・数百ユーザー程度までは、利用量による追加料金はほぼかからない見込みです。
