"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { PITCH_FILM } from "@/lib/pitch";
import { Icon } from "./icons";

/**
 * The pitch film for the front page's story panel. On a wide screen it sits
 * there, ready to play. On a phone it's a button that opens it, so the connect
 * form stays in reach. It plays only when someone asks, and on the front page
 * nothing downloads until then.
 */
export function StoryFilm() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <figure className="story-film">
        <video controls playsInline preload="none" poster={PITCH_FILM.poster} aria-label={PITCH_FILM.label}>
          <source src={PITCH_FILM.src} type="video/mp4" />
          This browser can&apos;t play the video.
        </video>
        <figcaption>
          <span>Vantage for agencies, in 47 seconds</span>
          <Link href="/agencies">More for agencies</Link>
        </figcaption>
      </figure>

      <button
        type="button"
        className="help-link story-film-open"
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        <Icon name="play" size={16} />
        Watch the 47-second film
      </button>
      <dialog
        ref={dialog}
        className="help-dialog"
        aria-labelledby="story-film-title"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <div className="help-dialog-head">
          <h2 id="story-film-title">Vantage for agencies</h2>
          <button type="button" className="btn btn-quiet" onClick={() => dialog.current?.close()}>
            <Icon name="refused" size={18} />
            Close
          </button>
        </div>
        {open ? (
          <div className="pitch-video">
            <video controls playsInline autoPlay poster={PITCH_FILM.poster} aria-label={PITCH_FILM.label}>
              <source src={PITCH_FILM.src} type="video/mp4" />
            </video>
          </div>
        ) : null}
        <p className="help-dialog-foot">
          Running Google Local Ads for clients? <Link href="/agencies">See Vantage for agencies</Link>
        </p>
      </dialog>
    </>
  );
}
