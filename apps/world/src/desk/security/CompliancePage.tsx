import { useMemo, useRef } from "react";
import { SystemsNav } from "../SystemsNav.tsx";
import { useViz, type VizSpec } from "../wvCanvas.ts";
import { ringSpec } from "./secViz.ts";
import { NIST_AI_RMF, OWASP_LLM, RISK_STATUS_LABEL, ROADMAP, SAIF, owaspTally, partsOf, refsOf, statusOf, type RiskStatus } from "./model.ts";
import { PopScope } from "../Popovers.tsx";
import { FRAME_EXPLAIN, NIST_EXPLAIN, OWASP_EXPLAIN, SAIF_EXPLAIN, type Explain, type FrameId } from "./explain.ts";
import { DOC_URL, ExplainInline, Out, Rich, RiskPill, useExplain } from "./parts.tsx";

/**
 * Systems > Compliance (#82), in the approved Weave (desk-concepts round five): each framework docs/THREAT-MODEL.md
 * maps C.E.O. to (OWASP Top 10 for LLM Applications, the NIST AI RMF and Google SAIF) as a ring, one strand per
 * control, bright when it's in place; then every risk as a bar, and each control word for word from the doc. Nothing
 * here is mapped that the doc doesn't map; what isn't mapped yet says so.
 */

const ORDER: RiskStatus[] = ["covered", "tracked", "open", "accepted", "not-applicable"];

/** How bright a risk's strand is: covered fully, covered with more planned, accepted, open, not used. */
const STRENGTH: Record<RiskStatus, number> = { covered: 1, tracked: 0.75, accepted: 0.5, open: 0.2, "not-applicable": 0 };
const STATUS_C: Record<RiskStatus, string> = { covered: "var(--wv-ok)", tracked: "var(--rc-relay)", accepted: "var(--rc-spire)", open: "var(--wv-bad)", "not-applicable": "var(--wv-faint)" };

export function CompliancePage() {
  const tally = owaspTally();
  const covered = tally.covered + tally.tracked;
  const owasp = useMemo(() => ringSpec(OWASP_LLM.map((r) => STRENGTH[statusOf(r.controls, r.tracking)]), "exchange"), []);
  const nist = useMemo(() => ringSpec(NIST_AI_RMF.map(() => 1), "relay"), []);
  const saif = useMemo(() => ringSpec(SAIF.map(() => 1), "archive"), []);
  return (
    <div className="sec-page wv-page wv-comp rm-boiler">
      <SystemsNav />
      <header className="wv-pghead">
        <p className="wv-eyb">Frameworks and controls</p>
        <h1 className="wv-h1 desk__title">
          Three frameworks, <em>{covered === OWASP_LLM.length ? "woven in." : "mostly woven in."}</em>
        </h1>
        <p className="wv-sub">How C.E.O. maps to the frameworks people trust for AI systems, word for word from the threat model. Each ring is one framework; each strand a control, bright when it's in place.</p>
      </header>

      <PopScope prefix="comp">
        <div className="wv-fw-row">
          <FwRing id="owasp" spec={owasp} big={String(covered)} of={`of ${OWASP_LLM.length}`} what="covered">
            {ORDER.filter((st) => tally[st])
              .map((st) => `${tally[st]} ${RISK_STATUS_LABEL[st].toLowerCase()}`)
              .join(", ")}
            .
          </FwRing>
          <FwRing id="nist" spec={nist} big={String(NIST_AI_RMF.length)} of={`of ${NIST_AI_RMF.length}`} what="functions mapped">
            {NIST_AI_RMF.map((n) => n.fn).join(", ")}, mapped at the function level; categories not yet.
          </FwRing>
          <FwRing id="saif" spec={saif} big={String(SAIF.length)} of={`of ${SAIF.length}`} what="core elements mapped">
            Every core element mapped to something C.E.O. already does, from the supply chain to the risks in context.
          </FwRing>
        </div>
        <p className="wv-note">No law or standard is mapped in the repo yet. Relay's privacy spec (R5, #149) is written, ahead of the hub.</p>

        <section className="wv-panel wv-ctl">
          <div className="wv-sechead">
            <div>
              <p className="wv-eyb">OWASP Top 10 for LLM Applications (2025)</p>
              <h2 className="wv-h2">Where the strands are</h2>
            </div>
            <Out href={DOC_URL}>Threat model</Out>
          </div>
          <ul className="wv-score-l is-wide">
            {OWASP_LLM.map((r) => {
              const st = statusOf(r.controls, r.tracking);
              return (
                <li key={r.id} className={st === "not-applicable" ? "is-z" : undefined} style={{ "--v": STRENGTH[st], "--c": STATUS_C[st] } as React.CSSProperties}>
                  <b>
                    {r.id} {r.name}
                  </b>
                  <i aria-hidden="true" />
                  <em>{RISK_STATUS_LABEL[st]}</em>
                </li>
              );
            })}
          </ul>
          <details className="wv-more-d">
            <summary>Every risk, control by control</summary>
            <ul className="owasp">
              {OWASP_LLM.map((r) => (
                <Risk key={r.id} risk={r} />
              ))}
            </ul>
          </details>
        </section>

        <div className="wv-sec2 wv-comp2">
          <section className="wv-panel">
            <div className="wv-sechead">
              <div>
                <p className="wv-eyb">NIST AI RMF</p>
                <h2 className="wv-h2">Govern, Map, Measure, Manage</h2>
              </div>
            </div>
            <ul className="fnlist">
              {NIST_AI_RMF.map((n) => (
                <Fn key={n.fn} id={`nist-${n.fn}`} name={n.fn} kicker="NIST AI RMF function" e={NIST_EXPLAIN[n.fn]} inCeo={n.inCeo} />
              ))}
            </ul>
          </section>
          <section className="wv-panel">
            <div className="wv-sechead">
              <div>
                <p className="wv-eyb">Google SAIF</p>
                <h2 className="wv-h2">Six core elements</h2>
              </div>
            </div>
            <ul className="fnlist">
              {SAIF.map((x, i) => (
                <Fn key={x.element} id={`saif-${i + 1}`} name={x.element} kicker="SAIF core element" e={SAIF_EXPLAIN[x.element]!} inCeo={x.inCeo} long />
              ))}
            </ul>
          </section>
        </div>
      </PopScope>
    </div>
  );
}

function FwRing({ id, spec, big, of, what, children }: { id: FrameId; spec: VizSpec; big: string; of: string; what: string; children: React.ReactNode }) {
  const cv = useRef<HTMLCanvasElement>(null);
  useViz(cv, spec);
  const pop = useExplain(`frame-${id}`, FRAME_TITLE[id], FRAME_EXPLAIN[id], { kicker: "Framework" });
  return (
    <section className={`wv-fw has-pop ${pop.open ? "is-open" : ""}`} tabIndex={0} {...pop.anchor}>
      {pop.card}
      <div className="wv-fw-ring">
        <canvas ref={cv} className="wv-cv" aria-hidden="true" />
        <p>
          <b>
            {big}
            <small>{of}</small>
          </b>
          <span>{what}</span>
        </p>
      </div>
      <h2 className="wv-h3">{FRAME_TITLE[id]}</h2>
      <p className="wv-note">{children}</p>
    </section>
  );
}

const FRAME_TITLE: Record<FrameId, string> = {
  owasp: "OWASP Top 10 for LLM Applications",
  nist: "NIST AI RMF",
  saif: "Google SAIF",
  regulation: "Regulation",
};

function Fn({ id, name, kicker, e, inCeo, long }: { id: string; name: string; kicker: string; e: Explain; inCeo: string; long?: boolean }) {
  const pop = useExplain(id, name, e, { kicker });
  return (
    <li className={`fn has-pop ${pop.open ? "is-open" : ""}`} tabIndex={0} {...pop.anchor}>
      {pop.card}
      <span className={`fn__name ${long ? "fn__name--long" : ""}`}>{name}</span>
      <ul className="chips">
        {partsOf(inCeo).map((p) => (
          <li key={p}>
            <Rich text={p} />
          </li>
        ))}
      </ul>
    </li>
  );
}

function Risk({ risk }: { risk: (typeof OWASP_LLM)[number] }) {
  const status = statusOf(risk.controls, risk.tracking);
  const controls = status === "not-applicable" ? [] : partsOf(risk.controls);
  const refs = refsOf(risk.tracking);
  const road = refs
    .filter((x) => x.startsWith("R"))
    .map((id) => ROADMAP.find((r) => r.id === id))
    .filter((r) => !!r);
  const e = OWASP_EXPLAIN[risk.id]!;
  const pop = useExplain(`risk-${risk.id}`, risk.name, e, {
    kicker: `OWASP ${risk.id}`,
    pin: false,
  });
  return (
    <li className={`risk risk--${status}`}>
      <details>
        <summary className={`has-pop ${pop.open ? "is-open" : ""}`} {...pop.anchor}>
          <span className="risk__id">{risk.id}</span>
          <span className="risk__name">{risk.name}</span>
          <RiskPill status={status} />
          <span className="risk__count">{controls.length ? `${controls.length} control${controls.length === 1 ? "" : "s"}` : "Not used"}</span>
        </summary>
        {pop.card}
        <ExplainInline e={e} />
        <dl className="risk__facts">
          <div>
            <dt>Where it applies</dt>
            <dd>{risk.where}</dd>
          </div>
          {controls.length > 0 && (
            <div>
              <dt>Controls in place</dt>
              <dd>
                <ul className="chips">
                  {controls.map((c) => (
                    <li key={c}>
                      <Rich text={c} />
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          <div>
            <dt>What's left</dt>
            <dd>{risk.residual}</dd>
          </div>
          <div>
            <dt>Tracking</dt>
            <dd>
              {risk.tracking}
              {road.map((r) => (
                <span key={r.id} className="risk__road">
                  {r.id}: {r.item.split(/[:(]/)[0]!.trim()} · {r.status}
                </span>
              ))}
            </dd>
          </div>
        </dl>
      </details>
    </li>
  );
}
