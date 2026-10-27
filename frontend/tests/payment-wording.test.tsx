/**
 * Payment (capture) cases must never read like a dispute.
 *
 * A refund moves funds out of a capture; it is not dispute resolution, so the
 * workspace shows capture wording only. Ordinary dispute cases keep theirs.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../src/App";
import { disputePilot } from "../src/api";

const PAYMENT_CASE = "CAP-DEMO-9001";
const DISPUTE_CASE = "O6";

const renderCase = (caseId: string, lang: "en" | "zh-CN") => {
  window.localStorage.setItem("dp.demo.lang", lang);
  window.history.pushState({}, "", `/cases/${caseId}`);
  return render(<App />);
};

describe("payment case wording", () => {
  beforeEach(() => {
    disputePilot.reset();
  });

  it("labels the amount as a capture amount and drops dispute labels (zh)", async () => {
    const { container } = renderCase(PAYMENT_CASE, "zh-CN");
    // The capture card carries the capture-vocabulary fields; the editors open on demand.
    await screen.findByTestId("capture-panel");

    const text = container.textContent ?? "";
    expect(text).toContain("Capture 金额");
    expect(text).toContain("交易类型");
    expect(text).toContain("交易状态");
    expect(text).toContain("支付生命周期");
    expect(text).toContain("COMPLETED");
    expect(text).toContain("支付生命周期未提供");
    expect(text).not.toContain("争议金额");
    expect(text).not.toContain("生命周期阶段");
    expect(text).not.toContain("买家主张");
  });

  it("uses the same capture wording in English", async () => {
    const { container } = renderCase(PAYMENT_CASE, "en");
    await screen.findByTestId("capture-panel");

    const text = container.textContent ?? "";
    expect(text).toContain("Capture amount");
    expect(text).toContain("Transaction type");
    expect(text).toContain("Transaction status");
    expect(text).toContain("Payment lifecycle");
    expect(text).not.toContain("Disputed amount");
    expect(text).not.toContain("Lifecycle stage");
    expect(text).not.toContain("Buyer claim");
  });

  it("never claims the payment case is resolved or accepted", async () => {
    const user = userEvent.setup();
    for (const lang of ["zh-CN", "en"] as const) {
      const { container, unmount } = renderCase(PAYMENT_CASE, lang);
      await screen.findByTestId("capture-panel");
      await user.click(
        screen.getByRole("button", {
          name: lang === "zh-CN" ? "打开发起区" : "Open authoring",
        }),
      );
      await screen.findByTestId("refund-card");

      const text = container.textContent ?? "";
      expect(text).not.toContain("争议已解决");
      expect(text).not.toContain("买家已接受");
      expect(text).not.toMatch(/dispute (?:has been |is )?resolved/i);
      expect(text).not.toContain("buyer accepted");
      unmount();
    }
  });

  it("keeps dispute wording on an ordinary dispute case", async () => {
    const user = userEvent.setup();
    const { container } = renderCase(DISPUTE_CASE, "zh-CN");
    await user.click(await screen.findByRole("button", { name: "打开发起区" }));
    await screen.findByTestId("send-message-card");

    const text = container.textContent ?? "";
    expect(text).toContain("争议金额");
    expect(text).toContain("生命周期阶段");
    expect(text).toContain("买家主张");
    expect(text).not.toContain("Capture 金额");
  });
});
