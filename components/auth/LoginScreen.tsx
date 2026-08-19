"use client";

import { useAuth } from "@/lib/auth/AuthProvider";

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

export default function LoginScreen() {
  const { signInWithGoogle } = useAuth();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center px-8 text-center">
      <p className="text-2xl font-black tracking-[-0.06em] text-stone-900">
        Kavanaka<span className="text-orange-500">.</span>
      </p>

      <h1 className="mt-10 text-2xl font-black tracking-tight text-stone-900">Welcome to Kavanaka</h1>
      <p className="mt-3 max-w-xs text-sm leading-6 text-stone-500">
        Discover authentic places shared by your community.
      </p>

      <button
        type="button"
        onClick={() => signInWithGoogle()}
        className="mt-10 flex items-center justify-center gap-2.5 rounded-full bg-stone-900 px-6 py-3.5 text-sm font-bold text-white"
      >
        <GoogleIcon />
        Continue with Google
      </button>

      <p className="mt-8 max-w-xs text-[11px] leading-5 text-stone-400">
        By continuing, you agree to the Terms of Service and Privacy Policy.
      </p>
    </main>
  );
}
