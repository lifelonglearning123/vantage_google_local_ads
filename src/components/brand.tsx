import Link from "next/link";

/**
 * The Vantage lockup: the symbol (a V cut from two heavy bars, the vantage
 * square at its shoulder) and the Archivo Extra Bold wordmark. Shapes come
 * straight from the brand book. The V takes the text colour, so the same
 * lockup is ink on ground and ground on ink; the square is always amber.
 */
export function Brand({ href }: { href?: string }) {
  const content = (
    <>
      <svg viewBox="0 0 43.51 39.03" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M0 0h10.57l10.45 27.02L31.59 0h10.46L26.31 39.03H15.74z" />
        <rect x="34.51" y="29.96" width="9" height="9" fill="#D9820B" />
      </svg>
      Vantage
    </>
  );
  return href ? (
    <Link href={href} className="brand">
      {content}
    </Link>
  ) : (
    <span className="brand">{content}</span>
  );
}
