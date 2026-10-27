/**
 * P1 — domain label localisation and the JSX hard-coded-English self-check.
 *
 * The scan intentionally ignores data fields, enum/technical tokens (all-caps)
 * and string props fed by expressions; it only flags visible English text and
 * literal title/placeholder/aria-label attributes in components.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuditTimeline } from "../src/components/domain/AuditTimeline";
import { mapAuditEvent } from "../src/api/mapping";
import type { WireAuditEvent } from "../src/api/http/types";
import {
  actionLabel,
  evidenceTypeLabel,
  nextActionLabel,
  translate,
  LanguageProvider,
  type MessageKey,
  type TranslateParams,
} from "../src/i18n";

const t = (key: MessageKey, params?: TranslateParams): string =>
  translate("zh-CN", key, params);

describe("P1 — domain labels follow the UI language", () => {
  it("localises evidence types, action labels and next-action hints", () => {
    expect(evidenceTypeLabel("BUYER_STATEMENT", "Buyer statement", t)).toBe("买家陈述");
    expect(evidenceTypeLabel("CASE_NOTE", "Case note", t)).toBe("案件备注");
    expect(evidenceTypeLabel("ORDER_RECORD", "Order record", t)).toBe("订单记录");
    expect(evidenceTypeLabel("OTHER", "Other document", t)).toBe("其他文件");
    // Unknown types keep the backend label verbatim (data is never invented).
    expect(evidenceTypeLabel("NEW_TYPE", "New backend label", t)).toBe("New backend label");

    expect(actionLabel("Provide evidence (notes branch)", "provide-evidence", t)).toBe(
      "提供证据（备注分支）",
    );
    expect(actionLabel("Send message to buyer", "send-message", t)).toBe("向买家发送消息");
    expect(actionLabel("Send message", "send-message", t)).toBe("发送消息");
    // The technical action identity stays visible elsewhere.
    expect(actionLabel("Unmapped label", "escalate", t)).toBe("升级处理");

    expect(nextActionLabel("Run AI analysis", t)).toBe("运行 AI 分析");
    expect(nextActionLabel("Review recommendation", t)).toBe("审核处理建议");
  });

  it("renders an adapter audit event title in Chinese and keeps the event name", () => {
    const event: WireAuditEvent = {
      event_id: "AUD-O6-EXE",
      case_id: "O6",
      event_type: "EXECUTION_REPLAYED",
      actor_type: "SYSTEM",
      actor_id: "replay-runner",
      payload: {
        approval_id: "APR-PRP-O6-001",
        simulated: true,
        execution_id: "EXE-O6-001",
      },
      created_at: "2026-10-18T09:30:00Z",
    };

    render(
      <LanguageProvider initialLang="zh-CN">
        <AuditTimeline events={[mapAuditEvent(event)]} />
      </LanguageProvider>,
    );

    expect(screen.getByText(/离线回放已执行/)).toBeInTheDocument();
    // Technical event name stays as the secondary label.
    expect(screen.getByText("EXECUTION_ATTEMPT")).toBeInTheDocument();
    expect(screen.queryByText(/Offline replay executed/)).not.toBeInTheDocument();
  });
});

describe("P1 — JSX hard-coded English self-check", () => {
  // Vite gives the raw sources without Node's fs (tests run in jsdom).
  const sources = import.meta.glob("../src/**/*.tsx", {
    query: "?raw",
    import: "default",
    eager: true,
  }) as Record<string, string>;

  it("finds no raw English JSX text or literal English UI attributes", () => {
    const findings: string[] = [];

    for (const [file, source] of Object.entries(sources)) {
      const short = file.replace("../src/", "");
      source.split(/\r?\n/).forEach((line, index) => {
        // Visible text node: `>English text<`. `(?<!=)` skips arrow functions.
        for (const match of line.matchAll(/(?<!=)>\s*([^<>{}]*[A-Za-z][^<>{}]*?)\s*</g)) {
          const text = match[1].trim();
          // Enum / technical tokens are allowed (E1, HTTP, LOCAL_LLM, …).
          if (text && !/^[A-Z0-9_\-–—·/.,:;()]+$/.test(text)) {
            findings.push(`${short}:${index + 1}: ${text}`);
          }
        }
        // Literal UI attributes must use t() as well.
        for (const match of line.matchAll(
          /\b(title|placeholder|aria-label)="([^"]*[A-Za-z][^"]*)"/g,
        )) {
          findings.push(`${short}:${index + 1}: ${match[1]}="${match[2]}"`);
        }
      });
    }

    expect(findings).toEqual([]);
  });
});
