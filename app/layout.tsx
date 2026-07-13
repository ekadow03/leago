import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Leago — Run your season. Not your software.",
  description:
    "Leago brings registration, scheduling, payments, live drafts, and communication together in one platform built for sports organizations.",
  icons: {
    icon: "/leago-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}