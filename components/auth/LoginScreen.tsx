"use client";

import { useRouter } from "next/navigation";
import { AuthLegalLinks, AuthProviderButton } from "@/components/auth/AuthProviderButtons";
import { useAuth } from "@/lib/auth/AuthProvider";

// window.history.length already counts the tab's initial entry before this
// app has navigated anywhere on its own, so a plain "length > 1" check is
// true even on a cold first load — the exact case that needs the fallback.
// Capturing it once here, at module-evaluation time (effectively "app boot"
// for this page load), gives a real baseline: history.length only exceeds
// this after the user has actually navigated somewhere else in-app first.
const INITIAL_HISTORY_LENGTH = typeof window !== "undefined" ? window.history.length : 0;

export default function LoginScreen() {
  const router = useRouter();
  const { signInWithGoogle, signInWithApple } = useAuth();

  // No dedicated /login route exists -- this screen is always shown in place
  // of gated content on whatever page the user is already on (RequireAuth,
  // PinWallHome's Following tab), so a plain router.back() can't be trusted:
  // with no real in-app navigation yet, it would pop past this app entirely
  // (to about:blank or wherever the tab/webview started), trapping or
  // ejecting the user instead of helping them. See INITIAL_HISTORY_LENGTH
  // above for why a bare history.length check isn't enough on its own.
  function handleBack() {
    if (window.history.length > INITIAL_HISTORY_LENGTH) {
      router.back();
    } else {
      router.push("/");
    }
  }

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-8 text-center">
      <button
        type="button"
        onClick={handleBack}
        aria-label="Go back"
        className="absolute left-4 top-[calc(env(safe-area-inset-top)+1rem)] grid size-9 place-items-center rounded-full text-2xl leading-none text-stone-700"
      >
        ‹
      </button>

      <p className="text-2xl font-black tracking-[-0.06em] text-stone-900">
        Kavanaka<span className="text-kavanaka-lime">.</span>
      </p>

      <h1 className="mt-10 text-2xl font-black tracking-tight text-stone-900">Welcome to Kavanaka</h1>
      <p className="mt-3 max-w-xs text-sm leading-6 text-stone-500">
        Stay in the loop with what’s happening around Berkeley.
      </p>

      <AuthProviderButton provider="google" onClick={() => signInWithGoogle()} className="mt-10" />
      <AuthProviderButton provider="apple" onClick={() => signInWithApple()} className="mt-3" />

      <AuthLegalLinks className="mt-8 max-w-xs text-[11px] leading-5" />
    </main>
  );
}
