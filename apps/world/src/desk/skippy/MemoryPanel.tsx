import { useEffect, useState } from "react";
import { Private } from "@ceo/engine/web/Private.tsx";

/**
 * What Skippy keeps of Nikita (#646), behind the passkey: the core card he reads every turn, the facts he can look
 * up, and the pages' index. Nikita can change the card, forget any fact, and paste the project's memory in (one
 * fact a line). The server refuses money, legal details, the skip list and the priority list; refused lines come
 * back as counts by reason, never echoed.
 */

interface MemFact {
  id: string;
  text: string;
  topic: string;
  source: string;
  at: number;
}
interface MemPage {
  id: string;
  title: string;
  topic: string;
  summary: string;
}
interface MemView {
  core: string;
  facts: MemFact[];
  pages: MemPage[];
  journal: number;
}

const REASON: Record<string, string> = {
  private: "looked private",
  money: "money",
  legal: "legal",
  skip: "on the skip list",
  lists: "priority or skip list",
  empty: "empty",
};

async function post(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch("/api/skippy-memory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
    return (await res.json().catch(() => null)) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

export default function MemoryPanel({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<MemView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [core, setCore] = useState("");
  const [paste, setPaste] = useState("");
  const [note, setNote] = useState("");

  const load = async () => {
    try {
      const res = await fetch("/api/skippy-memory", { credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      const v = (await res.json()) as MemView;
      setView(v);
      setCore(v.core ?? "");
      setState("ready");
    } catch {
      setState("failed");
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const saveCore = async () => {
    const got = await post({ action: "core", text: core });
    setNote(got?.ok ? "Card saved." : got?.why ? `Not kept: ${REASON[String(got.why)] ?? "refused"}.` : "Couldn't save the card.");
  };
  const forget = async (id: string) => {
    const got = await post({ action: "forget", id });
    if (got?.ok) setView((v) => (v ? { ...v, facts: v.facts.filter((f) => f.id !== id), pages: v.pages.filter((p) => p.id !== id) } : v));
  };
  const importFacts = async () => {
    const facts = paste
      .split("\n")
      .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 200);
    if (!facts.length) return;
    const got = await post({ action: "facts", facts, source: "project" });
    if (!got?.ok) {
      setNote("Couldn't bring those in.");
      return;
    }
    const refused = Object.entries((got.refused ?? {}) as Record<string, number>)
      .filter(([, n]) => n > 0)
      .map(([why, n]) => `${n} ${REASON[why] ?? why}`);
    setNote(`Kept ${String(got.kept ?? 0)}.${refused.length ? ` Left out: ${refused.join(", ")}.` : ""}`);
    setPaste("");
    void load();
  };

  return (
    <section className="skp-mem" aria-label="What Skippy remembers">
      <header className="skp-mem__head">
        <h3>What I keep of you</h3>
        <button type="button" className="btn btn--sm" onClick={onClose}>
          Close
        </button>
      </header>
      {state === "loading" && <p className="skp-mem__muted">Opening the vault…</p>}
      {state === "failed" && <p className="skp-mem__muted">The vault won't open right now.</p>}
      {state === "ready" && view && (
        <Private as="div" block className="skp-mem__body">
          <label className="skp-mem__label" htmlFor="skp-mem-core">
            Core card <span>read every turn</span>
          </label>
          <textarea id="skp-mem-core" className="skp-mem__text" rows={3} maxLength={1500} value={core} onChange={(e) => setCore(e.target.value)} />
          <div className="skp-mem__row">
            <button type="button" className="btn btn--sm" onClick={() => void saveCore()}>
              Save card
            </button>
          </div>

          <p className="skp-mem__label">
            Facts <span>{view.facts.length}</span>
            {view.pages.length > 0 && <span> · pages {view.pages.length}</span>}
            {view.journal > 0 && <span> · {view.journal} recent turns</span>}
          </p>
          {view.facts.length === 0 && view.pages.length === 0 ? (
            <p className="skp-mem__muted">Nothing yet. Say "remember that…" in chat, or paste below.</p>
          ) : (
            <ul className="skp-mem__list">
              {view.pages.map((p) => (
                <li key={p.id}>
                  <span className="skp-mem__topic">page</span>
                  <span className="skp-mem__fact">
                    <b>{p.title}</b> {p.summary}
                  </span>
                  <button type="button" className="skp-mem__x" onClick={() => void forget(p.id)} aria-label={`Forget ${p.title}`}>
                    Forget
                  </button>
                </li>
              ))}
              {view.facts.map((f) => (
                <li key={f.id}>
                  <span className="skp-mem__topic">{f.topic}</span>
                  <span className="skp-mem__fact">{f.text}</span>
                  <button type="button" className="skp-mem__x" onClick={() => void forget(f.id)} aria-label="Forget this">
                    Forget
                  </button>
                </li>
              ))}
            </ul>
          )}

          <label className="skp-mem__label" htmlFor="skp-mem-paste">
            Bring facts in <span>one a line</span>
          </label>
          <textarea id="skp-mem-paste" className="skp-mem__text" rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Likes the window seat" />
          <div className="skp-mem__row">
            <button type="button" className="btn btn--sm" disabled={!paste.trim()} onClick={() => void importFacts()}>
              Keep these
            </button>
          </div>
        </Private>
      )}
      {note && (
        <p className="skp-mem__note" role="status">
          {note}
        </p>
      )}
    </section>
  );
}
