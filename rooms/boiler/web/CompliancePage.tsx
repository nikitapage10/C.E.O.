import { useState, type CSSProperties } from "react";
import { SystemsNav } from "./SystemsNav.tsx";
import { NIST_AI_RMF, OWASP_LLM, RISK_STATUS_LABEL, ROADMAP, SAIF, owaspTally, partsOf, refsOf, statusOf, type RiskStatus } from "../data/model.ts";
import { RISK_CHECK } from "../data/checks.ts";
import { ACCENT, type Check } from "./Checks.tsx";
import { BoilerFrame, Panel, Ring, StackBar, useOpen } from "./frame.tsx";
import { complianceNeeds, frameworkBars, STATUS_ORDER } from "../data/pages.ts";
import { CheckList } from "./CheckList.tsx";
import { FRAME_EXPLAIN, NIST_EXPLAIN, OWASP_EXPLAIN, SAIF_EXPLAIN, type FrameId } from "../data/explain.ts";
import { Chips, DOC_URL, Facts, Out } from "./parts.tsx";

/**
 * Boiler Room > Compliance (#82; one screen since #746, the P3 concept: a coverage ring and a bar per framework, then
 * what isn't fully in place, then each framework's controls one folded line away; an open risk goes in "Needs you").
 * Before #746, on Today's flow kit (#445): each framework docs/THREAT-MODEL.md maps C.E.O. to
 * (the OWASP Top 10 for LLM Applications, the NIST AI RMF and Google SAIF) as a bundle of particle lines, one a
 * control, gathering into the framework's figure. A control in place flows; one covered with more planned thins out;
 * an open risk stops at a red knot; an accepted one lies dashed; one that doesn't apply is a faint bed. Each line opens
 * to the control word for word from the doc. Nothing here is mapped that the doc doesn't map; what isn't mapped yet
 * says so.
 */

const FRAME_TITLE: Record<FrameId, string> = {
  owasp: "OWASP Top 10 for LLM Applications",
  nist: "NIST AI RMF",
  saif: "Google SAIF",
  regulation: "Regulation",
};

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

  const bars = frameworkBars();
  const needs = complianceNeeds();
  const [open, toggle] = useOpen();
  const now = Date.now();
  const STATUS_TONE: Record<RiskStatus, string> = { covered: "covered", tracked: "tracked", open: "open", accepted: "accepted", "not-applicable": "not-applicable" };
  // What isn't fully in place gets the room; open risks are already in Needs you.
  const gaps = OWASP_LLM.map((r) => ({ r, st: statusOf(r.controls, r.tracking) })).filter((x) => x.st !== "covered" && x.st !== "open");
  const tracked = gaps.filter((x) => x.st === "tracked").length;

  return (
    <div className="sx-page wv-page fl-page" data-room="boiler" style={{ "--fl-accent": ACCENT } as CSSProperties}>
      <BoilerFrame
        page="compliance"
        tabs={<SystemsNav className="bx-tabs" />}
        title={
          <>
            Three frameworks, <em className={tally.open ? "is-fail" : undefined}>{covered === OWASP_LLM.length ? "all in place" : "mostly in place"}</em>
          </>
        }
        say={`How C.E.O. maps to the frameworks people trust for AI systems, word for word from the threat model: ${controls} controls.`}
        needs={needs}
        now={now}
        onGo={() => undefined}
      >
        <div className="bx-cov">
          {bars.map((f) => (
            <section key={f.id} className="bx-panel" aria-label={`${f.name}: ${f.total ? `${f.inPlace} of ${f.total} in place` : "not mapped yet"}`}>
              <Ring v={f.total ? f.inPlace / f.total : 0} tone={!f.total ? "none" : f.counts.open ? "open" : f.inPlace === f.total ? "covered" : "tracked"} text={f.total ? `${f.inPlace}/${f.total}` : "–"} size={64} />
              <div>
                <h2>{f.name}</h2>
                <StackBar total={f.total} parts={STATUS_ORDER.map((st) => ({ n: f.counts[st], tone: STATUS_TONE[st], label: RISK_STATUS_LABEL[st].toLowerCase() }))} />
                <p className="bx-note">
                  {f.total
                    ? STATUS_ORDER.filter((st) => f.counts[st])
                        .map((st) => `${f.counts[st]} ${RISK_STATUS_LABEL[st].toLowerCase()}`)
                        .join(" · ")
                    : "No law or standard mapped yet"}
                </p>
              </div>
            </section>
          ))}
        </div>
        <section className="bx-panel" aria-labelledby="cp-gaps-h">
            <header className="bx-ph">
              <h2 id="cp-gaps-h">Not fully in place</h2>
              <span className="bx-psub">
                {gaps.length + 1}: {tracked} covered with more planned, the rest accepted, not applicable or not mapped
              </span>
              <span className="bx-psub" style={{ marginLeft: "auto" }}>
                <Out href={DOC_URL}>Threat model</Out>
              </span>
            </header>
            <div className="bx-gaps">
            {gaps.map(({ r, st }) => (
              <article key={r.id} className={`bx-gap is-${STATUS_TONE[st]}`}>
                <h3>
                  <span>
                    {r.id} {r.name}
                  </span>
                  <small>{RISK_STATUS_LABEL[st].toLowerCase()}</small>
                </h3>
                <p>{r.residual}</p>
                {st !== "not-applicable" ? (
                  <p>
                    <b>Tracking:</b> {r.tracking}
                  </p>
                ) : null}
              </article>
            ))}
            <article className="bx-gap is-none">
              <h3>
                <span>Regulation</span>
                <small>not mapped</small>
              </h3>
              <p>No law or standard is mapped in the repo yet. Relay's privacy spec (R5, #149) is written, ahead of the hub.</p>
            </article>
            </div>
          </section>
          <div className="bx-grid bx-folds is-4">
            <Panel id="cp-owasp" title="OWASP in place" sub={`${bars[0]!.inPlace} of ${OWASP_LLM.length}${tracked ? `, ${tracked} with more planned` : ""}`} tone="covered" open={open.has("cp-owasp")} onToggle={() => toggle("cp-owasp")}>
              <CheckList checks={owasp} label="OWASP Top 10 for LLM Applications" />
              <About id="owasp" />
            </Panel>
            <Panel id="cp-nist" title="NIST AI RMF" sub={`${NIST_AI_RMF.length} functions mapped`} tone="covered" open={open.has("cp-nist")} onToggle={() => toggle("cp-nist")}>
              <CheckList checks={nist} label="NIST AI RMF" />
              <About id="nist" />
            </Panel>
            <Panel id="cp-saif" title="Google SAIF" sub={`${SAIF.length} core elements mapped`} tone="covered" open={open.has("cp-saif")} onToggle={() => toggle("cp-saif")}>
              <CheckList checks={saif} label="Google SAIF" />
              <About id="saif" />
            </Panel>
            <Panel id="cp-law" title="Regulation" sub="not mapped yet" tone="none" open={open.has("cp-law")} onToggle={() => toggle("cp-law")}>
              <Facts e={FRAME_EXPLAIN.regulation} />
            </Panel>
          </div>
      </BoilerFrame>
    </div>
  );
}
