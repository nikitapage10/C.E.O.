import { SystemsNav } from "../SystemsNav.tsx";
import { RoomBanner } from "../RoomBanner.tsx";
import { Avatar, Panel } from "../ui.tsx";
import { NIST_AI_RMF, OWASP_LLM, RISK_STATUS_LABEL, ROADMAP, SAIF, owaspTally, partsOf, refsOf, statusOf, type RiskStatus } from "./model.ts";
import { DOC_URL, Out, Rich, RiskPill } from "./parts.tsx";

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

      <ul className="frames" aria-label="Frameworks">
        <li className="frame">
          <span className="frame__name">OWASP Top 10 for LLM Applications</span>
          <span className="frame__big">10/10</span>
          <span className="frame__sub">risks mapped, 2025 edition</span>
          <span className="frame__seg" role="img" aria-label={ORDER.filter((s) => tally[s]).map((s) => `${tally[s]} ${RISK_STATUS_LABEL[s].toLowerCase()}`).join(", ")}>
            {OWASP_LLM.map((r) => (
              <i key={r.id} className={`seg seg--${statusOf(r.controls, r.tracking)}`} title={`${r.id} ${r.name}: ${RISK_STATUS_LABEL[statusOf(r.controls, r.tracking)]}`} />
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
        </li>
        <li className="frame">
          <span className="frame__name">NIST AI RMF</span>
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
        </li>
        <li className="frame">
          <span className="frame__name">Google SAIF</span>
          <span className="frame__big">
            {SAIF.length}/{SAIF.length}
          </span>
          <span className="frame__sub">core elements mapped</span>
          <span className="frame__seg" aria-hidden="true">
            {SAIF.map((s) => (
              <i key={s.element} className="seg seg--covered" />
            ))}
          </span>
        </li>
        <li className="frame frame--off">
          <span className="frame__name">Regulation</span>
          <span className="frame__big">—</span>
          <span className="frame__sub">Not yet covered</span>
          <span className="frame__legend">No law or standard is mapped in the repo yet. Relay's privacy spec (R5) is planned before the hub is built.</span>
        </li>
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
              <li key={n.fn} className="fn">
                <span className="fn__name">{n.fn}</span>
                <ul className="chips">
                  {partsOf(n.inCeo).map((p) => (
                    <li key={p}>
                      <Rich text={p} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel eyebrow="Google SAIF" aside={<span className="panel__hint">Six core elements</span>} className="sec-panel">
          <ul className="fnlist">
            {SAIF.map((s) => (
              <li key={s.element} className="fn">
                <span className="fn__name fn__name--long">{s.element}</span>
                <ul className="chips">
                  {partsOf(s.inCeo).map((p) => (
                    <li key={p}>
                      <Rich text={p} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function Risk({ risk }: { risk: (typeof OWASP_LLM)[number] }) {
  const status = statusOf(risk.controls, risk.tracking);
  const controls = status === "not-applicable" ? [] : partsOf(risk.controls);
  const refs = refsOf(risk.tracking);
  const road = refs.filter((x) => x.startsWith("R")).map((id) => ROADMAP.find((r) => r.id === id)).filter((r) => !!r);
  return (
    <li className={`risk risk--${status}`}>
      <details>
        <summary>
          <span className="risk__id">{risk.id}</span>
          <span className="risk__name">{risk.name}</span>
          <RiskPill status={status} />
          <span className="risk__count">{controls.length ? `${controls.length} control${controls.length === 1 ? "" : "s"}` : "Not used"}</span>
        </summary>
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
