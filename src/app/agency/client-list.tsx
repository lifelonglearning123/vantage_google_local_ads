"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons";

export type ClientState = "live" | "todo" | "refused" | "unknown";
export type ClientRow = { locationId: string; name: string; numbers: string[]; state: ClientState; detail: string };

const STATE: Record<ClientState, { label: string; icon: IconName }> = {
  live: { label: "Live", icon: "live" },
  todo: { label: "Not live yet", icon: "attention" },
  refused: { label: "Token refused", icon: "refused" },
  unknown: { label: "Couldn't check", icon: "waiting" },
};

type Filter = "all" | "attention" | "live";

export function ClientList({ rows, addForm }: { rows: ClientRow[]; addForm: ReactNode }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(rows.length === 0);

  const counts: Record<Filter, number> = {
    all: rows.length,
    attention: rows.filter((r) => r.state !== "live").length,
    live: rows.filter((r) => r.state === "live").length,
  };
  const text = query.trim().toLowerCase();
  const digits = text.replace(/\D/g, "");
  const shown = rows.filter((r) => {
    if (filter === "live" && r.state !== "live") return false;
    if (filter === "attention" && r.state === "live") return false;
    if (!text) return true;
    return (
      r.name.toLowerCase().includes(text) ||
      r.locationId.toLowerCase().includes(text) ||
      (digits.length >= 3 && r.numbers.some((n) => n.replace(/\D/g, "").includes(digits)))
    );
  });

  const openAdd = () => {
    setAdding(true);
    requestAnimationFrame(() => document.getElementById("locationId")?.focus());
  };

  return (
    <>
      {adding ? (
        <section id="add-client" className="panel panel-top panel-pad rise" aria-labelledby="add-title">
          <div className="add-grid">
            <div className="auth-card-head">
              <h2 id="add-title">Add a client</h2>
              <p>
                Their location ID, and a Private Integration token made in their sub-account. You&apos;ll choose their
                number, stages and services next.
              </p>
              {rows.length ? (
                <button type="button" className="btn btn-quiet add-cancel" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              ) : null}
            </div>
            {addForm}
          </div>
        </section>
      ) : null}

      <section className={`panel${adding ? " section-gap" : " panel-top"}`} aria-labelledby="clients-title">
        <h2 id="clients-title" className="visually-hidden">
          Client list
        </h2>
        <div className="toolbar">
          <div className="segmented" role="group" aria-label="Show">
            {(
              [
                ["all", "All"],
                ["attention", "Needs attention"],
                ["live", "Live"],
              ] as const
            ).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}>
                {label}
                <span className="count">{counts[key]}</span>
              </button>
            ))}
          </div>
          <div className="search">
            <Icon name="search" size={18} />
            <label htmlFor="client-search" className="visually-hidden">
              Search clients
            </label>
            <input
              id="client-search"
              type="search"
              placeholder="Name or number"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {adding ? null : (
            <button type="button" className="btn btn-secondary" aria-controls="add-client" onClick={openAdd}>
              <Icon name="plus" size={18} />
              Add client
            </button>
          )}
        </div>

        {rows.length === 0 ? (
          <div className="empty">
            <h3>No clients yet</h3>
            <p>Add the first one above. Clients can also connect themselves from the app&apos;s front page.</p>
          </div>
        ) : shown.length === 0 ? (
          <div className="empty">
            <h3>No clients match</h3>
            <p>Try another name or number, or show all clients.</p>
          </div>
        ) : (
          <ul className="clients">
            {shown.map((row) => (
              <li key={row.locationId}>
                <Link href={`/agency/clients/${row.locationId}`} prefetch={false} className="client">
                  <span className={`client-state state-${row.state}`}>
                    <Icon name={STATE[row.state].icon} size={24} />
                  </span>
                  <span className="client-main">
                    <span className="client-name">{row.name}</span>
                    <span className="client-meta">
                      <span className={`client-status state-${row.state}`}>{STATE[row.state].label}</span>
                      <span className="num">{row.numbers.length ? row.numbers.join(", ") : "No number yet"}</span>
                    </span>
                    <span className="client-detail">{row.detail}</span>
                  </span>
                  <Icon name="chevronRight" className="client-go" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
