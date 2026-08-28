import LegalPage from "@/components/legal/LegalPage";

export const metadata = {
  title: "Privacy Policy — Kavanaka",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" effectiveDate="August 28, 2026">
      <p>
        This Privacy Policy describes what information Kavanaka actually collects, how it&apos;s used, and the
        choices you have. It describes Kavanaka&apos;s current practices as implemented in the product — not
        aspirational or generic claims.
      </p>

      <h2>Information We Collect</h2>
      <p>
        <strong>Account information.</strong> Kavanaka uses Google Sign-In as its only way to create an account.
        We receive the basic profile information Google provides (such as your name, email address, and profile
        photo) to set up your account.
      </p>
      <p>
        <strong>Profile information you provide.</strong> Your display name, an optional bio, and an optional
        avatar and background image. Your display name and any profile photo/bio you add are visible to other
        users.
      </p>
      <p>
        <strong>Content you create.</strong> Posts (titles, captions, tags, photos, videos, or text), comments and
        replies, and direct messages you send. Posts and comments are public by default; direct messages are
        visible only to you and the other participant.
      </p>
      <p>
        <strong>Location information.</strong> See &ldquo;Location Information&rdquo; below — this is entirely
        under your control.
      </p>
      <p>
        <strong>Usage and recommendation signals.</strong> If you&apos;re signed in, we record search queries you
        submit and which posts or map markers you interact with, to personalize what Explore shows you. We also
        keep a simple counter of how many times other people have opened your posts.
      </p>
      <p>
        <strong>Information stored only on your device.</strong> Kavanaka does not use cookies. Kavanaka uses
        browser storage for certain local features, such as saving an in-progress post draft and temporary
        application or session state. This storage is not used for advertising.
      </p>

      <h2>How We Use Information</h2>
      <ul>
        <li>To operate core features: posting, commenting, messaging, following, and search.</li>
        <li>To personalize your own Explore feed, based only on your own activity.</li>
        <li>To let you and other users find and interact with each other&apos;s public content.</li>
        <li>To review reports and moderate content that violates our standards.</li>
        <li>To keep the service secure and functioning as intended.</li>
      </ul>
      <p>
        Kavanaka does not currently sell personal information or use third-party advertising trackers. If these
        practices change, we will update this Policy accordingly.
      </p>

      <h2>User-Generated Content and Public Visibility</h2>
      <p>
        Posts, comments, and replies you publish are visible to other users and, unless removed by moderation,
        to anyone visiting Kavanaka. Your display name, avatar, and bio are public. Direct messages are private
        between participants. If another user blocks you, or you block them, your posts and comments become
        hidden from each other — see &ldquo;Blocking&rdquo; below.
      </p>

      <h2>Location Information</h2>
      <p>
        Kavanaka does not continuously or in the background track your location. Device geolocation is requested
        only within the post-location workflow — while you&apos;re creating a post and have explicitly chosen to
        attach a location to it — and only when you take an explicit action, such as tapping &ldquo;Use current
        location.&rdquo; You may instead manually select a location on the map yourself. Outside of that specific
        workflow, Kavanaka never requests or reads your device&apos;s location.
      </p>
      <p>
        When you view a map inside Kavanaka, map tile images are loaded directly from OpenStreetMap&apos;s
        servers, which may receive standard technical request information (such as your IP address), the same
        way loading any web content does. This is separate from, and unrelated to, any location you choose to
        attach to a post — OpenStreetMap does not receive your account information or your posts.
      </p>

      <h2>Authentication</h2>
      <p>
        Kavanaka never sees or stores your Google password. Sign-in is handled entirely by Google and Supabase
        Auth (our authentication provider); Kavanaka receives only a verified identity token.
      </p>

      <h2>Service Providers</h2>
      <p>The following providers process data on Kavanaka&apos;s behalf, based on how the service is built:</p>
      <ul>
        <li><strong>Supabase</strong> — authentication, database, and file storage.</li>
        <li><strong>Google</strong> — sign-in only.</li>
        <li><strong>Vercel</strong> — hosts the Kavanaka web application.</li>
        <li><strong>OpenStreetMap</strong> — supplies map tile images.</li>
      </ul>
      <p>Kavanaka does not currently use any analytics, advertising, or tracking SDKs.</p>

      <h2>Data Sharing</h2>
      <p>
        Kavanaka does not sell your personal information. We do not share your information with third parties
        except the service providers listed above, each of which processes data only as needed to help operate
        Kavanaka, or when required by law.
      </p>

      <h2>Data Retention and Account Deletion</h2>
      <p>
        You can delete your own posts and comments at any time. You can permanently delete your account from
        Me → Edit Profile → Delete Account. Deleting your account removes your profile, posts and their
        photos/videos, comments, likes, saves, follows, messages, and reports you&apos;ve filed, and cannot be
        undone.
      </p>

      <h2>Content Moderation and Reports</h2>
      <p>
        You can report a post or comment that violates our standards. Reports are reviewed, and violating content
        may be removed. We keep a record of report outcomes to maintain a fair moderation history.
      </p>

      <h2>Blocking</h2>
      <p>
        You can block another user from their profile. Blocking is mutual in effect: once either of you blocks
        the other, neither of you can see each other&apos;s posts or comments, follow or message each other, or
        interact with each other&apos;s content, until the block is removed by whoever created it.
      </p>

      <h2>Security</h2>
      <p>
        Kavanaka uses industry-standard access controls at the database level, so your data is only reachable by
        you or, where relevant, the other participant (e.g., a direct message). No method of transmission or
        storage is completely secure, and we cannot guarantee absolute security.
      </p>

      <h2>Children&apos;s Privacy</h2>
      <p>
        Kavanaka does not knowingly collect personal information from children under 13. If we become aware that
        we have collected information from a child under 13, we will take steps to delete it.
      </p>

      <h2>Changes to This Policy</h2>
      <p>
        We may update this Policy as Kavanaka changes. We&apos;ll update the effective date above when we do.
      </p>

      <h2>Contact</h2>
      <p>Questions about this Policy: timlyw007@gmail.com</p>
    </LegalPage>
  );
}
