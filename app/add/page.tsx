import RequireAuth from "@/components/auth/RequireAuth";
import MediaPostEditor from "@/components/add/MediaPostEditor";

/**
 * Direct entry point to /add (e.g. old links, bookmarks) — reuses the same
 * MediaPostEditor the action sheet's "Choose from album"/"Camera" options open,
 * just with no picker auto-opened (initialSource is null). This is the only
 * post-creation form left; the old standalone image-only form was removed here.
 */
export default function AddSpotPage() {
  return (
    <RequireAuth>
      <MediaPostEditor initialSource={null} />
    </RequireAuth>
  );
}
