import "@fontsource-variable/newsreader/wght.css";
import "@fontsource-variable/newsreader/wght-italic.css";
import "@fontsource-variable/inter/wght.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { Desk } from "./desk/Desk.tsx";
import { loadLattice, useRoute } from "./route.ts";

/** The 3D Lattice is its own download: nothing from it (three.js, models, the simulator) loads on the Desk. */
const Lattice = lazy(() => loadLattice().then((m) => ({ default: m.App })));

function Root() {
  const route = useRoute();
  if (route === "lattice") {
    return (
      <Suspense fallback={<div className="desk-boot" />}>
        <Lattice />
      </Suspense>
    );
  }
  return <Desk route={route} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
