import LegalPage from "@/components/legal/LegalPage";

export const metadata = {
  title: "Terms of Service — Kavanaka",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" effectiveDate="August 28, 2026">
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your use of Kavanaka. By using Kavanaka, you agree to
        these Terms.
      </p>

      <h2>Acceptance of Terms</h2>
      <p>
        By creating an account or otherwise using Kavanaka, you agree to be bound by these Terms and by our{" "}
        <a href="/privacy">Privacy Policy</a>. If you do not agree, do not use Kavanaka.
      </p>

      <h2>Eligibility</h2>
      <p>
        You must have the legal capacity to agree to these Terms under the laws that apply to you in order to use
        Kavanaka. If you are a minor in your jurisdiction, you may only use Kavanaka with the consent of a parent
        or legal guardian where required by applicable law, and you and your parent or guardian are responsible
        for confirming you&apos;re permitted to use Kavanaka under those laws.
      </p>

      <h2>Accounts</h2>
      <p>
        Kavanaka accounts are created through Google Sign-In. You&apos;re responsible for the activity on your
        account and for keeping your Google account secure. You&apos;re responsible for the accuracy of the
        profile information you provide.
      </p>

      <h2>User-Generated Content</h2>
      <p>
        You retain ownership of the posts, comments, photos, videos, and other content you submit to Kavanaka.
        By submitting content, you grant Kavanaka a non-exclusive, worldwide, royalty-free license to host,
        store, reproduce, display, distribute, process, and technically modify (for example, to resize an image
        or transcode a video) your content, solely to the extent reasonably necessary to operate and provide
        Kavanaka to you and other users. This license ends when you delete the content or your account, except
        where a copy reasonably persists in routine backups for a limited period.
      </p>
      <p>
        You&apos;re solely responsible for the content you post, and you represent that you have the rights
        necessary to post it and that it doesn&apos;t violate these Terms or applicable law.
      </p>

      <h2>Acceptable Use</h2>
      <p>You agree not to use Kavanaka to:</p>
      <ul>
        <li>Post content that is illegal, harassing, hateful, or infringes someone else&apos;s rights.</li>
        <li>Impersonate another person or misrepresent your affiliation with any person or organization.</li>
        <li>Harass, threaten, or abuse other users, including through direct messages.</li>
        <li>Interfere with or disrupt Kavanaka&apos;s normal operation or attempt unauthorized access.</li>
        <li>Use Kavanaka for spam, scraping, or other automated abuse.</li>
      </ul>

      <h2>Community Safety — Reporting, Moderation, and Blocking</h2>
      <p>
        You can report posts or comments that violate these Terms; reports are reviewed and violating content may
        be removed. You can block another user, which mutually restricts visibility and interaction between you
        and that user — see the Privacy Policy for exactly how blocking works. We may review, remove, or restrict
        access to content or accounts that violate these Terms.
      </p>

      <h2>Intellectual Property</h2>
      <p>
        Kavanaka&apos;s own branding, design, and software are protected by applicable intellectual property
        laws. Nothing in these Terms transfers any Kavanaka intellectual property to you, other than the limited
        right to use the service as intended.
      </p>

      <h2>Third-Party Services</h2>
      <p>
        Kavanaka is built using Google Sign-In, Supabase, Vercel, and OpenStreetMap. Your use of Kavanaka is also
        subject to the applicable terms of those providers where relevant. Kavanaka is not responsible for the
        practices or availability of third-party services it relies on.
      </p>

      <h2>Service Availability</h2>
      <p>
        Kavanaka is provided on an ongoing basis, but we don&apos;t guarantee uninterrupted availability. Features
        may be added, changed, or removed at any time.
      </p>

      <h2>Account Suspension / Termination</h2>
      <p>
        We may suspend or terminate your access to Kavanaka if you violate these Terms. You can stop using
        Kavanaka, or permanently delete your account, at any time from Me → Edit Profile → Delete Account.
      </p>

      <h2>Disclaimers</h2>
      <p>
        Kavanaka is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without warranties of any kind,
        whether express or implied, including any warranty of merchantability, fitness for a particular purpose,
        or non-infringement. We don&apos;t warrant that Kavanaka will be uninterrupted, error-free, or secure.
      </p>

      <h2>Limitation of Liability</h2>
      <p>
        To the fullest extent permitted by applicable law, Kavanaka and its operators will not be liable for any
        indirect, incidental, special, consequential, or punitive damages, or any loss of data, arising from your
        use of Kavanaka.
      </p>

      <h2>Changes to Terms</h2>
      <p>
        We may update these Terms as Kavanaka changes. Continued use of Kavanaka after an update means you accept
        the revised Terms.
      </p>

      <h2>Contact</h2>
      <p>Questions about these Terms: timlyw007@gmail.com</p>
    </LegalPage>
  );
}
