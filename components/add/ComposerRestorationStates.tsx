/**
 * Shared by MediaPostEditor and TextPostEditor's outer restoration gates —
 * identical loading/error placeholders shown while looking up an existing
 * post_drafts row, before the interactive composer mounts at all. Purely
 * presentational, no composer-specific knowledge.
 */
export function ComposerLoadingState() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center justify-center bg-[#fbfaf7]">
      <span
        aria-label="Loading your draft"
        className="size-8 animate-spin rounded-full border-2 border-stone-300 border-t-stone-900"
      />
    </main>
  );
}

export function ComposerRestorationError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-4 bg-[#fbfaf7] px-6 text-center">
      <p className="text-sm text-stone-600">{message}</p>
      <button type="button" onClick={onRetry} className="rounded-2xl bg-stone-900 px-5 py-2.5 text-sm font-bold text-white">
        Try again
      </button>
    </main>
  );
}
