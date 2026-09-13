import type { Metadata } from "next";
import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import { TopBand } from "@/components/top-band";

export const metadata: Metadata = { title: "For agencies" };

const PITCH = { src: "/pitch/vantage-agency-pitch.mp4", poster: "/pitch/poster.jpg" };

// What the app does today, in the pitch's own terms. Keep these true to the product.
const POINTS: { icon: IconName; title: string; text: string }[] = [
  {
    icon: "phone",
    title: "Every call sorted",
    text: "Each call your ads bring in lands in your client's pipeline, then moves to the right stage with a note saying why.",
  },
  {
    icon: "refused",
    title: "Time-wasters filtered out",
    text: "Job seekers, sales pitches, spam and wrong numbers are marked Lost, so nobody chases them.",
  },
  {
    icon: "live",
    title: "Every client in one view",
    text: "See who's live and who needs a hand, and connect a new client in a couple of minutes.",
  },
];

/** The sales film for agencies running Google Local Ads. Public, so it's the link to send a prospect. */
export default function AgenciesPage() {
  return (
    <>
      <TopBand
        brandHref="/"
        title="Take the high ground."
        subtitle="Vantage for agencies running Google Local Ads. Every call your ads bring in, read and sorted before your client's team picks up the phone to call back."
        actions={
          <Link href="/agency" className="btn btn-quiet">
            Agency sign-in
          </Link>
        }
      />
      <main className="page">
        <div className="pitch-video">
          <video controls playsInline preload="metadata" poster={PITCH.poster} aria-label="Vantage for agencies, a 47-second film">
            <source src={PITCH.src} type="video/mp4" />
            This browser can&apos;t play the video.
          </video>
        </div>

        <section className="panel section-gap" aria-labelledby="pitch-points-title">
          <h2 id="pitch-points-title" className="visually-hidden">
            What your agency gets
          </h2>
          <ul className="pitch-points">
            {POINTS.map((point) => (
              <li key={point.title}>
                <Icon name={point.icon} size={24} />
                <h3>{point.title}</h3>
                <p>{point.text}</p>
              </li>
            ))}
          </ul>
          <div className="pitch-actions">
            <Link href="/help" className="btn btn-primary">
              <Icon name="play" size={18} />
              See how it works
            </Link>
            <Link href="/agency" className="btn btn-secondary">
              Agency sign-in
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
