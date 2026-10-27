import type { AIAnalysis, EvidenceGap, EvidenceRequirement } from "../types";

/**
 * Fixture-authored AI analyses.
 *
 * There is no model call in this build. `provenance: SCENARIO_DEFINED` is
 * deliberate: the panel must not present fixture text as live inference.
 */

const req = (
  evidenceType: string,
  status: EvidenceRequirement["status"] = "OPEN",
): EvidenceRequirement => ({
  evidenceType,
  sourceExpected: "REQUESTED_FROM_SELLER",
  status,
});

const gap = (
  caseId: string,
  index: number,
  severity: EvidenceGap["severity"],
  title: string,
  detail: string,
  requestedType: string,
  remedy: string,
): EvidenceGap => ({
  gapId: `G-${caseId}-${index}`,
  severity,
  title,
  detail,
  requestedType,
  remedy,
});

const analysis = (
  seed: Omit<AIAnalysis, "modelLabel" | "promptLabel" | "provenance" | "status"> & {
    status?: AIAnalysis["status"];
  },
): AIAnalysis => ({
  modelLabel: "analysis-fixture-v1",
  promptLabel: "case-understanding@0.3",
  provenance: "SCENARIO_DEFINED",
  status: "READY",
  ...seed,
});

export const analysisFixtures: AIAnalysis[] = [
  analysis({
    analysisId: "AN-O4",
    caseId: "O4",
    generatedAt: "2026-10-15T03:10:00Z",
    summary:
      "INR for a simulated order. PayPal requested proof of fulfillment; no truthful fulfillment record exists by scenario design. The only legal, requirement-backed move was to open documented contact with the buyer.",
    requirements: [req("PROOF_OF_FULFILLMENT", "OPEN")],
    facts: [
      {
        factId: "F-O4-1",
        statement: "Buyer reports the simulated item was never received.",
        grounding: "VERIFIED_OBSERVATION",
        evidenceIds: ["E-O4-01"],
        basis: "Buyer message recorded in the frozen dispute fixture.",
      },
      {
        factId: "F-O4-2",
        statement: "A 15.00 USD capture exists and is held under BUYER_COMPLAINT.",
        grounding: "VERIFIED_OBSERVATION",
        evidenceIds: ["E-O4-02"],
        basis: "Frozen PayPal GET response (E1).",
      },
      {
        factId: "F-O4-3",
        statement: "PayPal requested PROOF_OF_FULFILLMENT from the seller.",
        grounding: "VERIFIED_OBSERVATION",
        evidenceIds: ["E-O4-02"],
        basis: "Dispute evidence requirement, observed at 11:02 UTC.",
      },
      {
        factId: "F-O4-4",
        statement: "No proof of fulfillment exists in the merchant's records.",
        grounding: "MISSING",
        evidenceIds: ["E-O4-03"],
        basis: "Scenario design: no shipment was ever created.",
      },
      {
        factId: "F-O4-5",
        statement: "There was no prior seller-buyer contact before the dispute.",
        grounding: "VERIFIED_OBSERVATION",
        evidenceIds: ["E-O4-01"],
        basis: "merchant_contacted = false in the dispute fixture.",
      },
    ],
    gaps: [
      gap(
        "O4",
        1,
        "HIGH",
        "Proof of fulfillment",
        "The open requirement cannot be met truthfully. Any attachment must be labelled as test material.",
        "PROOF_OF_FULFILLMENT",
        "Do not fabricate tracking. Use documented contact, or a clearly labelled test artifact.",
      ),
      gap(
        "O4",
        2,
        "MEDIUM",
        "Seller-buyer communication record",
        "No contact history exists; the first message becomes part of the record.",
        "COMMUNICATION",
        "send-message can create the first documented contact.",
      ),
    ],
    contradictions: [],
    recommendation: {
      action: "send-message",
      actionLabel: "Send message to buyer",
      strength: "STRONG",
      rationale: [
        "The requirement is open, but no truthful fulfillment artifact exists.",
        "send_message is live in the observed capability snapshot.",
        "A factual message is the lowest-risk action that advances the case.",
      ],
      alternatives: [
        { action: "provide-evidence", label: "Provide evidence", note: "Only with clearly labelled test material." },
        { action: "make-offer", label: "Make offer", note: "Conceding path; bounded by 15.00 USD." },
        { action: "wait", label: "Wait", note: "Correct once the link set collapses after a write." },
      ],
    },
    waitRule: {
      applies: false,
      reason: "A legal, requirement-backed action exists in the current snapshot.",
    },
  }),

  analysis({
    analysisId: "AN-O5",
    caseId: "O5",
    generatedAt: "2026-10-15T07:50:00Z",
    summary:
      "INR with a simulated fulfillment record available. PayPal requested proof of fulfillment and the evidence window was open, so a clearly labelled note was the appropriate response.",
    requirements: [req("PROOF_OF_FULFILLMENT", "SATISFIED")],
    facts: [
      {
        factId: "F-O5-1",
        statement: "Buyer reports non-receipt of a 16.00 USD simulated order.",
        grounding: "VERIFIED_OBSERVATION",
        evidenceIds: ["E-O5-01"],
        basis: "Frozen sandbox dispute fixture.",
      },
      {
        factId: "F-O5-2",
        statement: "Capture of 16.00 USD is COMPLETED and held.",
        grounding: "VERIFIED_OBSERVATION",
        evidenceIds: ["E-O5-02"],
        basis: "Frozen PayPal GET response (E1).",
      },
      {
        factId: "F-O5-3",
        statement: "A simulated fulfillment note was prepared as test material.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O5-03"],
        basis: "Merchant upload; explicitly labelled sandbox test material.",
      },
    ],
    gaps: [
      gap(
        "O5",
        1,
        "HIGH",
        "Real logistics records",
        "No real carrier record exists. The submitted note must not imply otherwise.",
        "PROOF_OF_FULFILLMENT",
        "Keep the SCENARIO_DEFINED label on the attachment.",
      ),
    ],
    contradictions: [],
    recommendation: {
      action: "provide-evidence",
      actionLabel: "Provide evidence",
      strength: "STRONG",
      rationale: [
        "The open requirement matches the available simulated note.",
        "provide_evidence was present with method POST before the write.",
        "Content states its own simulated nature (V8).",
      ],
      alternatives: [
        { action: "send-message", label: "Send message", note: "Complementary contact." },
        { action: "wait", label: "Wait", note: "Not recommended while the window is open." },
      ],
    },
    waitRule: { applies: false, reason: "Evidence window open at decision time." },
  }),

  analysis({
    analysisId: "AN-O6",
    caseId: "O6",
    generatedAt: "2026-10-17T02:20:00Z",
    summary:
      "SNAD where the buyer reports a different model. The merchant has no tracking and no photos. Evidence cannot carry the claim yet, so the defensible step is to request photos and model identifiers before discussing any refund.",
    requirements: [req("OTHER")],
    facts: [
      {
        factId: "F-O6-1",
        statement: "Buyer states the delivered earbuds are a different model than the listing.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O6-01"],
        basis: "Scenario filing text.",
      },
      {
        factId: "F-O6-2",
        statement: "A 17.00 USD capture exists for the order.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O6-02"],
        basis: "Sandbox transaction fixture.",
      },
      {
        factId: "F-O6-3",
        statement: "No tracking number is on file; the shipment was untracked by design.",
        grounding: "MISSING",
        evidenceIds: ["E-O6-03"],
        basis: "No carrier record exists.",
      },
      {
        factId: "F-O6-4",
        statement: "No photos of the received item are on file.",
        grounding: "MISSING",
        evidenceIds: ["E-O6-04"],
        basis: "No attachments were submitted.",
      },
    ],
    gaps: [
      gap("O6", 1, "HIGH", "Photos of the received item", "Without photos, the mismatch claim is statement-only.", "BUYER_PHOTOS", "Request photos in the next message."),
      gap("O6", 2, "HIGH", "Tracking number", "Untracked shipment leaves no delivery evidence.", "SHIPPING_TRACKING", "State the shipping method honestly; do not invent a carrier."),
    ],
    contradictions: [
      {
        contradictionId: "C-O6-1",
        title: "Delivery asserted, delivery record absent",
        detail:
          "The claim describes an item that arrived, but the merchant has no tracking or delivery confirmation on file.",
        evidenceIds: ["E-O6-01", "E-O6-03"],
      },
    ],
    recommendation: {
      action: "send-message",
      actionLabel: "Send message to buyer",
      strength: "CONDITIONAL",
      rationale: [
        "A delivery is asserted, but no delivery record exists on the merchant side.",
        "Photos and model identifiers are needed before any offer is defensible.",
        "send_message is available in the current capability snapshot.",
      ],
      alternatives: [
        { action: "provide-evidence", label: "Provide evidence", note: "Blocked until a truthful artifact exists." },
        { action: "wait", label: "Wait", note: "Permitted, but delays evidence collection." },
      ],
    },
    waitRule: { applies: false, reason: "A legal action exists and the evidence window is open." },
  }),

  analysis({
    analysisId: "AN-O7",
    caseId: "O7",
    generatedAt: "2026-10-16T09:10:00Z",
    summary:
      "Clean INR with no shipment record. The honest strategy is a factual message; there is nothing to submit against the fulfillment requirement.",
    requirements: [req("PROOF_OF_FULFILLMENT")],
    facts: [
      {
        factId: "F-O7-1",
        statement: "Buyer reports non-receipt of a 19.00 USD speaker.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O7-01"],
        basis: "Scenario filing text.",
      },
      {
        factId: "F-O7-2",
        statement: "Order and capture records exist for 19.00 USD.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O7-02"],
        basis: "Sandbox transaction fixture.",
      },
      {
        factId: "F-O7-3",
        statement: "No shipment record exists.",
        grounding: "MISSING",
        evidenceIds: ["E-O7-03"],
        basis: "No fulfillment was created by design.",
      },
    ],
    gaps: [
      gap("O7", 1, "HIGH", "Proof of fulfillment", "No shipment exists, so the requirement stays open.", "PROOF_OF_FULFILLMENT", "Do not submit fabricated tracking."),
    ],
    contradictions: [],
    recommendation: {
      action: "send-message",
      actionLabel: "Send message to buyer",
      strength: "STRONG",
      rationale: [
        "No truthful evidence can satisfy the open requirement.",
        "Documented contact is the lowest-risk next step.",
      ],
      alternatives: [
        { action: "provide-evidence", label: "Provide evidence", note: "No truthful artifact available." },
        { action: "make-offer", label: "Make offer", note: "Conceding path." },
      ],
    },
    waitRule: { applies: false, reason: "A legal action exists." },
  }),

  analysis({
    analysisId: "AN-O8",
    caseId: "O8",
    generatedAt: "2026-10-17T00:55:00Z",
    summary:
      "INR with an unresolved contradiction: the buyer cites a seller message saying the parcel was on its way, but the merchant cannot produce that message or any shipment record. Contact must not confirm a shipment the merchant cannot evidence.",
    requirements: [req("PROOF_OF_FULFILLMENT")],
    facts: [
      {
        factId: "F-O8-1",
        statement: "Buyer states the merchant said the parcel was on its way.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O8-01"],
        basis: "Scenario filing text, buyer-side account only.",
      },
      {
        factId: "F-O8-2",
        statement: "No copy of that seller message exists in the merchant's records.",
        grounding: "MISSING",
        evidenceIds: ["E-O8-03"],
        basis: "Merchant records searched; nothing on file.",
      },
      {
        factId: "F-O8-3",
        statement: "No shipment record or tracking number exists.",
        grounding: "MISSING",
        evidenceIds: ["E-O8-02"],
        basis: "No fulfillment was created by design.",
      },
      {
        factId: "F-O8-4",
        statement: "A 19.50 USD capture exists.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O8-02"],
        basis: "Sandbox transaction fixture.",
      },
    ],
    gaps: [
      gap("O8", 1, "HIGH", "Shipment record", "The claim of dispatch is unevidenced.", "PROOF_OF_FULFILLMENT", "State only what the records show."),
      gap("O8", 2, "MEDIUM", "Seller message record", "The buyer cites a message the merchant cannot produce.", "COMMUNICATION", "Search the contact log before replying."),
    ],
    contradictions: [
      {
        contradictionId: "C-O8-1",
        title: "Buyer cites a message with no merchant copy",
        detail:
          "The buyer's account references a dispatch update. No message, carrier, or tracking record exists on the merchant side.",
        evidenceIds: ["E-O8-01", "E-O8-03"],
      },
    ],
    recommendation: {
      action: "send-message",
      actionLabel: "Send message to buyer",
      strength: "CONDITIONAL",
      rationale: [
        "A contradiction must be resolved before any admission or offer.",
        "The message must not confirm a dispatch the merchant cannot evidence.",
        "send_message is available in the current snapshot.",
      ],
      alternatives: [
        { action: "make-offer", label: "Make offer", note: "Premature while the contradiction is open." },
        { action: "wait", label: "Wait", note: "Legal, but leaves the contradiction unresolved." },
      ],
    },
    waitRule: { applies: false, reason: "A legal action exists." },
  }),

  analysis({
    analysisId: "AN-O9",
    caseId: "O9",
    generatedAt: "2026-10-16T08:00:00Z",
    summary:
      "INR with no prior contact and no shipment record. A first documented contact is the only defensible step.",
    requirements: [req("PROOF_OF_FULFILLMENT")],
    facts: [
      {
        factId: "F-O9-1",
        statement: "Buyer reports non-receipt of a 21.00 USD charger.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O9-01"],
        basis: "Scenario filing text.",
      },
      {
        factId: "F-O9-2",
        statement: "A 21.00 USD capture exists.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O9-02"],
        basis: "Sandbox transaction fixture.",
      },
      {
        factId: "F-O9-3",
        statement: "No shipment record exists.",
        grounding: "MISSING",
        evidenceIds: ["E-O9-03"],
        basis: "No fulfillment was created.",
      },
    ],
    gaps: [
      gap("O9", 1, "HIGH", "Proof of fulfillment", "No shipment exists.", "PROOF_OF_FULFILLMENT", "Do not fabricate tracking."),
      gap("O9", 2, "MEDIUM", "Prior contact", "No seller-buyer contact on file.", "COMMUNICATION", "First message becomes the record."),
    ],
    contradictions: [],
    recommendation: {
      action: "send-message",
      actionLabel: "Send message to buyer",
      strength: "STRONG",
      rationale: ["No evidence exists to submit.", "Documented contact is legal and useful."],
      alternatives: [{ action: "wait", label: "Wait", note: "Permitted but passive." }],
    },
    waitRule: { applies: false, reason: "A legal action exists." },
  }),

  analysis({
    analysisId: "AN-O10",
    caseId: "O10",
    generatedAt: "2026-10-17T02:52:00Z",
    summary:
      "INR for 22.00 USD. PayPal requested proof of fulfillment and the evidence window is open. Only a clearly labelled simulated fulfillment note exists — no carrier record. The legal action is to submit that note, not to invent tracking.",
    requirements: [req("PROOF_OF_FULFILLMENT", "OPEN")],
    facts: [
      {
        factId: "F-O10-1",
        statement: "Buyer filed an INR claim for 22.00 USD on 16 Oct 2026.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O10-01"],
        basis: "Scenario filing record in the offline fixture.",
      },
      {
        factId: "F-O10-2",
        statement: "A completed 22.00 USD capture exists for the order.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O10-02"],
        basis: "Sandbox transaction fixture (amount scenario-defined).",
      },
      {
        factId: "F-O10-3",
        statement: "The expected delivery window has passed.",
        grounding: "AI_INFERENCE",
        evidenceIds: ["E-O10-05", "E-O10-01"],
        basis: "Derived from the filing text and the case age; no carrier data involved.",
      },
      {
        factId: "F-O10-4",
        statement: "No carrier tracking or delivery confirmation is on file.",
        grounding: "MISSING",
        evidenceIds: ["E-O10-04"],
        basis: "No logistics record exists and none will be generated.",
      },
      {
        factId: "F-O10-5",
        statement: "A simulated fulfillment note is available and states its own test nature.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O10-03"],
        basis: "Merchant-side artifact prepared in this workspace.",
      },
    ],
    gaps: [
      gap(
        "O10",
        1,
        "HIGH",
        "Real proof of fulfillment",
        "The only available artifact is a simulated note. It cannot establish a real shipment.",
        "PROOF_OF_FULFILLMENT",
        "Submit the labelled note, or keep the requirement open and communicate honestly.",
      ),
      gap(
        "O10",
        2,
        "MEDIUM",
        "Carrier tracking",
        "No tracking number exists. Fabricating one is prohibited by the evidence policy.",
        "SHIPPING_TRACKING",
        "State that no tracking is available rather than inventing a carrier.",
      ),
    ],
    contradictions: [],
    recommendation: {
      action: "provide-evidence",
      actionLabel: "Provide evidence (notes branch)",
      strength: "STRONG",
      rationale: [
        "PayPal requested PROOF_OF_FULFILLMENT and the evidence window is open.",
        "provide_evidence is present with method POST in the 17 Oct capability snapshot.",
        "The only truthful artifact is a note that labels itself as simulated.",
      ],
      alternatives: [
        { action: "send-message", label: "Send message", note: "Complementary; opens documented contact." },
        { action: "make-offer", label: "Make offer", note: "Conceding path, bounded by 22.00 USD." },
        { action: "wait", label: "Wait", note: "Becomes correct if the link set collapses after a write." },
      ],
    },
    waitRule: {
      applies: false,
      reason: "A legal, requirement-backed action exists in the current snapshot.",
    },
  }),

  analysis({
    analysisId: "AN-O11",
    caseId: "O11",
    generatedAt: "2026-10-16T05:05:00Z",
    summary:
      "INR with a simulated fulfillment note. Evidence was submitted once and confirmed by a GET re-query; the case is now under review.",
    requirements: [req("PROOF_OF_FULFILLMENT", "SATISFIED")],
    facts: [
      {
        factId: "F-O11-1",
        statement: "Buyer reports non-receipt of a 23.00 USD fitness band.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O11-01"],
        basis: "Scenario filing text.",
      },
      {
        factId: "F-O11-2",
        statement: "A 23.00 USD capture exists.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O11-02"],
        basis: "Sandbox transaction fixture.",
      },
      {
        factId: "F-O11-3",
        statement: "A labelled simulated fulfillment note was submitted.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O11-03"],
        basis: "Submission confirmed by GET re-query.",
      },
    ],
    gaps: [
      gap("O11", 1, "MEDIUM", "Real logistics records", "Evidence is simulated by design.", "PROOF_OF_FULFILLMENT", "Keep the label visible."),
    ],
    contradictions: [],
    recommendation: {
      action: "wait",
      actionLabel: "Wait for buyer response",
      strength: "STRONG",
      rationale: [
        "Evidence was submitted and verified.",
        "The remaining path is buyer review; a second write adds no value.",
      ],
      alternatives: [{ action: "send-message", label: "Send message", note: "Only if the buyer asks for detail." }],
    },
    waitRule: {
      applies: true,
      reason: "No further legal action improves the position after a verified write.",
    },
  }),

  analysis({
    analysisId: "AN-O12",
    caseId: "O12",
    generatedAt: "2026-10-16T10:55:00Z",
    summary:
      "INR with evidence ready to submit, but the capability snapshot is older than the freshness window. The recommendation cannot be validated until the snapshot is refreshed.",
    requirements: [req("PROOF_OF_FULFILLMENT", "OPEN")],
    facts: [
      {
        factId: "F-O12-1",
        statement: "Buyer reports non-receipt of a 24.00 USD desk lamp.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O12-01"],
        basis: "Scenario filing text.",
      },
      {
        factId: "F-O12-2",
        statement: "A 24.00 USD capture exists.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O12-02"],
        basis: "Sandbox transaction fixture.",
      },
      {
        factId: "F-O12-3",
        statement: "A simulated fulfillment note is prepared.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O12-03"],
        basis: "Merchant-side artifact.",
      },
    ],
    gaps: [
      gap("O12", 1, "HIGH", "Freshness", "The capability snapshot is 55 minutes old; the validator window is 30 minutes.", "SNAPSHOT", "Refresh the case snapshot before approval."),
    ],
    contradictions: [],
    recommendation: {
      action: "provide-evidence",
      actionLabel: "Provide evidence (requires fresh snapshot)",
      strength: "CONDITIONAL",
      rationale: [
        "The evidence requirement is open and an artifact exists.",
        "The snapshot is stale, so availability cannot be asserted.",
      ],
      alternatives: [{ action: "wait", label: "Wait", note: "Refresh first, then re-plan." }],
    },
    waitRule: { applies: false, reason: "An action would be legal after a refresh." },
  }),

  analysis({
    analysisId: "AN-O13",
    caseId: "O13",
    generatedAt: "2026-10-16T09:55:00Z",
    summary:
      "SNAD wrong-size claim with no tracking and no photos. Statement-only evidence cannot support a mismatch assertion.",
    requirements: [req("OTHER")],
    facts: [
      {
        factId: "F-O13-1",
        statement: "Buyer states the bed sheet set is the wrong size versus the listing.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O13-01"],
        basis: "Scenario filing text.",
      },
      {
        factId: "F-O13-2",
        statement: "A 13.00 USD capture exists.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O13-02"],
        basis: "Sandbox transaction fixture.",
      },
      {
        factId: "F-O13-3",
        statement: "No photos of the delivered item are on file.",
        grounding: "MISSING",
        evidenceIds: ["E-O13-03"],
        basis: "No attachments were submitted.",
      },
    ],
    gaps: [
      gap("O13", 1, "HIGH", "Photos", "Statement-only mismatch claim.", "BUYER_PHOTOS", "Request photos before any offer."),
      gap("O13", 2, "MEDIUM", "Tracking", "Untracked shipment.", "SHIPPING_TRACKING", "State the shipping method honestly."),
    ],
    contradictions: [],
    recommendation: {
      action: "send-message",
      actionLabel: "Send message to buyer",
      strength: "CONDITIONAL",
      rationale: ["The mismatch claim needs visual evidence.", "Message is available now."],
      alternatives: [{ action: "provide-evidence", label: "Provide evidence", note: "No artifact available." }],
    },
    waitRule: { applies: false, reason: "A legal action exists." },
  }),

  analysis({
    analysisId: "AN-O14",
    caseId: "O14",
    generatedAt: "2026-10-17T00:45:00Z",
    summary:
      "SNAD wrong colour/size. The planned action was to submit photos, but no photos exist. The validator blocks the payload because there is no truthful attachment; the case needs evidence collection first.",
    requirements: [req("OTHER", "OPEN")],
    facts: [
      {
        factId: "F-O14-1",
        statement: "Buyer states the delivered sleeve differs in colour and size from the listing.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O14-01"],
        basis: "Scenario filing text.",
      },
      {
        factId: "F-O14-2",
        statement: "A 14.00 USD capture exists.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O14-02"],
        basis: "Sandbox transaction fixture.",
      },
      {
        factId: "F-O14-3",
        statement: "No photos of the delivered sleeve are on file.",
        grounding: "MISSING",
        evidenceIds: ["E-O14-03"],
        basis: "No attachments were submitted.",
      },
      {
        factId: "F-O14-4",
        statement: "The shipment was untracked, so no delivery record exists.",
        grounding: "MISSING",
        evidenceIds: ["E-O14-04"],
        basis: "Scenario design.",
      },
    ],
    gaps: [
      gap("O14", 1, "HIGH", "Photos of the delivered item", "Without a photo there is no truthful content for a provide-evidence payload.", "BUYER_PHOTOS", "Request photos from the buyer first."),
      gap("O14", 2, "HIGH", "Tracking", "No delivery record exists.", "SHIPPING_TRACKING", "Do not invent a carrier."),
    ],
    contradictions: [],
    recommendation: {
      action: "provide-evidence",
      actionLabel: "Provide evidence (photos)",
      strength: "WEAK",
      rationale: [
        "The requirement is OTHER and the evidence window is open.",
        "The only candidate artifact is missing, so the payload cannot be assembled truthfully.",
      ],
      alternatives: [
        { action: "send-message", label: "Request photos first", note: "Unblocks a later provide-evidence attempt." },
        { action: "wait", label: "Wait", note: "Permitted while evidence is collected." },
      ],
    },
    waitRule: {
      applies: false,
      reason: "An action is legal, but the payload is not supportable — blocked, not silent.",
    },
  }),

  analysis({
    analysisId: "AN-O15",
    caseId: "O15",
    generatedAt: "2026-10-16T09:40:00Z",
    summary:
      "SNAD damage claim with no photos and no tracking. Contact is the only defensible step until the buyer provides visual evidence.",
    requirements: [req("OTHER")],
    facts: [
      {
        factId: "F-O15-1",
        statement: "Buyer states the ceramic mug set arrived damaged.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O15-01"],
        basis: "Scenario filing text.",
      },
      {
        factId: "F-O15-2",
        statement: "An 11.00 USD capture exists.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O15-02"],
        basis: "Sandbox transaction fixture.",
      },
      {
        factId: "F-O15-3",
        statement: "No damage photos are on file.",
        grounding: "MISSING",
        evidenceIds: ["E-O15-03"],
        basis: "No attachments were submitted.",
      },
    ],
    gaps: [
      gap("O15", 1, "HIGH", "Damage photos", "Condition-based claims need visual evidence.", "BUYER_PHOTOS", "Request photos."),
    ],
    contradictions: [],
    recommendation: {
      action: "send-message",
      actionLabel: "Send message to buyer",
      strength: "CONDITIONAL",
      rationale: ["A damage claim needs photos.", "Message is available."],
      alternatives: [{ action: "wait", label: "Wait", note: "Legal but passive." }],
    },
    waitRule: { applies: false, reason: "A legal action exists." },
  }),

  analysis({
    analysisId: "AN-O16",
    caseId: "O16",
    generatedAt: "2026-10-17T01:30:00Z",
    summary:
      "Billing duplicate-charge claim backed by two buyer-cited receipts. The merchant has no refund record. The earlier proposed message was rejected because it implied an admission before reconciliation.",
    requirements: [req("PROOF_OF_REFUND")],
    facts: [
      {
        factId: "F-O16-1",
        statement: "Buyer reports two charges of 18.00 USD for one annual subscription.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O16-01"],
        basis: "Scenario filing text.",
      },
      {
        factId: "F-O16-2",
        statement: "The buyer cites two receipts; no document is attached.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O16-02"],
        basis: "Statement-level reference only.",
      },
      {
        factId: "F-O16-3",
        statement: "No merchant refund record exists.",
        grounding: "MISSING",
        evidenceIds: ["E-O16-03"],
        basis: "No refund was issued.",
      },
    ],
    gaps: [
      gap("O16", 1, "HIGH", "Merchant billing reconciliation", "The duplicate has not been reconciled against the merchant ledger.", "PROOF_OF_REFUND", "Reconcile before contacting the buyer."),
      gap("O16", 2, "MEDIUM", "Receipt documents", "Receipts are buyer-cited, not attached.", "BUYER_RECEIPT", "Request the documents."),
    ],
    contradictions: [],
    recommendation: {
      action: "send-message",
      actionLabel: "Request receipt documents",
      strength: "CONDITIONAL",
      rationale: [
        "Two independent anchors point to a duplicate charge.",
        "The merchant ledger has not been reconciled.",
        "Contact should request documents without admitting liability.",
      ],
      alternatives: [
        { action: "provide-evidence", label: "Provide evidence", note: "No refund record exists." },
        { action: "make-offer", label: "Make offer", note: "Only after reconciliation." },
      ],
    },
    waitRule: { applies: false, reason: "A legal action exists." },
  }),

  analysis({
    analysisId: "AN-O17",
    caseId: "O17",
    generatedAt: "2026-10-16T12:10:00Z",
    summary:
      "Billing claim for a post-cancellation charge. The case is in CHARGEBACK and the capability snapshot exposes no send_message link, so the otherwise sensible reply action is unavailable.",
    requirements: [req("PROOF_OF_REFUND")],
    facts: [
      {
        factId: "F-O17-1",
        statement: "Buyer states the membership was cancelled before renewal.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O17-01", "E-O17-02"],
        basis: "Scenario filing text plus buyer-cited confirmation.",
      },
      {
        factId: "F-O17-2",
        statement: "A 9.00 USD post-cancellation charge is reported.",
        grounding: "SCENARIO_DEFINED",
        evidenceIds: ["E-O17-01"],
        basis: "Scenario filing text.",
      },
      {
        factId: "F-O17-3",
        statement: "No billing-stop record explains why the renewal proceeded.",
        grounding: "MISSING",
        evidenceIds: ["E-O17-03"],
        basis: "No merchant record on file.",
      },
    ],
    gaps: [
      gap("O17", 1, "HIGH", "Billing-stop record", "The merchant cannot explain the renewal.", "BILLING_STOP_RECORD", "Search the billing log before responding."),
      gap("O17", 2, "HIGH", "Action availability", "send_message is absent from the CHARGEBACK link set.", "HATEOAS", "Use an available action or wait for the next snapshot."),
    ],
    contradictions: [],
    recommendation: {
      action: "send-message",
      actionLabel: "Send message to buyer",
      strength: "STRONG",
      rationale: [
        "The buyer's account is internally consistent.",
        "Documented contact would normally be the right first step.",
        "The current snapshot has no send_message link — legality is decided by the validator, not by the recommendation.",
      ],
      alternatives: [
        { action: "provide-evidence", label: "Provide evidence", note: "Only if a truthful billing record exists." },
        { action: "wait", label: "Wait", note: "Correct when no legal action exists." },
      ],
    },
    waitRule: {
      applies: true,
      reason: "No alternative action is both legal and useful in the CHARGEBACK snapshot.",
    },
  }),

  analysis({
    analysisId: "AN-O18",
    caseId: "O18",
    generatedAt: "2026-10-16T10:20:00Z",
    status: "NOT_STARTED",
    summary:
      "No analysis has been run for this case. Run the analysis to extract facts, gaps, and a policy-checked recommendation.",
    requirements: [req("PROOF_OF_REFUND")],
    facts: [],
    gaps: [],
    contradictions: [],
    recommendation: {
      action: "wait",
      actionLabel: "Not analysed",
      strength: "WEAK",
      rationale: ["Analysis has not been run."],
      alternatives: [],
    },
    waitRule: { applies: false, reason: "No decision has been made." },
  }),
];

export const analysisByCase = (caseId: string): AIAnalysis | undefined =>
  analysisFixtures.find((item) => item.caseId === caseId);
