import { createContext } from "react";

/** The week the meal planner shows (its start date), for the Shop step's DoorDash tab to remember a store by (#1195). */
export const ShopWeek = createContext<string | null>(null);
