import LegalPage from "@/components/legal/LegalPage";

export const metadata = {
  title: "Kavanaka Support",
  description: "Get help with your Kavanaka account, report a problem, or contact us directly.",
};

export default function SupportPage() {
  return (
    <LegalPage title="Kavanaka Support">
      <p>
        Need help with Kavanaka? If you have a question, encounter a problem, or need help with your account,
        contact us and we&apos;ll do our best to help.
      </p>

      <h2>Contact</h2>
      <p>
        <a href="mailto:timlyw007@gmail.com">timlyw007@gmail.com</a>
      </p>

      <h2>Account &amp; Safety</h2>
      <p>
        Users can manage their profile and account from within Kavanaka. Account deletion is available in the
        app. If you encounter inappropriate content or behavior, use the in-app reporting and blocking tools.
      </p>

      <h2>Privacy &amp; Terms</h2>
      <p>
        <a href="/privacy">Privacy Policy</a>
        <br />
        <a href="/terms">Terms of Service</a>
      </p>
    </LegalPage>
  );
}
