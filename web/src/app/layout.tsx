import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegister } from "@/components/sw-register";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "MITUBEI", template: "%s | MITUBEI" },
  description: "見積書作成・価格表管理システム",
  applicationName: "MITUBEI",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "MITUBEI", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-[#f8fafc] text-slate-800">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
