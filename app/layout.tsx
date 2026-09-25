import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Centralized Creator Analytics",
  description:
    "One dashboard for your YouTube, TikTok, Instagram, and Facebook audience numbers.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{const c=document.cookie.match(/(?:^|; )creator-analytics-theme=([^;]*)/)?.[1];const t=c||localStorage.getItem("creator-analytics-theme");document.documentElement.dataset.theme=t==="dark"||(!t&&matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light"}catch{document.documentElement.dataset.theme=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
