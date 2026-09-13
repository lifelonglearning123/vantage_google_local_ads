import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthLayout } from "@/components/auth-layout";
import { ConnectForm } from "@/components/connect-form";
import { HelpButton } from "@/components/help-button";
import { StoryFilm } from "@/components/pitch-film";
import { readClient } from "@/lib/clients";
import { getSignedInLocation } from "@/lib/session";
import { connectAction } from "./actions";

export default async function ConnectPage() {
  const locationId = await getSignedInLocation();
  if (locationId && (await readClient(locationId))) redirect("/settings");

  return (
    <AuthLayout
      title="Answer only the calls that matter."
      lead="Every call to your Signal number lands in your Nexus Portal pipeline straight away. Vantage AI reads it and moves it to the right stage, with a note saying why."
      story={<StoryFilm />}
    >
      <div className="auth-column">
        <section className="auth-card" aria-labelledby="connect-title">
          <div className="auth-card-head">
            <h2 id="connect-title">Connect your Nexus Portal</h2>
            <p>Already connected? Enter the same details to change your settings.</p>
            <HelpButton chapter="add-client" label="Watch how to connect" />
          </div>
          <ConnectForm action={connectAction} submitLabel="Connect" />
        </section>
        <p className="auth-foot">
          Looking after several sub-accounts? <Link href="/agency">Agency sign-in</Link>
          <br />
          Stuck? <Link href="/help">Watch the walkthrough</Link>
        </p>
      </div>
    </AuthLayout>
  );
}
