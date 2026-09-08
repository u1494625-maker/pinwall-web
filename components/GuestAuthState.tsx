"use client";

import { AuthLegalLinks, AuthProviderButton } from "@/components/auth/AuthProviderButtons";
import { useAuth } from "@/lib/auth/AuthProvider";

type GuestAuthStateProps = {
  /** e.g. "Log in to see posts from people you follow." */
  message: string;
};

/**
 * Compact "sign in" card for a protected CONTENT area — not a full-page
 * LoginScreen swap, and not a fixed/absolute overlay either: this is a
 * normal-flow block, centered within whichever content area renders it
 * (Home's Following tab, Messages, /me). The surrounding page shell
 * (header, tabs, BottomNav) lives entirely outside this component and is
 * never covered, dimmed, or at risk of an invisible element intercepting
 * taps meant for it — there is nothing spanning the viewport here for a tap
 * to be intercepted by in the first place.
 *
 * Reuses AuthProviderButton/AuthLegalLinks (components/auth/
 * AuthProviderButtons.tsx) — the exact same icons, button chrome, auth
 * handlers, and legal copy LoginScreen's full-page version uses — just
 * without the Kavanaka wordmark/hero, at compact-card spacing instead of
 * LoginScreen's own full-height rhythm.
 */
export default function GuestAuthState({ message }: GuestAuthStateProps) {
  const { signInWithGoogle, signInWithApple } = useAuth();

  return (
    <div className="flex justify-center pb-16 pt-12">
      <div className="w-[85%] max-w-[350px] rounded-3xl border border-stone-100 bg-white px-5 py-6 text-center shadow-[0_8px_30px_rgba(50,40,30,0.12)]">
        <p className="text-sm leading-relaxed text-stone-600">{message}</p>

        <div className="mt-5 space-y-2.5">
          <AuthProviderButton provider="google" onClick={() => signInWithGoogle()} className="w-full" />
          <AuthProviderButton provider="apple" onClick={() => signInWithApple()} className="w-full" />
        </div>

        <AuthLegalLinks className="mt-4 text-[10px] leading-4" />
      </div>
    </div>
  );
}
