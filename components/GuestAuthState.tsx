"use client";

import { useAuth } from "@/lib/auth/AuthProvider";

type GuestAuthStateProps = {
  /** e.g. "Log in to see posts from people you follow." */
  message: string;
};

/**
 * Lightweight, inline "sign in required" placeholder for a protected
 * CONTENT area — deliberately not a full-page replacement. Used in place of
 * a page-level RequireAuth/LoginScreen swap wherever the surrounding page
 * shell (header, tabs, BottomNav) must stay visible and interactive for a
 * signed-out visitor, so they can back out to public content without
 * signing in (see PinWallHome's Following tab, MessagesHome, /me).
 *
 * "Log in" reuses the same one-tap sign-in call this app already uses for
 * every other inline (non-full-page) auth prompt — see PostDetail.tsx's
 * handleToggleLike/handleToggleSave/handleToggleFollow/openReportModal and
 * PublicProfile.tsx's handleToggleFollow/handleMessage, all of which call
 * signInWithGoogle() directly rather than routing through LoginScreen
 * (there is no dedicated /login route in this app — see LoginScreen.tsx's
 * own doc comment).
 */
export default function GuestAuthState({ message }: GuestAuthStateProps) {
  const { signInWithGoogle } = useAuth();

  return (
    <div className="px-6 py-20 text-center">
      <p className="text-sm text-stone-500">{message}</p>
      <button
        type="button"
        onClick={() => void signInWithGoogle()}
        className="mt-5 inline-flex rounded-full bg-stone-900 px-5 py-2.5 text-sm font-bold text-white"
      >
        Log in
      </button>
    </div>
  );
}
