import { jsPDF } from "jspdf";
import {
  POLICY_CATEGORY_ORDER,
  violationSummaryPlain,
  type PassedCheck,
  type PolicyCategory,
  type Violation,
} from "@/lib/engine";

const CATEGORY_LABEL: Record<PolicyCategory, string> = {
  security: "Security",
  cost: "Cost",
  operational: "Operational",
};

const SEVERITY_ORDER: Record<Violation["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function violationsByCategory(violations: Violation[]) {
  return POLICY_CATEGORY_ORDER.map((category) => ({
    category,
    items: violations
      .filter((v) => v.category === category)
      .sort((a, b) => {
        const d = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
        if (d !== 0) return d;
        return `${a.serviceId}\0${a.ruleName}`.localeCompare(`${b.serviceId}\0${b.ruleName}`);
      }),
  })).filter((g) => g.items.length > 0);
}

function passesByCategory(passes: PassedCheck[]) {
  return POLICY_CATEGORY_ORDER.map((category) => ({
    category,
    items: passes
      .filter((p) => p.category === category)
      .sort((a, b) =>
        `${a.ruleName}\0${a.serviceId}`.localeCompare(`${b.ruleName}\0${b.serviceId}`),
      ),
  })).filter((g) => g.items.length > 0);
}

export interface ComplianceReportPayload {
  scannedAt: string;
  passed: boolean;
  summary: string;
  serviceCount: number;
  ruleCount: number;
  violations: Violation[];
  passes: PassedCheck[];
}

/** Client-safe PDF download for a completed scan. */
export function downloadCompliancePdf(report: ComplianceReportPayload, filename?: string): void {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 48;
  let y = margin;
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  const maxW = pageW - margin * 2;

  const ensureSpace = (needed: number) => {
    if (y + needed > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  const writeLines = (text: string, fontSize = 10, lineGap = 1.35) => {
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(text, maxW);
    const step = fontSize * lineGap;
    for (const line of lines) {
      ensureSpace(step);
      doc.text(line, margin, y);
      y += step;
    }
    y += 4;
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  ensureSpace(22);
  doc.text("Infrastructure compliance report", margin, y);
  y += 26;

  doc.setFont("helvetica", "normal");
  writeLines(`Scanned at: ${report.scannedAt}`, 10);
  writeLines(`Services: ${report.serviceCount}  |  Rules: ${report.ruleCount}`, 10);
  writeLines(`Overall: ${report.passed ? "All checks passed" : "Violations present"}`, 10);
  y += 4;
  writeLines(report.summary, 11);

  if (report.violations.length > 0) {
    doc.setFont("helvetica", "bold");
    writeLines("Violations", 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    for (const { category, items } of violationsByCategory(report.violations)) {
      doc.setFont("helvetica", "bold");
      writeLines(CATEGORY_LABEL[category], 11);
      doc.setFont("helvetica", "normal");
      for (const v of items) {
        const block = [
          `[${v.severity}] ${v.ruleName}`,
          `Service: ${v.serviceId}${v.serviceName ? ` (${v.serviceName})` : ""}`,
          violationSummaryPlain(v),
          `Recommendation: ${v.recommendation}`,
        ].join("\n");
        writeLines(block, 9);
        y += 2;
      }
    }
  }

  if (report.passes.length > 0) {
    doc.setFont("helvetica", "bold");
    writeLines("Passed checks", 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    for (const { category, items } of passesByCategory(report.passes)) {
      doc.setFont("helvetica", "bold");
      writeLines(CATEGORY_LABEL[category], 11);
      doc.setFont("helvetica", "normal");
      for (const p of items) {
        writeLines(
          [`Pass — ${p.ruleName}`, `Service: ${p.serviceId}${p.serviceName ? ` (${p.serviceName})` : ""}`].join(
            "\n",
          ),
          9,
        );
        y += 2;
      }
    }
  }

  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  ensureSpace(20);
  doc.text("Sent to Service Manager (report generated from scanner UI).", margin, y);

  const safeName =
    filename ??
    `compliance-report-${report.scannedAt.replace(/[:./\\?%*|"<>]/g, "-")}.pdf`;
  doc.save(safeName);
}
