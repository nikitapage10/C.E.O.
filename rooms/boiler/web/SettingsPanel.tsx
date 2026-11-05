import { useState } from "react";
import { HideButton } from "@ceo/engine/web/Private.tsx";
import { useDeskAuth } from "@ceo/engine/web/signin.ts";
import { handsFreeSupported } from "../../../apps/desk/src/roomvoice/roomVoice.ts";
import { HandsFree } from "../../../apps/desk/src/roomvoice/RoomMic.tsx";
import { PlanWatch } from "../../../apps/desk/src/skippy/PlanWatch.tsx";
import { Ephemeris, IlyrReadout, useRuns } from "../../today/web/TodayRail.tsx";
import { useNow } from "@ceo/engine/sigils/motion.tsx";

/**
 * Boiler Room > Controls > Settings (#666): what used to sit in the Desk's bar and on Today, moved here when Today
 * became the Iris (Nikita, 2026-11-04: "any settings or anything like that should be in the boiler room"). Hide (and
 * Shift+H), Hands-free (the bar still shows it while it listens, with a tap to stop), Ilyr's clock, the voice plan's
 * warning line, and what the crew runs next. The month's usage is the Meters circuit above. Signed out, the switches
 * that need a passkey say so.
 */
export function SettingsPanel() {
  const signedIn = useDeskAuth((s) => s.auth.status === "in");
  const now = useNow(30_000);
  const { now: tick, runs } = useRuns(15_000);
  const [hotRun, setHotRun] = useState<string | null>(null);
  return (
    <div className="ct-set">
      <ul className="ct-set-l">
        <li>
          <div>
            <b>Hide</b>
            <p>Veils every personal value on the Desk, for showing it to someone. Shift+H anywhere does the same.</p>
          </div>
          <HideButton />
        </li>
        <li>
          <div>
            <b>Hands-free</b>
            <p>Keeps listening page to page, each thing said going to the page's lead. While it listens, the bar says who for, with a tap to stop.</p>
          </div>
          {signedIn && handsFreeSupported() ? <HandsFree /> : <small className="ct-note">{signedIn ? "This browser can't listen." : "Sign in to switch it."}</small>}
        </li>
        <li>
          <div>
            <b>Usage</b>
            <p>The month's meters are circuit A above: the Claude Code plan, the Claude API, Skippy, voice and Relay.</p>
            <PlanWatch className="plan-watch--bx" />
          </div>
          <a className="ct-btn is-quiet" href="#ct-meters" onClick={(e) => (e.preventDefault(), document.getElementById("ct-meters")?.scrollIntoView({ block: "start" }))}>
            To the meters
          </a>
        </li>
      </ul>
      <div className="ct-set-side">
        <section aria-label="Ilyr's clock">
          <p className="ct-sub">Ilyr's clock</p>
          <IlyrReadout now={now} />
        </section>
        <div>
          <Ephemeris runs={runs.slice(0, 5)} now={tick} hotRun={hotRun} onHotRun={setHotRun} />
        </div>
      </div>
    </div>
  );
}
