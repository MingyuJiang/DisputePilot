import type { EvidenceRecord } from "../types";

/**
 * Evidence fixtures.
 *
 * Rule enforced by the UI: an evidence record either exists (and carries a
 * provenance label) or is explicitly MISSING / UNKNOWN. Missing items are never
 * rendered as verified facts.
 */

type EvidenceSeed = Omit<EvidenceRecord, "available"> & { available?: boolean };

const ev = (seed: EvidenceSeed): EvidenceRecord => ({
  available: seed.grounding !== "MISSING",
  ...seed,
});

const buyerStatement = (
  caseId: string,
  excerpt: string,
  provenance: EvidenceRecord["provenance"] = "SCENARIO_DEFINED",
  grounding: EvidenceRecord["grounding"] = "SCENARIO_DEFINED",
  supportedFactIds: string[] = [],
): EvidenceRecord =>
  ev({
    evidenceId: `E-${caseId}-01`,
    caseId,
    type: "BUYER_STATEMENT",
    typeLabel: "Buyer statement",
    source: "Dispute filing (offline fixture)",
    direction: "FROM_BUYER",
    grounding,
    provenance,
    excerpt,
    supportedFactIds,
    collectedAt: "2026-10-16T05:24:00Z",
    note: "Complaint text is scenario-defined test content, not a real consumer statement.",
  });

const orderRecord = (caseId: string, amount: string): EvidenceRecord =>
  ev({
    evidenceId: `E-${caseId}-02`,
    caseId,
    type: "TRANSACTION_RECORD",
    typeLabel: "Order & capture record",
    source: "Sandbox transaction fixture",
    direction: "FROM_PAYPAL",
    grounding: "SCENARIO_DEFINED",
    provenance: "SCENARIO_DEFINED",
    excerpt: `Order ${`ORD-DEMO-${caseId}`} · capture COMPLETED · ${amount} USD. Capture is held while the dispute is open.`,
    highlight: "capture COMPLETED",
    supportedFactIds: [`F-${caseId}-2`],
    collectedAt: "2026-10-16T05:25:00Z",
    note: "Identifier is a demo placeholder. Amount comes from the frozen case snapshot.",
  });

const missing = (
  caseId: string,
  index: number,
  type: string,
  typeLabel: string,
  requestedFrom: string,
  note: string,
  supportedFactIds: string[] = [],
): EvidenceRecord =>
  ev({
    evidenceId: `E-${caseId}-${String(index).padStart(2, "0")}`,
    caseId,
    type,
    typeLabel,
    source: requestedFrom,
    direction: "REQUESTED_FROM_SELLER",
    grounding: "MISSING",
    provenance: "SCENARIO_DEFINED",
    available: false,
    excerpt:
      "No record on file. The system will not display a placeholder value or infer content for a missing artifact.",
    supportedFactIds,
    collectedAt: "2026-10-16T05:25:00Z",
    note,
  });

export const evidenceFixtures: EvidenceRecord[] = [
  // ---------------------------------------------------------------- O4 (E1)
  ev({
    evidenceId: "E-O4-01",
    caseId: "O4",
    type: "BUYER_MESSAGE",
    typeLabel: "Buyer message (dispute thread)",
    source: "Frozen sandbox dispute fixture",
    direction: "FROM_BUYER",
    grounding: "VERIFIED_OBSERVATION",
    provenance: "HUMAN_OBSERVED_SANDBOX_UI",
    excerpt:
      "This is a simulated item-not-received scenario for testing a dispute resolution workflow in the PayPal Sandbox environment. The buyer has completed the test payment but has not received the simulated item and would like the seller to investigate and provide a resolution.",
    highlight: "has not received the simulated item",
    supportedFactIds: ["F-O4-1", "F-O4-5"],
    collectedAt: "2026-10-15T02:58:00Z",
    sha256: "b71d2f0c94a6…",
    note: "Recorded in the frozen dispute detail fixture (E1).",
  }),
  ev({
    evidenceId: "E-O4-02",
    caseId: "O4",
    type: "TRANSACTION_RECORD",
    typeLabel: "Order & capture record",
    source: "PayPal API — frozen GET response",
    direction: "FROM_PAYPAL",
    grounding: "VERIFIED_OBSERVATION",
    provenance: "PAYPAL_API_OBSERVED",
    excerpt:
      "Capture COMPLETED · 15.00 USD · capture status now PENDING under BUYER_COMPLAINT hold · dispute reference matches.",
    highlight: "15.00 USD",
    supportedFactIds: ["F-O4-2", "F-O4-3"],
    collectedAt: "2026-10-15T03:02:00Z",
    sha256: "f8432165157a…",
    note: "Source: frozen E1 trace; values verified by GET before the write.",
  }),
  missing(
    "O4",
    3,
    "PROOF_OF_FULFILLMENT",
    "Proof of fulfillment",
    "Requested from seller — never existed",
    "The scenario deliberately has no fulfilment record. Fabricating one is prohibited.",
    ["F-O4-4"],
  ),

  // ---------------------------------------------------------------- O5 (E1)
  ev({
    evidenceId: "E-O5-01",
    caseId: "O5",
    type: "BUYER_MESSAGE",
    typeLabel: "Buyer message (dispute thread)",
    source: "Frozen sandbox dispute fixture",
    direction: "FROM_BUYER",
    grounding: "VERIFIED_OBSERVATION",
    provenance: "HUMAN_OBSERVED_SANDBOX_UI",
    excerpt:
      "Simulated item-not-received case. The buyer completed a sandbox test payment of 16.00 USD and reports that the simulated item was never received.",
    highlight: "16.00 USD",
    supportedFactIds: ["F-O5-1"],
    collectedAt: "2026-10-15T07:40:00Z",
    sha256: "9c1a4d77b3e0…",
    note: "Recorded in the frozen dispute detail fixture (E1).",
  }),
  ev({
    evidenceId: "E-O5-02",
    caseId: "O5",
    type: "TRANSACTION_RECORD",
    typeLabel: "Order & capture record",
    source: "PayPal API — frozen GET response",
    direction: "FROM_PAYPAL",
    grounding: "VERIFIED_OBSERVATION",
    provenance: "PAYPAL_API_OBSERVED",
    excerpt: "Capture COMPLETED · 16.00 USD · held under BUYER_COMPLAINT.",
    highlight: "16.00 USD",
    supportedFactIds: ["F-O5-2"],
    collectedAt: "2026-10-15T07:42:00Z",
    sha256: "0ac93b5e7712…",
    note: "Source: frozen E1 trace.",
  }),
  ev({
    evidenceId: "E-O5-03",
    caseId: "O5",
    type: "FULFILLMENT_RECORD",
    typeLabel: "Simulated fulfillment record",
    source: "Merchant upload (SCENARIO_DEFINED note branch)",
    direction: "FROM_MERCHANT",
    grounding: "SCENARIO_DEFINED",
    provenance: "SCENARIO_DEFINED",
    excerpt:
      "Simulated fulfillment record for the S7 test item. Explicitly marked as sandbox test material; no real shipment exists.",
    highlight: "Explicitly marked as sandbox test material",
    supportedFactIds: ["F-O5-3"],
    collectedAt: "2026-10-15T08:05:00Z",
    sha256: "5de2c8117ab4…",
    note: "Submitted once, then confirmed present by a GET re-query.",
  }),

  // ---------------------------------------------------------------- O6
  buyerStatement("O6", "The item that arrived is a different model than the one shown in the listing and does not match the description of the purchased item.", "SCENARIO_DEFINED", "SCENARIO_DEFINED", ["F-O6-1"]),
  orderRecord("O6", "17.00"),
  missing("O6", 3, "SHIPPING_TRACKING", "Tracking number", "Requested from seller — shipped untracked by design", "No tracking number exists; the scenario ships untracked.", ["F-O6-3"]),
  missing("O6", 4, "BUYER_PHOTOS", "Photos of the received item", "Requested from buyer", "No photos were attached. The merchant cannot manufacture them.", ["F-O6-4"]),

  // ---------------------------------------------------------------- O7
  buyerStatement("O7", "The buyer paid 19.00 USD for a portable Bluetooth speaker and has not received the item.", "SCENARIO_DEFINED", "SCENARIO_DEFINED", ["F-O7-1"]),
  orderRecord("O7", "19.00"),
  missing("O7", 3, "PROOF_OF_FULFILLMENT", "Shipment record", "Requested from seller — none exists by design", "No shipment was created for this scenario.", ["F-O7-3"]),

  // ---------------------------------------------------------------- O8
  buyerStatement("O8", "The merchant replied that the parcel was on its way, but never provided a carrier name or tracking number, and nothing has arrived since.", "SCENARIO_DEFINED", "SCENARIO_DEFINED", ["F-O8-1"]),
  orderRecord("O8", "19.50"),
  missing("O8", 3, "SELLER_MESSAGE_RECORD", "Seller message cited by buyer", "Requested from merchant", "The buyer cites a message that the merchant's records cannot produce.", ["F-O8-2"]),

  // ---------------------------------------------------------------- O9
  buyerStatement("O9", "The buyer paid 21.00 USD for a USB-C fast charger and has not received the item. No prior contact exists.", "SCENARIO_DEFINED", "SCENARIO_DEFINED", ["F-O9-1"]),
  orderRecord("O9", "21.00"),
  missing("O9", 3, "PROOF_OF_FULFILLMENT", "Shipment record", "Requested from seller — none exists", "No shipment record in the merchant's books.", ["F-O9-3"]),

  // ---------------------------------------------------------------- O10
  buyerStatement("O10", "The buyer paid 22.00 USD to the merchant for a mechanical gaming keyboard and has not received the item. The expected delivery window has passed. The buyer requests a full refund of 22.00 USD.", "SCENARIO_DEFINED", "SCENARIO_DEFINED", ["F-O10-1", "F-O10-3"]),
  orderRecord("O10", "22.00"),
  ev({
    evidenceId: "E-O10-03",
    caseId: "O10",
    type: "FULFILLMENT_RECORD",
    typeLabel: "Simulated fulfillment record",
    source: "Merchant upload — prepared in this workspace",
    direction: "FROM_MERCHANT",
    grounding: "SCENARIO_DEFINED",
    provenance: "SCENARIO_DEFINED",
    excerpt:
      "SANDBOX TEST MATERIAL — no real shipment exists. Simulated fulfillment note for order ORD-DEMO-O10, prepared for the PayPal dispute workflow test. The parcel was handed to the simulated carrier on 14 Oct 2026; this record is not proof of a real delivery.",
    highlight: "no real shipment exists",
    supportedFactIds: ["F-O10-5"],
    collectedAt: "2026-10-17T02:48:00Z",
    sha256: "d41f7c2a9b63…",
    note: "This is the artifact that would be attached. It states its own simulated nature.",
  }),
  missing("O10", 4, "SHIPPING_TRACKING", "Carrier tracking / delivery confirmation", "Requested from seller", "No real logistics record exists. It will not be generated.", ["F-O10-4"]),
  ev({
    evidenceId: "E-O10-05",
    caseId: "O10",
    type: "DERIVED_SIGNAL",
    typeLabel: "Derived signal (not an observation)",
    source: "AI derivation from the filing record",
    direction: "FROM_PAYPAL",
    grounding: "AI_INFERENCE",
    provenance: "AI_INFERRED",
    excerpt:
      "The filing states the expected delivery window has passed; the case has been open for 21 hours. This inference does not establish when, or whether, the parcel was shipped.",
    highlight: "does not establish when, or whether, the parcel was shipped",
    supportedFactIds: ["F-O10-3"],
    collectedAt: "2026-10-17T02:50:00Z",
    note: "Derived, not observed. Never treated as proof of non-delivery.",
  }),
  ev({
    evidenceId: "E-O10-06",
    caseId: "O10",
    type: "MERCHANT_POLICY",
    typeLabel: "Merchant shipping policy",
    source: "Not provided",
    direction: "FROM_MERCHANT",
    grounding: "UNKNOWN",
    provenance: "SCENARIO_DEFINED",
    available: false,
    excerpt:
      "No merchant policy document is attached to this case. The system does not assume a delivery window or refund policy.",
    supportedFactIds: [],
    collectedAt: "2026-10-17T02:50:00Z",
    note: "Unknown is a distinct state from missing: nothing was ever requested.",
  }),

  // ---------------------------------------------------------------- O11
  buyerStatement("O11", "The buyer paid 23.00 USD for a smart fitness band and reports that it was not received.", "SCENARIO_DEFINED", "SCENARIO_DEFINED", ["F-O11-1"]),
  orderRecord("O11", "23.00"),
  ev({
    evidenceId: "E-O11-03",
    caseId: "O11",
    type: "FULFILLMENT_RECORD",
    typeLabel: "Simulated fulfillment record",
    source: "Merchant upload (SCENARIO_DEFINED note branch)",
    direction: "FROM_MERCHANT",
    grounding: "SCENARIO_DEFINED",
    provenance: "SCENARIO_DEFINED",
    excerpt: "SANDBOX TEST MATERIAL — simulated fulfillment note submitted for scenario O11.",
    highlight: "SANDBOX TEST MATERIAL",
    supportedFactIds: ["F-O11-3"],
    collectedAt: "2026-10-16T05:10:00Z",
    sha256: "a95e2d4470c1…",
    note: "Submission verified by a GET re-query in the replay fixture.",
  }),

  // ---------------------------------------------------------------- O12
  buyerStatement("O12", "The buyer paid 24.00 USD for a dimmable LED desk lamp and has not received the item.", "SCENARIO_DEFINED", "SCENARIO_DEFINED", ["F-O12-1"]),
  orderRecord("O12", "24.00"),
  ev({
    evidenceId: "E-O12-03",
    caseId: "O12",
    type: "FULFILLMENT_RECORD",
    typeLabel: "Simulated fulfillment record",
    source: "Merchant upload (SCENARIO_DEFINED note branch)",
    direction: "FROM_MERCHANT",
    grounding: "SCENARIO_DEFINED",
    provenance: "SCENARIO_DEFINED",
    excerpt: "SANDBOX TEST MATERIAL — simulated fulfillment note for scenario O12.",
    highlight: "SANDBOX TEST MATERIAL",
    supportedFactIds: ["F-O12-3"],
    collectedAt: "2026-10-16T10:40:00Z",
    note: "Evidence is ready; the capability snapshot is what expired.",
  }),

  // ---------------------------------------------------------------- O13
  buyerStatement("O13", "The delivered set is the wrong size versus the listing. The shipment was untracked and no buyer photos exist.", "SCENARIO_DEFINED", "SCENARIO_DEFINED", ["F-O13-1"]),
  orderRecord("O13", "13.00"),
  missing("O13", 3, "BUYER_PHOTOS", "Photos of the delivered item", "Requested from buyer", "No photos attached; none will be fabricated.", ["F-O13-3"]),

  // ---------------------------------------------------------------- O14
  buyerStatement("O14", "The sleeve that was delivered is a different color and size than shown in the listing and does not match the item description presented at purchase.", "SCENARIO_DEFINED", "SCENARIO_DEFINED", ["F-O14-1"]),
  orderRecord("O14", "14.00"),
  missing("O14", 3, "BUYER_PHOTOS", "Photos of the delivered sleeve", "Requested from buyer", "No photos exist. Without them there is no truthful attachment for a provide-evidence payload.", ["F-O14-3"]),
  missing("O14", 4, "SHIPPING_TRACKING", "Tracking number", "Requested from seller — untracked shipment", "The shipment was untracked by scenario design.", ["F-O14-4"]),

  // ---------------------------------------------------------------- O15
  buyerStatement("O15", "The set of four ceramic mugs arrived damaged. No damage photos exist and the shipment was untracked.", "SCENARIO_DEFINED", "SCENARIO_DEFINED", ["F-O15-1"]),
  orderRecord("O15", "11.00"),
  missing("O15", 3, "BUYER_PHOTOS", "Damage photos", "Requested from buyer", "Damage photos were never provided; none will be generated.", ["F-O15-3"]),

  // ---------------------------------------------------------------- O16
  buyerStatement("O16", "The same amount was charged twice for a single purchase. The buyer holds two payment receipts for one order. The duplicate second charge of 18.00 USD was never refunded.", "SCENARIO_DEFINED", "SCENARIO_DEFINED", ["F-O16-1", "F-O16-2"]),
  ev({
    evidenceId: "E-O16-02",
    caseId: "O16",
    type: "BUYER_RECEIPT",
    typeLabel: "Buyer receipt reference",
    source: "Buyer-provided reference (statement only)",
    direction: "FROM_BUYER",
    grounding: "SCENARIO_DEFINED",
    provenance: "SCENARIO_DEFINED",
    excerpt: "Buyer cites two receipts for one annual subscription purchase. The reference is a statement, not an uploaded document.",
    highlight: "two receipts for one annual subscription purchase",
    supportedFactIds: ["F-O16-2"],
    collectedAt: "2026-10-16T09:14:00Z",
    note: "Statement-level only: no document was attached to the case.",
  }),
  missing("O16", 3, "PROOF_OF_REFUND", "Merchant refund record", "Requested from merchant", "No refund was issued, so no refund record exists.", ["F-O16-3"]),

  // ---------------------------------------------------------------- O17
  buyerStatement("O17", "The buyer cancelled the membership before the renewal date and received a cancellation confirmation. The membership was billed again after the cancellation and the charge was not refunded.", "SCENARIO_DEFINED", "SCENARIO_DEFINED", ["F-O17-1", "F-O17-2"]),
  ev({
    evidenceId: "E-O17-02",
    caseId: "O17",
    type: "CANCELLATION_REFERENCE",
    typeLabel: "Cancellation confirmation (buyer-cited)",
    source: "Buyer statement",
    direction: "FROM_BUYER",
    grounding: "SCENARIO_DEFINED",
    provenance: "SCENARIO_DEFINED",
    excerpt: "Buyer states a cancellation confirmation was received before the renewal date. The confirmation itself is not attached.",
    highlight: "before the renewal date",
    supportedFactIds: ["F-O17-1"],
    collectedAt: "2026-10-14T03:05:00Z",
    note: "Buyer-cited reference; not independently verified by the merchant.",
  }),
  missing("O17", 3, "BILLING_STOP_RECORD", "Merchant billing-stop record", "Requested from merchant", "No record explains why the renewal proceeded after cancellation.", ["F-O17-3"]),

  // ---------------------------------------------------------------- O18
  buyerStatement("O18", "The amount charged at renewal does not match the price shown at renewal. The buyer requests a correction of the difference.", "SCENARIO_DEFINED", "SCENARIO_DEFINED", []),
  orderRecord("O18", "8.50"),
  missing("O18", 3, "PRICE_RECORD", "Advertised renewal price", "Requested from merchant", "No price record is attached to the case.", []),
];

export const evidenceByCase = (caseId: string): EvidenceRecord[] =>
  evidenceFixtures.filter((item) => item.caseId === caseId);
