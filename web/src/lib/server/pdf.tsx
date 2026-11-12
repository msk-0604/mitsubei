import "server-only";

import path from "node:path";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { TAX_GROUP_LABELS, formatYen } from "../../../../shared/calc";
import type { Estimate, IssuerSnapshot } from "../../../../shared/types";

/* ───────────── フォント（Noto Sans JP：SIL Open Font License） ───────────── */

let fontsReady = false;
function ensureFonts() {
  if (fontsReady) return;
  const dir = path.join(process.cwd(), "assets", "fonts");
  Font.register({
    family: "NotoSansJP",
    fonts: [
      { src: path.join(dir, "NotoSansJP-Regular.ttf"), fontWeight: 400 },
      { src: path.join(dir, "NotoSansJP-Bold.ttf"), fontWeight: 700 },
    ],
  });
  // 日本語は1文字ごとに改行できるようにする。各文字の後ろに空の区切りを入れると、改行時にハイフンが付かない。
  // 英数字の連続（型番・数字など）は途中で切らない。
  Font.registerHyphenationCallback((word) => {
    const tokens = word.replace(/\u200b/g, "").match(/[!-~]+|[\s\S]/gu) ?? [word];
    return tokens.flatMap((t) => [t, ""]);
  });
  fontsReady = true;
}

/* ───────────── 書式 ───────────── */

/** null を空文字にする（PDF のテキスト用） */
function jp(text: string | null | undefined): string {
  return text ?? "";
}

const yen = (n: number) => `¥${formatYen(n)}`;
const num = (s: string) => {
  const neg = s.startsWith("-");
  const [i = "0", f] = s.replace("-", "").split(".");
  return `${neg ? "-" : ""}${Number(i).toLocaleString("ja-JP")}${f ? "." + f : ""}`;
};
const ymdJa = (ymd: string | null) => {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return `${y}年${m}月${d}日`;
};

/* ───────────── レイアウト（A4 縦：595 × 842pt） ───────────── */

const BLUE = "#1e40af";
const LINE = "#94a3b8";
const LIGHT = "#e2e8f0";

const COL = { no: 22, qty: 50, unit: 34, price: 72, amount: 86, tax: 34 };

const s = StyleSheet.create({
  page: { fontFamily: "NotoSansJP", fontSize: 9, color: "#1e293b", paddingTop: 64, paddingBottom: 48, paddingHorizontal: 36, lineHeight: 1.45 },
  title: { fontSize: 22, fontWeight: 700, textAlign: "center", letterSpacing: 10, marginTop: -24, marginBottom: 14 },
  metaRow: { flexDirection: "row", justifyContent: "flex-end", gap: 12, fontSize: 9, marginBottom: 10 },
  top: { flexDirection: "row", gap: 16 },
  left: { flex: 1 },
  right: { width: 200, alignItems: "flex-end" },
  recipient: { fontSize: 14, fontWeight: 700, borderBottomWidth: 1, borderBottomColor: "#334155", paddingBottom: 3, marginBottom: 4 },
  small: { fontSize: 8.5, color: "#475569" },
  kv: { flexDirection: "row", marginTop: 3 },
  kvKey: { width: 52, color: "#475569" },
  kvVal: { flex: 1 },
  totalBox: { flexDirection: "row", alignItems: "stretch", borderWidth: 1.2, borderColor: BLUE, marginTop: 10, marginBottom: 4 },
  totalLabel: { backgroundColor: BLUE, color: "#fff", fontWeight: 700, fontSize: 11, lineHeight: 1.5, paddingHorizontal: 10, paddingTop: 7 },
  totalValue: { flex: 1, textAlign: "right", fontSize: 18, fontWeight: 700, lineHeight: 1.5, paddingLeft: 10, paddingRight: 4, paddingVertical: 2 },
  totalNote: { fontSize: 8.5, lineHeight: 1.5, paddingRight: 8, paddingTop: 11 },
  logo: { maxWidth: 140, maxHeight: 48, objectFit: "contain", marginBottom: 6 },
  issuerBlock: { position: "relative", alignItems: "flex-end", paddingRight: 4 },
  seal: { position: "absolute", top: -10, right: -6, width: 58, height: 58, objectFit: "contain", opacity: 0.9 },
  stampRow: { flexDirection: "row", marginTop: 8 },
  stampBox: { width: 46, height: 52, borderWidth: 0.8, borderColor: "#64748b" },
  stampLabel: { fontSize: 7.5, textAlign: "center", borderBottomWidth: 0.8, borderBottomColor: "#64748b", paddingVertical: 1.5, color: "#334155" },
  company: { fontSize: 11, fontWeight: 700, marginBottom: 2, textAlign: "right" },
  issuerText: { fontSize: 8.5, textAlign: "right", color: "#334155" },
  table: { marginTop: 14, borderTopWidth: 1, borderTopColor: "#334155" },
  th: { flexDirection: "row", backgroundColor: "#f1f5f9", borderBottomWidth: 0.8, borderBottomColor: LINE, fontWeight: 700, fontSize: 8.5 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LIGHT, minHeight: 20 },
  cell: { paddingVertical: 4, paddingHorizontal: 3 },
  right_: { textAlign: "right" },
  center: { textAlign: "center" },
  summary: { flexDirection: "row", marginTop: 10, gap: 16 },
  sumTable: { width: 250, marginLeft: "auto" },
  sumRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: LIGHT },
  sumTotal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderTopWidth: 1, borderTopColor: "#334155", marginTop: 2, fontWeight: 700, fontSize: 11 },
  box: { borderWidth: 0.8, borderColor: LINE, padding: 8, marginTop: 12 },
  boxTitle: { fontWeight: 700, marginBottom: 3, fontSize: 9 },
  footer: { position: "absolute", top: 812, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: "#64748b" },
  contHeader: { position: "absolute", top: 30, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: "#64748b" },
});

function TableHead() {
  return (
    <View style={s.th}>
      <Text style={[s.cell, s.center, { width: COL.no }]}>No</Text>
      <Text style={[s.cell, { flex: 1 }]}>品名・工事項目 / 規格・仕様</Text>
      <Text style={[s.cell, s.right_, { width: COL.qty }]}>数量</Text>
      <Text style={[s.cell, s.center, { width: COL.unit }]}>単位</Text>
      <Text style={[s.cell, s.right_, { width: COL.price }]}>単価</Text>
      <Text style={[s.cell, s.right_, { width: COL.amount }]}>金額</Text>
      <Text style={[s.cell, s.center, { width: COL.tax }]}>税率</Text>
    </View>
  );
}

const TAX_SHORT = { standard: "10%", reduced: "8%※", exempt: "非課税" } as const;

function EstimateDoc({ e, issuer, logo, seal }: { e: Estimate; issuer: IssuerSnapshot; logo: string | null; seal: string | null }) {
  const stampBoxes = issuer.stampBoxes ?? [];
  const hasReduced = e.items.some((it) => it.taxCategory === "reduced");
  const addr = [issuer.postalCode ? `〒${issuer.postalCode}` : null, issuer.address].filter(Boolean).join(" ");
  return (
    <Document title={`見積書 ${e.estimateNumber}`} author={issuer.companyName} creator="MITUBEI" producer="MITUBEI" language="ja">
      <Page size="A4" style={s.page}>
        {/* ページ下部（全ページ） */}
        <View fixed style={s.footer}>
          <Text>
            No. {e.estimateNumber}　{issuer.companyName}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
        {/* 2ページ目以降の見出し */}
        <View
          fixed
          style={s.contHeader}
          render={({ pageNumber }) =>
            pageNumber > 1 ? (
              <>
                <Text>
                  御見積書　No. {e.estimateNumber}　{e.recipientName} {e.recipientHonorific}
                </Text>
                <Text>（続き）</Text>
              </>
            ) : null
          }
        />

        <Text style={s.title}>御見積書</Text>
        <View style={s.metaRow}>
          <Text>No. {e.estimateNumber}</Text>
          <Text>発行日 {ymdJa(e.issueDate)}</Text>
        </View>

        <View style={s.top}>
          <View style={s.left}>
            <Text style={s.recipient}>
              {jp(e.recipientName) || "　"}　{e.recipientHonorific}
            </Text>
            {e.recipientContact && <Text style={s.small}>{jp(e.recipientContact)}</Text>}
            {e.recipientAddress && <Text style={s.small}>{jp(e.recipientAddress)}</Text>}
            <Text style={{ marginTop: 8 }}>下記のとおりお見積り申し上げます。</Text>
            <View style={s.totalBox}>
              <Text style={s.totalLabel}>御見積金額</Text>
              <Text style={s.totalValue}>{yen(e.total)}</Text>
              <Text style={s.totalNote}>（税込）</Text>
            </View>
            <View style={s.kv}>
              <Text style={s.kvKey}>件名</Text>
              <Text style={s.kvVal}>{jp(e.subject)}</Text>
            </View>
            {e.projectName && (
              <View style={s.kv}>
                <Text style={s.kvKey}>工事名</Text>
                <Text style={s.kvVal}>{jp(e.projectName)}</Text>
              </View>
            )}
            {e.projectLocation && (
              <View style={s.kv}>
                <Text style={s.kvKey}>工事場所</Text>
                <Text style={s.kvVal}>{jp(e.projectLocation)}</Text>
              </View>
            )}
            {e.validUntil && (
              <View style={s.kv}>
                <Text style={s.kvKey}>有効期限</Text>
                <Text style={s.kvVal}>{ymdJa(e.validUntil)}</Text>
              </View>
            )}
          </View>
          <View style={s.right}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            {logo && <Image src={logo} style={s.logo} />}
            <View style={s.issuerBlock}>
              <Text style={s.company}>{jp(issuer.companyName)}</Text>
              {addr && <Text style={s.issuerText}>{jp(addr)}</Text>}
              {issuer.phone && <Text style={s.issuerText}>TEL {issuer.phone}</Text>}
              {issuer.email && <Text style={s.issuerText}>{issuer.email}</Text>}
              {issuer.registrationNumber && <Text style={[s.issuerText, { marginTop: 2 }]}>登録番号 {issuer.registrationNumber}</Text>}
              {/* 社印（角印）：会社名の右端に重ねて押した形にする */}
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              {seal && <Image src={seal} style={s.seal} />}
            </View>
            {stampBoxes.length > 0 && (
              <View style={s.stampRow}>
                {stampBoxes.map((label, i) => (
                  <View key={i} style={[s.stampBox, i === 0 ? {} : { borderLeftWidth: 0 }]}>
                    <Text style={s.stampLabel}>{label}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* 明細（行の途中では改ページしない） */}
        <View style={s.table}>
          <TableHead />
          {e.items.map((it, i) => (
            <View key={it.id ?? i} style={s.tr} wrap={false}>
              <Text style={[s.cell, s.center, { width: COL.no, color: "#64748b" }]}>{i + 1}</Text>
              <View style={[s.cell, { flex: 1 }]}>
                <Text>{jp(it.name)}</Text>
                {(it.spec || it.notes) && <Text style={{ fontSize: 7.5, color: "#475569" }}>{jp([it.spec, it.notes].filter(Boolean).join(" / "))}</Text>}
              </View>
              <Text style={[s.cell, s.right_, { width: COL.qty }]}>{num(it.quantity)}</Text>
              <Text style={[s.cell, s.center, { width: COL.unit }]}>{it.unit ?? ""}</Text>
              <Text style={[s.cell, s.right_, { width: COL.price }]}>{num(it.unitPrice)}</Text>
              <Text style={[s.cell, s.right_, { width: COL.amount }]}>{formatYen(it.amount)}</Text>
              <Text style={[s.cell, s.center, { width: COL.tax, fontSize: 7.5 }]}>{TAX_SHORT[it.taxCategory]}</Text>
            </View>
          ))}
        </View>

        {/* 合計（税率ごとの対象額と消費税額：適格請求書の記載事項に対応） */}
        <View style={s.summary} wrap={false}>
          <View style={{ flex: 1, fontSize: 7.5, color: "#475569", paddingTop: 4 }}>
            {hasReduced && <Text>※印は軽減税率（8%）対象です。</Text>}
            <Text>金額は円単位。消費税は税率ごとの合計額に対して計算しています。</Text>
          </View>
          <View style={s.sumTable}>
            <View style={s.sumRow}>
              <Text>小計（税抜）</Text>
              <Text>{yen(e.itemsSubtotal)}</Text>
            </View>
            {e.discount > 0 && (
              <View style={s.sumRow}>
                <Text>値引き</Text>
                <Text>-{yen(e.discount)}</Text>
              </View>
            )}
            {e.taxGroups.map((g) => (
              <View key={g.category} style={s.sumRow}>
                <Text style={{ fontSize: 8 }}>
                  {TAX_GROUP_LABELS[g.category]}　{yen(g.taxable)}
                </Text>
                <Text style={{ fontSize: 8 }}>{g.rate > 0 ? `消費税 ${yen(g.tax)}` : "—"}</Text>
              </View>
            ))}
            <View style={s.sumRow}>
              <Text>消費税</Text>
              <Text>{yen(e.tax)}</Text>
            </View>
            <View style={s.sumTotal}>
              <Text>合計（税込）</Text>
              <Text>{yen(e.total)}</Text>
            </View>
          </View>
        </View>

        {e.notes && (
          <View style={s.box} wrap={false}>
            <Text style={s.boxTitle}>備考</Text>
            <Text>{jp(e.notes)}</Text>
          </View>
        )}
        {issuer.bankInfo && (
          <View style={s.box} wrap={false}>
            <Text style={s.boxTitle}>お振込先</Text>
            <Text>{jp(issuer.bankInfo)}</Text>
          </View>
        )}

      </Page>
    </Document>
  );
}

export async function renderEstimatePdf(input: {
  estimate: Estimate;
  issuer: IssuerSnapshot;
  logo: string | null;
  seal: string | null;
}): Promise<Buffer> {
  ensureFonts();
  return renderToBuffer(<EstimateDoc e={input.estimate} issuer={input.issuer} logo={input.logo} seal={input.seal} />);
}
