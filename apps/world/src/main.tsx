import "@fontsource/cormorant-garamond/300.css";
import "@fontsource/cormorant-garamond/400.css";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/400-italic.css";
import "@fontsource-variable/inter/wght.css";
import "@fontsource/cormorant-garamond/latin-600.css";
import "@fontsource/cormorant-garamond/latin-700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
// The Desk's running text (#336): IBM Plex Sans, beside the Lattice's Cormorant and Plex Mono.
import "@fontsource/ibm-plex-sans/latin-400.css";
import "@fontsource/ibm-plex-sans/latin-400-italic.css";
import "@fontsource/ibm-plex-sans/latin-500.css";
import "@fontsource/ibm-plex-sans/latin-600.css";
import { StrictMode, Suspense, lazy, useEffect, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Desk } from "./desk/Desk.tsx";
import { askedForLattice, keepLattice, startLetGo } from "./latticeWarm.ts";
import { lastMove, loadLattice, useRoute } from "./route.ts";
import { installSiteGate } from "./siteGate.ts";

/** The 3D Lattice is its own download: nothing from it (three.js, models, the simulator) loads on the Desk. */
const Lattice = lazy(() => loadLattice().then((m) => ({ default: m.App })));
/** The portrait studio (/portrait-studio; /studio is the Desk's Studio page now): one agent posed alone, for scripts/portraits.mjs. Its own download too. */
const Studio = lazy(() => import("./studio/Studio.tsx").then((m) => ({ default: m.Studio })));
const STUDIO = window.location.pathname.startsWith("/portrait-studio");

/** Hidden, behind the Desk: not drawn, never focused or clicked, but still sized, so its canvas keeps its size. */
const AWAY = { visibility: "hidden", pointerEvents: "none", position: "fixed", inset: 0, zIndex: -1 } as const;

function Root() {
  const route = useRoute();
  const onLattice = route === "lattice";
  // Once it has been on screen, the Lattice stays mounted behind the Desk,
  // paused, so going back to it is instant (#373). The Desk still comes and goes with its route, as before.
  const [seen, setSeen] = useState(onLattice);
  if (onLattice && !seen) setSeen(true);
  const mounted = onLattice || (seen && keepLattice());
  // Ten minutes back on the Desk and the kept Lattice is let go (#406); coming back sooner cancels it.
  useEffect(() => {
    if (onLattice || !seen) return;
    return startLetGo(() => setSeen(false));
  }, [onLattice, seen]);
  useLayoutEffect(() => {
    if (onLattice) askedForLattice(lastMove());
  }, [onLattice]);
  if (STUDIO) {
    return (
      <Suspense fallback={null}>
        <Studio />
      </Suspense>
    );
  }
  return (
    <>
      {mounted && (
        <div className="lattice-keep" style={onLattice ? undefined : AWAY} inert={!onLattice}>
          <Suspense fallback={onLattice ? <div className="desk-boot" /> : null}>
            <Lattice active={onLattice} />
          </Suspense>
        </div>
      )}
      {!onLattice && <Desk route={route} />}
    </>
  );
}

// The site lock (#236, #238): an API call that finds this browser signed out of the site goes to the login page.
installSiteGate();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
