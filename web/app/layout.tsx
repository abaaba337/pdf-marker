import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "PDF Marker",
  other: { google: "notranslate" },  // a translated student page is a wrong student page
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh" translate="no" className="notranslate">
      <body>{children}</body>
    </html>
  );
}
