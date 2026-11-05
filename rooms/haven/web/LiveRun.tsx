import { useEffect, useRef, useState } from "react";
import { renderUrl } from "./plates.ts";
import { LIVE_POLL_MS, pointsOf, ride, runsPath, useLiveMap, type LiveMap } from "./liveRun.ts";
import "./liverun.css";

/**
 * The run, live (#814, B2 Live run): the vacuum's own map with the rooms it was sent to numbered in cleaning order,
 * the robot's top-down render riding the path it reports, turned to its heading, the cleaned lanes filling in gold
 * behind it, the rooms still to come dotted, and each room's share done. Between readings the robot is eased along
 * the new stretch of path, so it glides rather than jumps. Drawn from the private map: passkey only, never stored.
 */

const ROBOT = 7;

export function LiveRun({ map, battery }: { map: LiveMap; battery?: number | null }) {
  const pts = pointsOf(map.path);
  const prev = useRef<[number, number][]>([]);
  const [t, setT] = useState(1);
  const from = useRef<[number, number][]>([]);
  // A new reading: ride from what was drawn to it over about one poll's time.
  useEffect(() => {
    from.current = prev.current;
    prev.current = pts;
    if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setT(1);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const dur = LIVE_POLL_MS * 0.9;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / dur);
      setT(k);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);
  const { path, at, heading } = ride(from.current, pts, map.robot, t);
  const d = path.length ? `M${path.map((p) => p.join(" ")).join("L")}` : "";
  const fs = Math.max(map.w, map.h) / 34;
  const sent = map.rooms.filter((r) => r.order !== null).sort((a, b) => a.order! - b.order!);
  const now = map.rooms.find((r) => r.state === "now");
  return (
    <div className="hv-live">
      <svg viewBox={`0 0 ${map.w} ${map.h}`} role="img" aria-label={now ? `The vacuum is cleaning ${now.name}${now.pct !== null ? `, ${now.pct}% done` : ""}` : "The vacuum's run"}>
        <defs>
          <pattern id="hv-live-q" width={fs * 0.6} height={fs * 0.6} patternUnits="userSpaceOnUse">
            <circle cx={fs * 0.15} cy={fs * 0.15} r={fs * 0.05} className="hv-liveDot" />
          </pattern>
          <radialGradient id="hv-live-halo">
            <stop offset="0" stopColor="rgb(240,201,135)" stopOpacity=".35" />
            <stop offset="1" stopColor="rgb(240,201,135)" stopOpacity="0" />
          </radialGradient>
          <clipPath id="hv-live-bot">
            <circle r={ROBOT * 0.62} />
          </clipPath>
        </defs>
        {map.rooms.map((r) => (
          <g key={r.segment} className={`hv-liveRoom is-${r.state}`}>
            <path d={runsPath(r.runs)} />
            {r.state === "next" && <path d={runsPath(r.runs)} fill="url(#hv-live-q)" />}
          </g>
        ))}
        <path className="hv-liveWall" d={runsPath(map.walls)} />
        {d && (
          <>
            <path className="hv-liveLane" d={d} strokeWidth={ROBOT} />
            <path className="hv-liveLine" d={d} strokeWidth={Math.max(0.35, ROBOT / 18)} />
          </>
        )}
        {map.rooms.map((r) =>
          r.state === "off" ? (
            <text key={r.segment} className="hv-liveName is-off" x={r.cx} y={r.cy} style={{ fontSize: fs * 0.8 }}>
              {r.name}
            </text>
          ) : (
            <g key={r.segment} className={`hv-liveLabel is-${r.state}`} transform={`translate(${r.cx} ${r.cy})`}>
              {r.order !== null && (
                <g transform={`translate(0 ${-fs * 1.5})`}>
                  <circle r={fs * 0.62} className="hv-liveOrder" />
                  <text className="hv-liveOrderN" y={fs * 0.3} style={{ fontSize: fs * 0.85 }}>
                    {r.order}
                  </text>
                </g>
              )}
              <text className="hv-liveName" style={{ fontSize: fs }}>
                {r.name}
              </text>
              <text className="hv-livePct" y={fs * 1.15} style={{ fontSize: fs * 0.52 }}>
                {r.state === "done" ? "DONE" : r.state === "now" ? (r.pct !== null ? `${r.pct}% · NOW` : "NOW") : r.pct ? `NEXT · ${r.pct}%` : "NEXT"}
              </text>
            </g>
          ),
        )}
        {map.charger && (
          <g className="hv-liveDock" transform={`translate(${map.charger.x} ${map.charger.y})`}>
            <path d={`M${-fs * 0.5} ${fs * 0.28} a${fs * 0.5} ${fs * 0.5} 0 0 1 ${fs} 0 z`} />
            <text y={fs * 1.2} style={{ fontSize: fs * 0.45 }}>
              DOCK
            </text>
          </g>
        )}
        {at && (
          <>
            <circle className="hv-liveHalo" cx={at[0]} cy={at[1]} r={ROBOT * 2} fill="url(#hv-live-halo)" />
            <g className="hv-liveBot" transform={`translate(${at[0]} ${at[1]}) rotate(${(heading ?? -90) + 90})`}>
              <image href={renderUrl("vactop")} x={-ROBOT * 0.66} y={-ROBOT * 0.66} width={ROBOT * 1.32} height={ROBOT * 1.32} clipPath="url(#hv-live-bot)" />
              <circle r={ROBOT * 0.62} className="hv-liveBotRing" strokeWidth={ROBOT / 22} />
            </g>
          </>
        )}
      </svg>
      <dl className="hv-liveSide">
        <div>
          <dt>Room</dt>
          <dd>{now ? (now.order !== null ? `${now.order} of ${sent.length} · ${now.name}` : now.name) : "between rooms"}</dd>
        </div>
        {now?.pct !== null && now?.pct !== undefined && (
          <div>
            <dt>Done</dt>
            <dd>{now.pct}%</dd>
          </div>
        )}
        {typeof battery === "number" && (
          <div>
            <dt>Battery</dt>
            <dd>{battery}%</dd>
          </div>
        )}
        {!map.robot && (
          <div>
            <dt>Position</dt>
            <dd>not in this reading</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/**
 * The Hall's live run (#814): mounted only while the vacuum is out, it polls the private map and draws the run; it
 * shows nothing at all until a real map has come back, and unmounts (stopping the poll) when the run ends.
 */
export function HallLive({ device, battery }: { device: string; battery?: number | null }) {
  const read = useLiveMap(device, true);
  if (read?.kind !== "map") return null;
  return (
    <section className="hv-liveCard" aria-label="The vacuum's run, live">
      <h3 className="hv-liveTitle">The run, live</h3>
      <LiveRun map={read.map} battery={battery} />
    </section>
  );
}
