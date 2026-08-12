import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Solvo — Conversational Treasury Execution",
    template: "%s — Solvo",
  },
  description:
    "Solvo turns Telegram payment instructions into safe, reliable, auditable USDC transactions.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
