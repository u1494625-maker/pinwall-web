import type { Metadata } from "next";
import type { ReactNode } from "react";
import BottomNav from "@/components/BottomNav";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kavanaka — Social enough to share. Useful enough to search.",
  description: "Social enough to share. Useful enough to search.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {children}
          <BottomNav />
        </AuthProvider>
      </body>
    </html>
  );
}
