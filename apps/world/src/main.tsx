import "@fontsource/cormorant-garamond/300.css";
import "@fontsource/cormorant-garamond/400.css";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/400-italic.css";
import "@fontsource-variable/inter/wght.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { Desk } from "./desk/Desk.tsx";
import { loadLattice, useRoute } from "./route.ts";
import { installSiteGate } from "./siteGate.ts";

/** The 3D Lattice is its own download: nothing from it (three.js, models, the simulator) loads on the Desk. */
const Lattice = lazy(() => loadLattice().then((m) => ({ default: m.App })));
/** The portrait studio (/studio): one agent posed alone, for scripts/portraits.mjs. Its own download too. */
const Studio = lazy(() => import("./studio/Studio.tsx").then((m) => ({ default: m.Studio })));
const STUDIO = window.location.pathname.startsWith("/studio");

function Root() {
  const route = useRoute();
  if (STUDIO) {
    return (
      <Suspense fallback={null}>
        <Studio />
      </Suspense>
    );
  }
  if (route === "lattice") {
    return (
      <Suspense fallback={<div className="desk-boot" />}>
        <Lattice />
      </Suspense>
    );
  }
  return <Desk route={route} />;
}

// The site lock (#236, #238): an API call that finds this browser signed out of the site goes to the login page.
installSiteGate();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
