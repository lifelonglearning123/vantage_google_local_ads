import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "./brand";
import { Icon } from "./icons";

/** The navy base layer at the top of a signed-in page. The page's first panel rises over its lower edge. */
export function TopBand({
  brandHref,
  tag,
  actions,
  back,
  title,
  subtitle,
}: {
  brandHref?: string;
  tag?: string;
  actions?: ReactNode;
  back?: { href: string; label: string };
  title: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <header className="band on-ink">
      <div className="band-inner">
        <div className="band-top">
          <span className="band-actions">
            <Brand href={brandHref} />
            {tag ? <span className="tag">{tag}</span> : null}
          </span>
          {actions ? <div className="band-actions">{actions}</div> : null}
        </div>
        {back ? (
          <Link href={back.href} className="band-back">
            <Icon name="chevronLeft" size={18} />
            {back.label}
          </Link>
        ) : null}
        <div className="band-title">
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
    </header>
  );
}
