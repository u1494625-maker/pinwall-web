"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthProvider";

// window.history.length already counts the tab's initial entry before this
// app has navigated anywhere on its own, so a plain "length > 1" check is
// true even on a cold first load — the exact case that needs the fallback.
// Capturing it once here, at module-evaluation time (effectively "app boot"
// for this page load), gives a real baseline: history.length only exceeds
// this after the user has actually navigated somewhere else in-app first.
const INITIAL_HISTORY_LENGTH = typeof window !== "undefined" ? window.history.length : 0;

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18" className="size-4 shrink-0">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}

/** Apple's own glyph, rendered in the button's own text color (white, on
 *  the same black-pill treatment as the Google button above) — one of
 *  Apple's two officially sanctioned "Sign in with Apple" button styles. */
function AppleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 shrink-0" fill="currentColor">
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01ZM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25Z" />
    </svg>
  );
}

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

      <button
        type="button"
        onClick={() => signInWithGoogle()}
        className="mt-10 flex items-center justify-center gap-2.5 rounded-full bg-stone-900 px-6 py-3.5 text-sm font-bold text-white"
      >
        <GoogleIcon />
        Continue with Google
      </button>

      <button
        type="button"
        onClick={() => signInWithApple()}
        className="mt-3 flex items-center justify-center gap-2.5 rounded-full bg-stone-900 px-6 py-3.5 text-sm font-bold text-white"
      >
        <AppleIcon />
        Continue with Apple
      </button>

      <p className="mt-8 max-w-xs text-[11px] leading-5 text-stone-400">
        By continuing, you agree to the{" "}
        <Link href="/terms" className="font-semibold text-stone-500 underline">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="font-semibold text-stone-500 underline">
          Privacy Policy
        </Link>
        .
      </p>
    </main>
  );
}
