"use client";

import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import LoginScreen from "./LoginScreen";

/** Renders `children` when signed in, the login screen when not — no redirects. */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <main className="min-h-screen bg-[#fbfaf7]" />;
  }

  if (!user) {
    return <LoginScreen />;
  }

  return <>{children}</>;
}
