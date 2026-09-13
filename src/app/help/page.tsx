import type { Metadata } from "next";
import Link from "next/link";
import { TopBand } from "@/components/top-band";
import { isChapterId } from "@/lib/walkthrough";
import { HelpGuide } from "./help-guide";

export const metadata: Metadata = { title: "Help" };

/** Public on purpose: people get stuck before they've connected or signed in. `?chapter=` opens at that step. */
export default async function HelpPage({ searchParams }: PageProps<"/help">) {
  const { chapter } = await searchParams;

  return (
    <>
      <TopBand
        brandHref="/"
        title="How Vantage works"
        subtitle="Under two minutes, start to finish. Pick a chapter to jump straight to the part you're on."
        actions={
          <Link href="/agency" className="btn btn-quiet">
            Agency sign-in
          </Link>
        }
      />
      <main className="page">
        <HelpGuide initialChapter={isChapterId(chapter) ? chapter : null} />
      </main>
    </>
  );
}
