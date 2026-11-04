import { usePathname } from "../route.ts";
import { ControlsPage } from "./boiler/ControlsPage.tsx";
import { CompliancePage } from "./security/CompliancePage.tsx";
import { SecurityPage } from "./security/SecurityPage.tsx";
import { Systems } from "./Systems.tsx";
import { systemsPageOf } from "./SystemsNav.tsx";
import "./security/sx.css";
import "./boiler/boiler.css";

/**
 * Systems as the Desk's admin hub (#82): the systems themselves (Systems.tsx), Controls (usage, budgets, switches,
 * connections, keys and phones, #647), Security (the threat model, live scan
 * results and the eval suite) and Compliance (the frameworks the threat model maps to). The sub-navigation and the
 * addresses are in SystemsNav.tsx.
 */

export function SystemsHub({ now }: { now: number }) {
  const page = systemsPageOf(usePathname());
  return page === "controls" ? <ControlsPage now={now} /> : page === "security" ? <SecurityPage now={now} /> : page === "compliance" ? <CompliancePage /> : <Systems now={now} />;
}
