import type { RoleId } from "./types.js";

export interface Profession {
  role: RoleId;
  name: string;
  frameworks: string[];
  checks: string;
  why: string;
}

/** The five professions the copilot carries, in workflow order. */
export const PROFESSIONS: Profession[] = [
  {
    role: "ba",
    name: "Business analyst",
    frameworks: ["ISO/IEC/IEEE 29148 requirement quality"],
    checks: "What the app does against what was agreed in the PRD and specs",
    why: "Reads what was agreed and what the code does",
  },
  {
    role: "architect",
    name: "Architect",
    frameworks: ["Operations and failure recovery"],
    checks: "How the app runs, recovers and settles payments",
    why: "Payments must settle even when a step breaks",
  },
  {
    role: "qa",
    name: "QA",
    frameworks: ["Failure paths"],
    checks: "Every step that can fail, repeat or be reversed",
    why: "Refunds, retries and double clicks are failure paths",
  },
  {
    role: "compliance",
    name: "Security and compliance",
    frameworks: ["NDPA 2023", "Card handling"],
    checks: "Personal data, consent and card data",
    why: "The app collects personal data and takes cards",
  },
  {
    role: "po",
    name: "Product owner",
    frameworks: ["Acceptance and sign off"],
    checks: "Whether the change is ready to accept",
    why: "Someone has to sign for what ships",
  },
];
