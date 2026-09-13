"use client";

import { useEffect, useRef, useState } from "react";
import { CHAPTERS, WALKTHROUGH_VIDEO, chapterById, formatTime, type ChapterId } from "@/lib/walkthrough";

/** Jumps to a time once the video knows its length, and plays if asked. Playing only follows a click. */
function seekVideo(video: HTMLVideoElement, seconds: number, play: boolean) {
  const go = () => {
    video.currentTime = seconds;
    if (play) void video.play().catch(() => {});
  };
  if (video.readyState >= 1) go();
  else video.addEventListener("loadedmetadata", go, { once: true });
}

const chapterAt = (seconds: number) => [...CHAPTERS].reverse().find((c) => seconds >= c.start - 0.25)?.id ?? null;

/**
 * The walkthrough with its chapters beside it: pick a chapter to jump there,
 * and the one playing stays marked. `startKey` re-runs the jump when the same
 * chapter is asked for again.
 */
export function WalkthroughPlayer({
  startAt,
  startKey = 0,
  autoPlay = false,
}: {
  startAt?: ChapterId | null;
  startKey?: number;
  autoPlay?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [current, setCurrent] = useState<ChapterId | null>(startAt ?? null);

  useEffect(() => {
    if (startAt && video.current) seekVideo(video.current, chapterById(startAt).start, autoPlay);
  }, [startAt, startKey, autoPlay]);

  return (
    <div className="walkthrough">
      <div className="walkthrough-video">
        <video
          ref={video}
          controls
          playsInline
          preload="metadata"
          poster={WALKTHROUGH_VIDEO.poster}
          onTimeUpdate={(e) => {
            const id = chapterAt(e.currentTarget.currentTime);
            setCurrent((was) => (was === id ? was : id));
          }}
        >
          <source src={WALKTHROUGH_VIDEO.src} type="video/mp4" />
          This browser can&apos;t play the video. The chapters beside it describe each step.
        </video>
      </div>
      <nav className="chapters" aria-label="Walkthrough chapters">
        <p className="caps">Chapters</p>
        <ol>
          {CHAPTERS.map((chapter) => (
            <li key={chapter.id}>
              <button
                type="button"
                className="chapter"
                aria-current={current === chapter.id ? "step" : undefined}
                onClick={() => {
                  if (video.current) seekVideo(video.current, chapter.start, true);
                  setCurrent(chapter.id);
                }}
              >
                <span className="chapter-time num">{formatTime(chapter.start)}</span>
                <span>{chapter.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  );
}
