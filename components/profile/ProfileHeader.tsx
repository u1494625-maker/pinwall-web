import type { ReactNode } from "react";
import DemoPhoto from "@/components/DemoPhoto";
import { FALLBACK_DISPLAY_NAME, type Profile } from "@/lib/profiles";

/** Real rendered aspect ratio of the header banner below (max-w-md container,
 *  h-56 tall: 448/224 = 2) — shared with the background image crop tool so
 *  what you crop is exactly what displays here, never a mismatched ratio. */
export const PROFILE_HEADER_ASPECT = 2;

type ProfileHeaderProps = {
  profile: Profile;
  /** Shown top-left over the header image when provided — PublicProfile's
   *  back button; Me has none (it's a bottom-nav tab, not a pushed page). */
  onBack?: () => void;
  /** Small pill buttons shown top-right over the header image — Me's Edit
   *  Profile/Log Out. PublicProfile's Follow/Message are page content below
   *  the header (full-width primary actions), not header chrome, so they
   *  aren't this component's concern. */
  headerActions?: ReactNode;
};

/**
 * Shared background + circular avatar + name + bio banner used by both /me
 * and /profile/[userId] — the one place this visual identity block is
 * defined, so Me and Public Profile can never visually drift apart. Bio (if
 * present) renders directly under the name, inside this same dark banner —
 * never a fallback to email or any other non-profile text.
 */
export default function ProfileHeader({ profile, onBack, headerActions }: ProfileHeaderProps) {
  const displayName = profile.displayName ?? FALLBACK_DISPLAY_NAME;

  return (
    <div className="relative h-56 w-full">
      <div className="absolute inset-0 overflow-hidden bg-stone-800">
        {profile.backgroundUrl ? (
          <DemoPhoto src={profile.backgroundUrl} alt="" className="absolute inset-0" />
        ) : profile.avatarUrl ? (
          <DemoPhoto src={profile.avatarUrl} alt="" className="absolute inset-0 scale-150 blur-3xl" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-b from-black/15 via-black/45 to-black/80" />
      </div>

      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          aria-label="Go back"
          className="absolute left-4 top-[calc(env(safe-area-inset-top)+1.25rem)] grid size-9 place-items-center rounded-full bg-white/15 text-2xl leading-none text-white backdrop-blur-sm"
        >
          ‹
        </button>
      ) : null}

      {headerActions ? (
        <div className="absolute right-4 top-[calc(env(safe-area-inset-top)+1.25rem)] flex items-center gap-2">{headerActions}</div>
      ) : null}

      <div className="absolute inset-x-4 -bottom-9 z-20 flex items-end gap-3">
        {profile.avatarUrl ? (
          <DemoPhoto
            src={profile.avatarUrl}
            alt={`${displayName} profile photo`}
            className="size-20 shrink-0 rounded-full border-4 border-[#fbfaf7] shadow-lg"
          />
        ) : (
          <div className="grid size-20 shrink-0 place-items-center rounded-full border-4 border-[#fbfaf7] bg-stone-200 text-xl font-black text-stone-600 shadow-lg">
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 pb-11">
          <h1 className="truncate text-base font-black text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)]">
            {displayName}
          </h1>
          {profile.bio ? (
            <p className="mt-0.5 line-clamp-2 max-w-[16rem] text-[11px] font-medium leading-snug text-white/85 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]">
              {profile.bio}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
