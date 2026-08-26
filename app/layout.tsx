import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import BottomNav from "@/components/BottomNav";
import SwipeBackNav from "@/components/nav/SwipeBackNav";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kavanaka — Social enough to share. Useful enough to search.",
  description: "Social enough to share. Useful enough to search.",
  // Controls the label iOS Safari's "Add to Home Screen" uses. Without this,
  // iOS falls back to the page <title> (and truncates it) — this is the
  // standard, iOS-specific override for that, independent of the manifest's
  // own name/short_name (which Android/Chrome read instead).
  appleWebApp: {
    capable: true,
    title: "Kavanaka",
    statusBarStyle: "default",
  },
  // appleWebApp.capable above only emits the modern "mobile-web-app-capable"
  // tag. Older iOS Safari versions specifically look for the legacy
  // "apple-" prefixed tag to enable standalone launch, so both are sent.
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#b7d916",
  // Lets the app's existing env(safe-area-inset-*) CSS (already used
  // throughout — BottomNav, message composer, fullscreen gallery, etc.)
  // actually take effect on notched/home-indicator iPhones; without this,
  // those insets are always 0 regardless of what the CSS says.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <SwipeBackNav>{children}</SwipeBackNav>
          <BottomNav />
        </AuthProvider>
      </body>
    </html>
  );
}
