import { SystemsNav } from "../SystemsNav.tsx";
import { RoomBanner } from "../RoomBanner.tsx";
import { Avatar, Panel } from "../ui.tsx";
import { NIST_AI_RMF, OWASP_LLM, RISK_STATUS_LABEL, ROADMAP, SAIF, owaspTally, partsOf, refsOf, statusOf, type RiskStatus } from "./model.ts";
import { PopScope } from "../Popovers.tsx";
import { FRAME_EXPLAIN, NIST_EXPLAIN, OWASP_EXPLAIN, SAIF_EXPLAIN, type Explain, type FrameId } from "./explain.ts";
import { DOC_URL, ExplainInline, Out, Rich, RiskPill, useExplain } from "./parts.tsx";

/**
 * Systems > Compliance (#82): the frameworks docs/THREAT-MODEL.md maps C.E.O. to (OWASP Top 10 for LLM
 * Applications, the NIST AI RMF and Google SAIF), each control and its status, word for word from the doc. Nothing
 * here is mapped that the doc doesn't map; what isn't mapped yet says so.
 */

const ORDER: RiskStatus[] = ["covered", "tracked", "open", "accepted", "not-applicable"];

export function CompliancePage() {
  const tally = owaspTally();
  return (
    <div className="sec-page">
      <RoomBanner
        page="compliance"
        lead="The frameworks the threat model maps C.E.O. to, every control in place, and what's still open."
        aside={
          <div className="page-head__crew">
            <Avatar agent="Gary" room="boiler" />
            <span>From the threat model</span>
          </div>
        }
      />

      <SystemsNav />

      <PopScope prefix="comp">
        <ul className="frames" aria-label="Frameworks">
          <Frame id="owasp">
            <span className="frame__big">10/10</span>
            <span className="frame__sub">risks mapped, 2025 edition</span>
            <span
              className="frame__seg"
              role="img"
              aria-label={ORDER.filter((s) => tally[s])
                .map((s) => `${tally[s]} ${RISK_STATUS_LABEL[s].toLowerCase()}`)
                .join(", ")}
            >
              {OWASP_LLM.map((r) => (
                <i key={r.id} className={`seg seg--${statusOf(r.controls, r.tracking)}`} />
              ))}
            </span>
            <span className="frame__legend">
              {ORDER.filter((s) => tally[s]).map((s) => (
                <span key={s}>
                  <i className={`seg seg--${s}`} aria-hidden="true" />
                  {tally[s]} {RISK_STATUS_LABEL[s].toLowerCase()}
                </span>
              ))}
            </span>
          </Frame>
          <Frame id="nist">
            <span className="frame__big">
              {NIST_AI_RMF.length}/{NIST_AI_RMF.length}
            </span>
            <span className="frame__sub">functions mapped: {NIST_AI_RMF.map((n) => n.fn).join(", ")}</span>
            <span className="frame__seg" aria-hidden="true">
              {NIST_AI_RMF.map((n) => (
                <i key={n.fn} className="seg seg--covered" />
              ))}
            </span>
            <span className="frame__legend">Mapped at the function level; categories not yet</span>
          </Frame>
          <Frame id="saif">
            <span className="frame__big">
              {SAIF.length}/{SAIF.length}
            </span>
            <span className="frame__sub">core elements mapped</span>
            <span className="frame__seg" aria-hidden="true">
              {SAIF.map((s) => (
                <i key={s.element} className="seg seg--covered" />
              ))}
            </span>
          </Frame>
          <Frame id="regulation" off>
            <span className="frame__big">—</span>
            <span className="frame__sub">Not yet covered</span>
            <span className="frame__legend">No law or standard is mapped in the repo yet. Relay's privacy spec (R5, #149) is written, ahead of the hub.</span>
          </Frame>
        </ul>

        <Panel eyebrow="OWASP Top 10 for LLM Applications (2025)" aside={<Out href={DOC_URL}>Threat model</Out>} className="sec-panel">
          <ul className="owasp">
            {OWASP_LLM.map((r) => (
              <Risk key={r.id} risk={r} />
            ))}
          </ul>
        </Panel>

        <div className="sec-two">
          <Panel eyebrow="NIST AI RMF" aside={<span className="panel__hint">Govern · Map · Measure · Manage</span>} className="sec-panel">
            <ul className="fnlist">
              {NIST_AI_RMF.map((n) => (
                <Fn key={n.fn} id={`nist-${n.fn}`} name={n.fn} kicker="NIST AI RMF function" e={NIST_EXPLAIN[n.fn]} inCeo={n.inCeo} />
              ))}
            </ul>
          </Panel>
          <Panel eyebrow="Google SAIF" aside={<span className="panel__hint">Six core elements</span>} className="sec-panel">
            <ul className="fnlist">
              {SAIF.map((s, i) => (
                <Fn key={s.element} id={`saif-${i + 1}`} name={s.element} kicker="SAIF core element" e={SAIF_EXPLAIN[s.element]!} inCeo={s.inCeo} long />
              ))}
            </ul>
          </Panel>
        </div>
      </PopScope>
    </div>
  );
}

const FRAME_TITLE: Record<FrameId, string> = {
  owasp: "OWASP Top 10 for LLM Applications",
  nist: "NIST AI RMF",
  saif: "Google SAIF",
  regulation: "Regulation",
};

function Frame({ id, off, children }: { id: FrameId; off?: boolean; children: React.ReactNode }) {
  const pop = useExplain(`frame-${id}`, FRAME_TITLE[id], FRAME_EXPLAIN[id], {
    kicker: "Framework",
  });
  return (
    <li className={`frame ${off ? "frame--off" : ""} has-pop ${pop.open ? "is-open" : ""}`} tabIndex={0} {...pop.anchor}>
      {pop.card}
      <span className="frame__name">{FRAME_TITLE[id]}</span>
      {children}
    </li>
  );
}

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
