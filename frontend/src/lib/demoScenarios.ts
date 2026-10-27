/**
 * The five RC demo scenarios (guided demo).
 *
 * `id` is the backend's offline demo case id (what the audience sees).
 * `fixtureCaseId` is B's local fixture for the same canonical case — used only
 * in mock mode, where the backend demo ids do not exist. The pairing is
 * explicit so nothing is silently substituted in the http demo.
 */

import type { MessageKey } from "../i18n";

export type DemoDataSource = "OFFLINE_REPLAY" | "SIMULATED_COMPOSITE";

export interface DemoScenario {
  id: string;
  fixtureCaseId: string;
  number: string;
  titleKey: MessageKey;
  caseTypeKey: MessageKey;
  dataSource: DemoDataSource;
  mainProblemKey: MessageKey;
  aiRecommendationKey: MessageKey;
  expectedActionKey: MessageKey;
  demonstratesKey: MessageKey;
  /** Observable evidence that the scenario actually demonstrated its claim. */
  proofKey: MessageKey;
  tone: "pass" | "warn" | "stop";
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "DEMO-INR-O7",
    fixtureCaseId: "O7",
    number: "01",
    titleKey: "guide.s1.title",
    caseTypeKey: "guide.s1.caseType",
    dataSource: "OFFLINE_REPLAY",
    mainProblemKey: "guide.s1.problem",
    aiRecommendationKey: "guide.s1.ai",
    expectedActionKey: "guide.s1.action",
    demonstratesKey: "guide.s1.demo",
    proofKey: "guide.s1.proof",
    tone: "pass",
  },
  {
    id: "DEMO-SNAD-O13",
    fixtureCaseId: "O13",
    number: "02",
    titleKey: "guide.s2.title",
    caseTypeKey: "guide.s2.caseType",
    dataSource: "OFFLINE_REPLAY",
    mainProblemKey: "guide.s2.problem",
    aiRecommendationKey: "guide.s2.ai",
    expectedActionKey: "guide.s2.action",
    demonstratesKey: "guide.s2.demo",
    proofKey: "guide.s2.proof",
    tone: "warn",
  },
  {
    id: "DEMO-BLOCK-O9",
    fixtureCaseId: "O14",
    number: "03",
    titleKey: "guide.s3.title",
    caseTypeKey: "guide.s3.caseType",
    dataSource: "OFFLINE_REPLAY",
    mainProblemKey: "guide.s3.problem",
    aiRecommendationKey: "guide.s3.ai",
    expectedActionKey: "guide.s3.action",
    demonstratesKey: "guide.s3.demo",
    proofKey: "guide.s3.proof",
    tone: "stop",
  },
  {
    id: "CAP-DEMO-9001",
    fixtureCaseId: "CAP-DEMO-9001",
    number: "04",
    titleKey: "guide.s4.title",
    caseTypeKey: "guide.s4.caseType",
    dataSource: "SIMULATED_COMPOSITE",
    mainProblemKey: "guide.s4.problem",
    aiRecommendationKey: "guide.s4.ai",
    expectedActionKey: "guide.s4.action",
    demonstratesKey: "guide.s4.demo",
    proofKey: "guide.s4.proof",
    tone: "warn",
  },
  {
    id: "DEMO-BILL-O16",
    fixtureCaseId: "O16",
    number: "05",
    titleKey: "guide.s5.title",
    caseTypeKey: "guide.s5.caseType",
    dataSource: "OFFLINE_REPLAY",
    mainProblemKey: "guide.s5.problem",
    aiRecommendationKey: "guide.s5.ai",
    expectedActionKey: "guide.s5.action",
    demonstratesKey: "guide.s5.demo",
    proofKey: "guide.s5.proof",
    tone: "warn",
  },
];

/** http mode uses the backend demo id; mock mode opens the paired local fixture. */
export const demoCaseIdFor = (
  scenario: DemoScenario,
  mode: "mock" | "http",
): string => (mode === "mock" ? scenario.fixtureCaseId : scenario.id);

export const isSyntheticScenario = (scenario: DemoScenario): boolean =>
  scenario.dataSource === "SIMULATED_COMPOSITE";
