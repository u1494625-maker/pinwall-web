"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import DemoPhoto from "@/components/DemoPhoto";
import {
  dismissReport,
  getPendingReportsForAdmin,
  isCurrentUserAdmin,
  removeReportedContent,
  type PendingReport,
} from "@/lib/admin";
import { formatRelativeDate } from "@/lib/postDisplay";

function IdentityAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  return avatarUrl ? (
    <DemoPhoto src={avatarUrl} alt="" className="size-6 shrink-0 rounded-full" />
  ) : (
    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-stone-200 text-[10px] font-black text-stone-600">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function IdentityRow({ label, userId, name, avatarUrl }: { label: string; userId?: string; name: string; avatarUrl?: string }) {
  const content = (
    <>
      <IdentityAvatar name={name} avatarUrl={avatarUrl} />
      <span className="truncate text-sm font-bold text-stone-900">{name}</span>
    </>
  );

  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-[11px] font-bold uppercase tracking-wide text-stone-400">{label}</span>
      {userId ? (
        <Link href={`/profile/${userId}`} className="flex min-w-0 items-center gap-1.5">
          {content}
        </Link>
      ) : (
        <div className="flex min-w-0 items-center gap-1.5">{content}</div>
      )}
    </div>
  );
}

type ReportRowProps = {
  report: PendingReport;
  onDismissed: (reportId: number) => void;
  onRemoved: (report: PendingReport) => void;
};

function ReportRow({ report, onDismissed, onRemoved }: ReportRowProps) {
  const [isDismissing, setIsDismissing] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = isDismissing || isRemoving;

  async function handleDismiss() {
    if (busy) return;
    setIsDismissing(true);
    setError(null);
    try {
      await dismissReport(report.id);
      onDismissed(report.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't dismiss this report.");
      setIsDismissing(false);
    }
  }

  async function handleConfirmRemove() {
    if (busy) return;
    setIsRemoving(true);
    setError(null);
    try {
      await removeReportedContent(report.id);
      onRemoved(report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove this content.");
      setIsRemoving(false);
      setConfirmingRemove(false);
    }
  }

  return (
    <li className="border-b border-stone-100 px-4 py-4">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-stone-500">
          {report.targetType === "post" ? "Post" : "Comment"}
        </span>
        <time className="text-[11px] text-stone-400">{formatRelativeDate(report.createdAt)}</time>
      </div>

      <div className="mt-3 space-y-1.5">
        <IdentityRow label="Reporter" userId={report.reporterUserId} name={report.reporterDisplayName} avatarUrl={report.reporterAvatarUrl} />
        <IdentityRow label="Author" userId={report.contentAuthorUserId} name={report.contentAuthorDisplayName} avatarUrl={report.contentAuthorAvatarUrl} />
      </div>

      {report.reason ? <p className="mt-2 text-sm text-stone-700">&ldquo;{report.reason}&rdquo;</p> : null}

      <p className="mt-2 line-clamp-2 rounded-xl bg-stone-50 px-3 py-2 text-sm text-stone-600">{report.contentPreview}</p>

      {error ? <p className="mt-2 text-xs font-semibold text-red-600">{error}</p> : null}

      {confirmingRemove ? (
        <div className="mt-3 rounded-xl bg-red-50 p-3">
          <p className="text-sm font-bold text-stone-900">
            {report.targetType === "post" ? "Remove this post?" : "Remove this comment?"}
          </p>
          <p className="mt-1 text-xs text-stone-500">It will no longer be visible to normal users.</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmingRemove(false)}
              disabled={isRemoving}
              className="flex-1 rounded-full bg-white py-2 text-xs font-bold text-stone-600 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmRemove}
              disabled={isRemoving}
              className="flex-1 rounded-full bg-red-600 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {isRemoving ? "Removing…" : "Remove"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <Link
            href={`/post/${report.parentPostId}`}
            className="flex-1 rounded-full bg-stone-100 py-2 text-center text-xs font-bold text-stone-600"
          >
            View
          </Link>
          <button
            type="button"
            onClick={handleDismiss}
            disabled={busy}
            className="flex-1 rounded-full bg-stone-100 py-2 text-xs font-bold text-stone-600 disabled:opacity-50"
          >
            {isDismissing ? "Dismissing…" : "Dismiss"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingRemove(true)}
            disabled={busy}
            className="flex-1 rounded-full bg-red-600 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      )}
    </li>
  );
}

function sameTarget(a: PendingReport, b: PendingReport): boolean {
  if (a.targetType !== b.targetType) return false;
  return a.targetType === "post" ? a.targetPostId === b.targetPostId : a.targetCommentId === b.targetCommentId;
}

/**
 * Admin-only moderation queue — every pending report, newest first. Gated by
 * a real server-side check (isCurrentUserAdmin, which itself only reflects
 * what is_current_user_admin() says); a non-admin sees a plain "Not
 * authorized" state and the underlying RPCs would reject them regardless of
 * what this component renders.
 */
export default function ModerationQueue() {
  const [status, setStatus] = useState<"checking" | "unauthorized" | "authorized">("checking");
  const [reports, setReports] = useState<PendingReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    isCurrentUserAdmin().then((isAdmin) => {
      if (cancelled) return;

      if (!isAdmin) {
        setStatus("unauthorized");
        return;
      }

      setStatus("authorized");
      getPendingReportsForAdmin().then((result) => {
        if (!cancelled) {
          setReports(result);
          setReportsLoading(false);
        }
      });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleDismissed(reportId: number) {
    setReports((prev) => prev.filter((report) => report.id !== reportId));
  }

  // remove_reported_content actions every pending report against the same
  // target, not just the one clicked — the queue needs to drop every
  // matching row locally to reflect that in one pass, rather than leaving
  // stale sibling rows whose underlying report no longer exists as pending.
  function handleRemoved(removed: PendingReport) {
    setReports((prev) => prev.filter((report) => !sameTarget(report, removed)));
  }

  if (status === "checking") {
    return <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7]" />;
  }

  if (status === "unauthorized") {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center bg-[#fbfaf7] px-8 text-center">
        <h1 className="text-lg font-black text-stone-900">Not authorized</h1>
        <p className="mt-2 text-sm text-stone-500">You don&apos;t have access to this page.</p>
        <Link href="/" className="mt-5 inline-flex rounded-full bg-stone-900 px-5 py-2.5 text-sm font-bold text-white">
          Back to Explore
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-md bg-[#fbfaf7] pb-10 shadow-[0_0_50px_rgba(50,40,30,0.08)]">
      <header className="px-5 pb-4 pt-8">
        <h1 className="text-xl font-black tracking-tight text-stone-900">Moderation queue</h1>
        <p className="mt-1 text-sm text-stone-500">Pending reports, newest first.</p>
      </header>

      {reportsLoading ? (
        <p className="px-5 py-10 text-center text-sm text-stone-400">Loading…</p>
      ) : reports.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-stone-400">No reports to review.</p>
      ) : (
        <ul>
          {reports.map((report) => (
            <ReportRow key={report.id} report={report} onDismissed={handleDismissed} onRemoved={handleRemoved} />
          ))}
        </ul>
      )}
    </main>
  );
}
