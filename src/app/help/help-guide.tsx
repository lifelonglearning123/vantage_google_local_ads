"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { WalkthroughPlayer } from "@/components/walkthrough-player";
import { CHAPTERS, formatTime, type ChapterId } from "@/lib/walkthrough";

/** The walkthrough, then every step written out; Watch on a step plays the video from there. */
export function HelpGuide({ initialChapter }: { initialChapter: ChapterId | null }) {
  const [target, setTarget] = useState({ id: initialChapter, key: 0, play: false });

  return (
    <>
      <WalkthroughPlayer startAt={target.id} startKey={target.key} autoPlay={target.play} />

      <section className="panel panel-pad section-gap stack" aria-labelledby="guide-title">
        <div className="auth-card-head">
          <h2 id="guide-title">Every step, written out</h2>
          <p>For when you&apos;d rather read, or can&apos;t play the video.</p>
        </div>
        <ol className="guide">
          {CHAPTERS.map((chapter) => (
            <li key={chapter.id}>
              <span className="chapter-time num">{formatTime(chapter.start)}</span>
              <h3>{chapter.title}</h3>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setTarget((was) => ({ id: chapter.id, key: was.key + 1, play: true }));
                  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
                  window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
                }}
              >
                <Icon name="play" size={16} />
                Watch
              </button>
              <p>{chapter.summary}</p>
            </li>
          ))}
        </ol>
        <div className="inline-actions">
          <Link href="/" className="btn btn-primary">
            Connect your Nexus Portal
          </Link>
          <Link href="/agency" className="btn btn-secondary">
            Agency sign-in
          </Link>
        </div>
      </section>
    </>
  );
}
