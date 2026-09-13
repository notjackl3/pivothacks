import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ReelRelay",
  description: "Understand important messages and reply with confidence.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
