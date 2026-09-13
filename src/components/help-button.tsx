"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { chapterById, type ChapterId } from "@/lib/walkthrough";
import { Icon } from "./icons";
import { WalkthroughPlayer } from "./walkthrough-player";

/**
 * Help at the point someone gets stuck: opens the walkthrough in a dialog at
 * the chapter for this part of the page, playing. Closing it (the button, Esc
 * or the backdrop) removes the player, so the video stops.
 */
export function HelpButton({
  chapter,
  label = "Watch how",
  look = "link",
}: {
  chapter: ChapterId;
  label?: string;
  look?: "link" | "band";
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const { title } = chapterById(chapter);

  return (
    <>
      <button
        type="button"
        className={look === "band" ? "btn btn-quiet" : "help-link"}
        aria-haspopup="dialog"
        aria-label={look === "band" ? label : undefined}
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        <Icon name="help" size={look === "band" ? 18 : 16} />
        <span className={look === "band" ? "btn-label" : undefined}>{label}</span>
      </button>
      <dialog
        ref={dialog}
        className="help-dialog"
        aria-labelledby={`help-${chapter}-title`}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <div className="help-dialog-head">
          <h2 id={`help-${chapter}-title`}>{title}</h2>
          <button type="button" className="btn btn-quiet" onClick={() => dialog.current?.close()}>
            <Icon name="refused" size={18} />
            Close
          </button>
        </div>
        {open ? <WalkthroughPlayer startAt={chapter} autoPlay /> : null}
        <p className="help-dialog-foot">
          Still stuck? <Link href={`/help?chapter=${chapter}`}>Open the full walkthrough</Link> with every step written out.
        </p>
      </dialog>
    </>
  );
}
