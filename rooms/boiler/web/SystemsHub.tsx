import { usePathname } from "../../../apps/world/src/route.ts";
import { ControlsPage } from "./ControlsPage.tsx";
import { CompliancePage } from "./CompliancePage.tsx";
import { SecurityPage } from "./SecurityPage.tsx";
import { TokenomicsPage } from "./TokenomicsPage.tsx";
import { Systems } from "./Systems.tsx";
import { systemsPageOf } from "./SystemsNav.tsx";
import "./sx.css";
import "./boiler.css";

/**
 * Systems as the Desk's admin hub (#82): the systems themselves (Systems.tsx), Controls (usage, budgets, switches,
 * connections, keys and phones, #647), Security (the threat model, live scan
 * results and the eval suite), Compliance (the frameworks the threat model maps to) and Tokenomics (#1142: what the AI
 * calls cost, by provider, feature and model, from the usage ledger). The sub-navigation and the
 * addresses are in SystemsNav.tsx.
 */

export function SystemsHub({ now }: { now: number }) {
  const page = systemsPageOf(usePathname());
  return page === "controls" ? <ControlsPage now={now} /> : page === "security" ? <SecurityPage now={now} /> : page === "compliance" ? <CompliancePage /> : page === "tokenomics" ? <TokenomicsPage now={now} /> : <Systems now={now} />;
}
