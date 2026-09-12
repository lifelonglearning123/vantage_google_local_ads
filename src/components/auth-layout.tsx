import type { ReactNode } from "react";
import { Brand } from "./brand";

/** Connect and sign-in: what the app does, on navy, with the form rising beside it (above it on a phone). */
export function AuthLayout({
  title,
  lead,
  story,
  children,
}: {
  title: string;
  lead: string;
  story?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="auth">
      <section className="auth-story on-ink">
        <Brand />
        <div className="auth-story-body">
          <h1>{title}</h1>
          <p>{lead}</p>
          {story}
        </div>
      </section>
      <main className="auth-main">{children}</main>
    </div>
  );
}
