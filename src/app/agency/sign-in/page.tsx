import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/auth-layout";
import { Icon } from "@/components/icons";
import { agencyLogin, isAgencySignedIn } from "@/lib/session";
import { AgencySignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Agency sign-in" };

export default async function AgencySignInPage() {
  if (await isAgencySignedIn()) redirect("/agency");
  const setup = agencyLogin();

  return (
    <AuthLayout
      title="Every client, one view."
      lead="See who's live and who needs a hand, add new clients, and change anyone's number, stages or services."
    >
      <div className="auth-column">
        <section className="auth-card" aria-labelledby="agency-title">
          <div className="auth-card-head">
            <h2 id="agency-title">Agency sign-in</h2>
          </div>
          {setup.ok ? (
            <AgencySignInForm />
          ) : (
            <div className="alert alert-warn" role="alert">
              <Icon name="attention" size={18} />
              <span>{setup.reason}</span>
            </div>
          )}
        </section>
        <p className="auth-foot">
          Connecting your own sub-account? <Link href="/">Connect here</Link>
          <br />
          New to Vantage? <Link href="/help">Watch the walkthrough</Link>
        </p>
      </div>
    </AuthLayout>
  );
}
