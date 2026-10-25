import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../wv.css";
import { fan, useFlow, type FlowField, type FlowLayoutFn } from "./index.ts";

/**
 * The flow kit on its own, for the browser test (tests/e2e/flow.spec.ts, #428): one field fanning a line out to three,
 * served by the dev server only (the build has no entry for it). Not a demo page; no data of any kind.
 */

type Hook = { field?: FlowField; unmount?: () => void };
const hook = window as unknown as { __flow: Hook };
hook.__flow = {};

function Field() {
  const layout = useCallback<FlowLayoutFn>(
    ({ W, H }) => ({
      lines: fan([40, H / 2], [[W - 40, H * 0.2], [W - 40, H * 0.5], [W - 40, H * 0.8]]).map((path, i) => ({ id: `l${i}`, path, density: 0.6, rate: 40 + i * 30, waiting: i === 2 })),
    }),
    [],
  );
  const { cv, field, bind } = useFlow(layout, { ground: true });
  useEffect(() => {
    hook.__flow.field = field;
  }, [field]);
  return (
    <div className="wv-page fl-page">
      <section className="fl-stage" {...bind}>
        <canvas ref={cv} className="fl-cv" aria-hidden="true" />
        <p className="fl-eyb">
          <span>Flow</span>
          <i />
          harness
        </p>
      </section>
      <div style={{ height: "300vh" }} />
    </div>
  );
}

function App() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    hook.__flow.unmount = () => setOn(false);
  }, []);
  return <div className="desk">{on ? <Field /> : null}</div>;
}

createRoot(document.getElementById("root")!).render(<App />);
