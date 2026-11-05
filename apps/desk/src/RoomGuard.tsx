import { Component, Fragment, type ReactNode } from "react";
import { RoomMounted } from "@ceo/engine/web/roomReady.ts";
import { claimReload, describeError, isChunkError } from "./roomGuard.ts";

const session = (): Storage | null => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

/**
 * Around each Desk page (#909): a page that throws shows a card with Retry in its place instead of blanking the Desk.
 * A page whose code didn't load (a deploy swapped the chunks under an open tab) reloads once first (roomGuard.ts).
 */
export class RoomGuard extends Component<{ name: string; children: ReactNode }, { error: unknown; tries: number }> {
  state = { error: null as unknown, tries: 0 };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
    if (isChunkError(error) && claimReload(session(), Date.now())) window.location.reload();
  }

  render() {
    const { error, tries } = this.state;
    if (!error) return <Fragment key={tries}>{this.props.children}</Fragment>;
    const chunk = isChunkError(error);
    return (
      <section className="desk-guard" role="alert" style={{ maxWidth: 560, margin: "48px auto", padding: "24px 16px", color: "var(--text, #e8eef5)", textAlign: "center", lineHeight: 1.5 }}>
        <h2 style={{ fontSize: 20, margin: "0 0 8px" }}>{this.props.name} didn't open</h2>
        <p style={{ margin: "0 0 12px", opacity: 0.8 }}>{chunk ? "The site was updated since this tab opened. Reload to get the new version." : "This page hit an error. The rest of the Desk is fine."}</p>
        {!chunk && <p style={{ margin: "0 0 16px", fontFamily: "var(--mono, monospace)", fontSize: 12, opacity: 0.6, overflowWrap: "anywhere" }}>{describeError(error)}</p>}
        <button type="button" style={{ padding: "8px 18px", borderRadius: 999, border: "1px solid var(--hair-strong, #556)", background: "var(--panel, #12161c)", color: "inherit", font: "inherit", cursor: "pointer" }} onClick={() => (chunk ? window.location.reload() : this.setState({ error: null, tries: tries + 1 }))}>
          {chunk ? "Reload" : "Retry"}
        </button>
        {/* Lets the room loader fade, so the card shows instead of a cover. */}
        <RoomMounted />
      </section>
    );
  }
}
