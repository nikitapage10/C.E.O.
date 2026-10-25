import "@fontsource-variable/bodoni-moda/opsz.css";
import "@fontsource-variable/bodoni-moda/opsz-italic.css";
import "@fontsource-variable/jost/wght.css";
import "./flow.css";

/**
 * The flow kit (#428): one particle-line language for every Desk page, taken from Today (Confluence). Import it from a
 * page that is itself lazy, so none of it lands in the Desk's first load. See README.md.
 */
export { useFlow, type UseFlowOpts } from "./useFlow.ts";
export { makeFlowField, type FlowBox, type FlowField, type FlowLayout, type FlowLayoutFn, type FlowLine, type FlowOpts, type PulseOpts } from "./field.ts";
export { converge, fan, polyOf, samplePath, type BranchOpts, type PathSpec, type Pt } from "./path.ts";
export { RiseField, safeTitle, type RiseLine } from "./rise.ts";
export { RC } from "../wvCanvas.ts";
