"use client";

import { App as CapacitorApp, type URLOpenListenerEvent } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AuthUser } from "@supabase/supabase-js";
import { migrateLocalSavesToSupabase } from "@/lib/interactions";
import { supabase } from "@/lib/supabase/client";

// Must exactly match one of the Redirect URLs allow-listed in the Supabase
// dashboard (Authentication -> URL Configuration) and the CFBundleURLSchemes
// entry in ios/App/App/Info.plist.
const NATIVE_OAUTH_REDIRECT_URL = "kavanaka://auth/callback";

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      const newUserId = session?.user?.id ?? null;
      setUser((prevUser) => {
        if (process.env.NODE_ENV !== "production") {
          const prevUserId = prevUser?.id ?? null;
          console.log(`[AUTH] ${event} user=${newUserId} identityChanged=${prevUserId !== newUserId}`);
        }
        return session?.user ?? null;
      });
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Runs once per real sign-in — migrateLocalSavesToSupabase itself checks a
  // one-time flag and no-ops immediately if already done, so this being
  // called again on every auth-state change (e.g. token refresh) is harmless.
  useEffect(() => {
    if (user) {
      migrateLocalSavesToSupabase(user.id);
    }
  }, [user]);

  // Native-only: Google auth always finishes in the external browser (Google
  // blocks OAuth inside an embedded webview), which redirects to
  // kavanaka://auth/callback#access_token=... instead of loading it — the
  // in-app WKWebView's own window.location never sees that URL, so
  // supabase-js's usual detectSessionInUrl parsing can't pick it up on its
  // own. iOS hands the URL to the app via this listener instead (already
  // wired through Capacitor's stock SceneDelegate -> @capacitor/app, no
  // native code beyond the Info.plist URL scheme registration), so the
  // tokens are parsed out and applied to the session manually here.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    async function handleAppUrlOpen(event: URLOpenListenerEvent) {
      if (!event.url.startsWith(NATIVE_OAUTH_REDIRECT_URL)) return;

      const fragment = event.url.split("#")[1];
      if (fragment) {
        const params = new URLSearchParams(fragment);
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");
        if (access_token && refresh_token) {
          await supabase.auth.setSession({ access_token, refresh_token });
        }
      }

      try {
        await Browser.close();
      } catch {
        // Already closed/dismissed by the OS — nothing to do.
      }
    }

    const listenerPromise = CapacitorApp.addListener("appUrlOpen", handleAppUrlOpen);

    return () => {
      listenerPromise.then((listener) => listener.remove());
    };
  }, []);

  async function signInWithGoogle() {
    if (Capacitor.isNativePlatform()) {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: NATIVE_OAUTH_REDIRECT_URL, skipBrowserRedirect: true },
      });
      if (!error && data.url) {
        await Browser.open({ url: data.url });
      }
      return;
    }

    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.href },
    });
  }

  // Mirrors signInWithGoogle exactly — same native/web branching, same
  // redirect constant, same appUrlOpen listener above handles the callback
  // for either provider unchanged (it keys off the redirect URL prefix and
  // token presence, never the provider itself).
  async function signInWithApple() {
    if (Capacitor.isNativePlatform()) {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "apple",
        options: { redirectTo: NATIVE_OAUTH_REDIRECT_URL, skipBrowserRedirect: true },
      });
      if (!error && data.url) {
        await Browser.open({ url: data.url });
      }
      return;
    }

    await supabase.auth.signInWithOAuth({
      provider: "apple",
      options: { redirectTo: window.location.href },
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ user, loading, signInWithGoogle, signInWithApple, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
