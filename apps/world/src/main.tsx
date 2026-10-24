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
import { StrictMode, Suspense, lazy, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { Desk } from "./desk/Desk.tsx";
import { loadLattice, useRoute } from "./route.ts";
import { installSiteGate } from "./siteGate.ts";

/** The 3D Lattice is its own download: nothing from it (three.js, models, the simulator) loads on the Desk. */
const Lattice = lazy(() => loadLattice().then((m) => ({ default: m.App })));
/** The portrait studio (/portrait-studio; /studio is the Desk's Studio page now): one agent posed alone, for scripts/portraits.mjs. Its own download too. */
const Studio = lazy(() => import("./studio/Studio.tsx").then((m) => ({ default: m.Studio })));
const STUDIO = window.location.pathname.startsWith("/portrait-studio");

/**
 * Once entered, the Lattice stays (#327): back on the Desk it is only hidden, its canvas stops drawing altogether
 * (App.tsx, `shown`) and its HUD and directors unmount, so entering it again is instant instead of another load.
 */
const HIDDEN: CSSProperties = { visibility: "hidden", pointerEvents: "none", position: "fixed", inset: 0, zIndex: -1 };

function Root() {
  const route = useRoute();
  const inLattice = route === "lattice";
  const [entered, setEntered] = useState(inLattice);
  if (inLattice && !entered) setEntered(true);
  if (STUDIO) {
    return (
      <Suspense fallback={null}>
        <Studio />
      </Suspense>
    );
  }
  return (
    <>
      {!inLattice && <Desk route={route} />}
      {entered && (
        <Suspense fallback={inLattice ? <div className="desk-boot" /> : null}>
          <div className="lattice-keep" style={inLattice ? undefined : HIDDEN} aria-hidden={!inLattice} inert={!inLattice}>
            <Lattice shown={inLattice} />
          </div>
        </Suspense>
      )}
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
