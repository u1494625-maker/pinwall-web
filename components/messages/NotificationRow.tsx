import Link from "next/link";
import type { ReactNode } from "react";
import DemoPhoto from "@/components/DemoPhoto";

type NotificationRowProps = {
  actorUserId: string;
  actorDisplayName: string;
  actorAvatarUrl?: string;
  /** Middle content — wording, timestamp, comment body, etc. */
  children: ReactNode;
  /** Right-hand action/preview — a post thumbnail link or a Follow back
   *  button. Omitted entirely when there's nothing to show there. */
  rightSlot?: ReactNode;
};

/** Shared notification-row layout: avatar on the left (links to the actor's
 *  profile), free-form content in the middle, an optional action/preview on
 *  the right — reused by the Likes, Comments, and New followers pages so
 *  they only ever differ in what they put in the middle/right slots. */
export default function NotificationRow({
  actorUserId,
  actorDisplayName,
  actorAvatarUrl,
  children,
  rightSlot,
}: NotificationRowProps) {
  return (
    <article className="flex items-start gap-3 border-b border-stone-100 px-4 py-3.5">
      <Link href={`/profile/${actorUserId}`} className="shrink-0">
        {actorAvatarUrl ? (
          <DemoPhoto src={actorAvatarUrl} alt={actorDisplayName} className="size-11 rounded-full" />
        ) : (
          <span className="grid size-11 place-items-center rounded-full bg-stone-200 text-base font-black text-stone-600">
            {actorDisplayName.charAt(0).toUpperCase()}
          </span>
        )}
      </Link>

      <div className="min-w-0 flex-1">{children}</div>

      {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
    </article>
  );
}
