import { useState, type CSSProperties } from "react";
import { SystemsNav } from "../SystemsNav.tsx";
import { NIST_AI_RMF, OWASP_LLM, RISK_STATUS_LABEL, ROADMAP, SAIF, owaspTally, partsOf, refsOf, statusOf, type RiskStatus } from "./model.ts";
import { RISK_CHECK } from "./checks.ts";
import { ACCENT, CheckRack, Key, type Check, type Group } from "./Checks.tsx";
import { FRAME_EXPLAIN, NIST_EXPLAIN, OWASP_EXPLAIN, SAIF_EXPLAIN, type FrameId } from "./explain.ts";
import { Chips, DOC_URL, Facts, Out } from "./parts.tsx";

/**
 * Boiler Room > Compliance (#82; on Today's flow kit since #445): each framework docs/THREAT-MODEL.md maps C.E.O. to
 * (the OWASP Top 10 for LLM Applications, the NIST AI RMF and Google SAIF) as a bundle of particle lines, one a
 * control, gathering into the framework's figure. A control in place flows; one covered with more planned thins out;
 * an open risk stops at a red knot; an accepted one lies dashed; one that doesn't apply is a faint bed. Each line opens
 * to the control word for word from the doc. Nothing here is mapped that the doc doesn't map; what isn't mapped yet
 * says so.
 */

const ORDER: RiskStatus[] = ["covered", "tracked", "open", "accepted", "not-applicable"];
const FRAME_TITLE: Record<FrameId, string> = {
  owasp: "OWASP Top 10 for LLM Applications",
  nist: "NIST AI RMF",
  saif: "Google SAIF",
  regulation: "Regulation",
};

function End({ big, of, what }: { big: string; of: string; what: string }) {
  return (
    <p className="sx-endfig">
      <b className="fl-num">
        {big}
        <small>{of}</small>
      </b>
      <span>{what}</span>
    </p>
  );
}

/** A framework's own few words, folded under its name. */
function About({ id }: { id: FrameId }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="sx-about" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "–" : "+"} About {id === "owasp" ? "OWASP" : FRAME_TITLE[id]}
      </button>
      {open && (
        <div className="sx-aboutp">
          <Facts e={FRAME_EXPLAIN[id]} />
        </div>
      )}
    </>
  );
}

export function CompliancePage() {
  const tally = owaspTally();
  const covered = tally.covered + tally.tracked;
  const controls = OWASP_LLM.length + NIST_AI_RMF.length + SAIF.length;

  const owasp: Check[] = OWASP_LLM.map((r) => {
    const st = statusOf(r.controls, r.tracking);
    const list = st === "not-applicable" ? [] : partsOf(r.controls);
    const road = refsOf(r.tracking)
      .filter((x) => x.startsWith("R"))
      .map((id) => ROADMAP.find((x) => x.id === id))
      .filter((x) => !!x);
    return {
      id: `owasp-${r.id}`,
      name: (
        <>
          <span className="sx-id">{r.id}</span> {r.name}
        </>
      ),
      label: `${r.id} ${r.name}`,
      sub: `${RISK_STATUS_LABEL[st]}${list.length ? ` · ${list.length} control${list.length === 1 ? "" : "s"}` : st === "not-applicable" ? "" : " · not used"}`,
      state: RISK_CHECK[st],
      kicker: `OWASP ${r.id}`,
      about: OWASP_EXPLAIN[r.id],
      detail: (
        <dl className="sx-dl">
          <div>
            <dt>Where it applies</dt>
            <dd>{r.where}</dd>
          </div>
          {list.length > 0 && (
            <div>
              <dt>Controls in place</dt>
              <dd>
                <Chips items={list} />
              </dd>
            </div>
          )}
          <div>
            <dt>What's left</dt>
            <dd>{r.residual}</dd>
          </div>
          <div>
            <dt>Tracking</dt>
            <dd>
              {r.tracking}
              {road.map((x) => (
                <span key={x.id} className="sx-road">
                  {x.id}: {x.item.split(/[:(]/)[0]!.trim()} · {x.status}
                </span>
              ))}
            </dd>
          </div>
        </dl>
      ),
    };
  });

  const nist: Check[] = NIST_AI_RMF.map((x) => ({
    id: `nist-${x.fn}`,
    name: x.fn,
    label: `NIST ${x.fn}`,
    sub: "Mapped",
    state: "pass",
    kicker: "NIST AI RMF function",
    about: NIST_EXPLAIN[x.fn],
    detail: <Chips items={partsOf(x.inCeo)} />,
  }));

  const saif: Check[] = SAIF.map((x, i) => ({
    id: `saif-${i + 1}`,
    name: x.element,
    label: x.element,
    sub: "Mapped",
    state: "pass",
    kicker: "SAIF core element",
    about: SAIF_EXPLAIN[x.element],
    detail: <Chips items={partsOf(x.inCeo)} />,
  }));

  const groups: Group[] = [
    {
      id: "owasp",
      title: "OWASP Top 10 for LLM Applications (2025)",
      note: `${ORDER.filter((st) => tally[st])
        .map((st) => `${tally[st]} ${RISK_STATUS_LABEL[st].toLowerCase()}`)
        .join(", ")}`,
      aside: <Out href={DOC_URL}>Threat model</Out>,
      checks: owasp,
      end: <End big={String(covered)} of={`/${OWASP_LLM.length}`} what="risks covered" />,
      foot: <About id="owasp" />,
    },
    {
      id: "nist",
      title: "NIST AI RMF",
      note: `${NIST_AI_RMF.map((x) => x.fn).join(", ")}, mapped at the function level; categories not yet`,
      checks: nist,
      end: <End big={String(NIST_AI_RMF.length)} of={`/${NIST_AI_RMF.length}`} what="functions mapped" />,
      foot: <About id="nist" />,
    },
    {
      id: "saif",
      title: "Google SAIF",
      note: "every core element mapped to something C.E.O. already does, from the supply chain to the risks in context",
      checks: saif,
      end: <End big={String(SAIF.length)} of={`/${SAIF.length}`} what="core elements mapped" />,
      foot: <About id="saif" />,
    },
  ];

  const header = (
    <>
      <SystemsNav />
      <header className="sx-top">
        <p className="fl-eyb">
          <span>Boiler Room</span>
          <i />
          Compliance · frameworks and controls
        </p>
        <h1 className="fl-h1 desk__title">
          Three frameworks, <em>{covered === OWASP_LLM.length ? "all in place." : "mostly in place."}</em>
        </h1>
        <p className="fl-say">How C.E.O. maps to the frameworks people trust for AI systems, word for word from the threat model. Each line is one control, gathering into its framework; open one for the control itself.</p>
        <dl className="fl-ledger sx-ledger">
          <div className={covered === OWASP_LLM.length ? "is-pass" : "is-part"}>
            <dt>OWASP LLM</dt>
            <dd>
              {covered}
              <small>/{OWASP_LLM.length}</small>
            </dd>
          </div>
          <div className={tally.open ? "is-fail" : "is-pass"}>
            <dt>Open, tracked</dt>
            <dd>{tally.open}</dd>
          </div>
          <div className="is-pass">
            <dt>NIST AI RMF</dt>
            <dd>
              {NIST_AI_RMF.length}
              <small>/{NIST_AI_RMF.length}</small>
            </dd>
          </div>
          <div className="is-pass">
            <dt>Google SAIF</dt>
            <dd>
              {SAIF.length}
              <small>/{SAIF.length}</small>
            </dd>
          </div>
          <div>
            <dt>Controls</dt>
            <dd>{controls}</dd>
          </div>
        </dl>
      </header>
      <Key words={{ pass: "In place", part: "More planned", wait: "Accepted", fail: "Open" }} />
    </>
  );

  return (
    <div className="sx-page wv-page fl-page" data-room="boiler" style={{ "--fl-accent": ACCENT } as CSSProperties}>
      <CheckRack groups={groups} header={header} label="Compliance: every control as a line" />
      <section className="fl-below sx-law" aria-label="Regulation">
        <p className="fl-k">
          <span>Regulation</span> · not mapped yet
        </p>
        <p className="sx-lawp">No law or standard is mapped in the repo yet. Relay's privacy spec (R5, #149) is written, ahead of the hub.</p>
        <Facts e={FRAME_EXPLAIN.regulation} />
      </section>
    </div>
  );
}
