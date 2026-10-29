import { existsSync } from "node:fs";

import PDFDocument from "pdfkit";

import { BRAND, LOGO_PATH, toPdfText } from "./dailyFinanceReportPdf.js";
import { REPORT_STATUS_LABELS } from "../../src/lib/periodReport.js";

// A4 PDF of a period report (business or vehicle). It renders the report object
// built by src/lib/periodReport.js and nothing else, so its figures are the
// screen's and the CSV's. Brand, fonts and the DEMO DATA marking follow the
// Daily Finance Report.

const PAGE = { width: 595.28, height: 841.89, margin: 40 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
const CONTENT_BOTTOM = PAGE.height - PAGE.margin - 40;
const ROW = 13;

const amount = (centsValue) => {
  const value = centsValue / 100;
  const formatted = new Intl.NumberFormat("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(value));
  return `${value < 0 ? "-" : ""}R ${formatted}`;
};

const setFont = (doc, { bold = false, size = 8.5, color = BRAND.ink } = {}) =>
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color);

const write = (doc, value, x, y, width, style = {}, options = {}) => {
  setFont(doc, style);
  doc.text(toPdfText(value), x, y, { width, lineGap: 1, ...options });
};

const heightOf = (doc, value, width, style = {}) => {
  setFont(doc, style);
  return doc.heightOfString(toPdfText(value), { width, lineGap: 1 });
};

const runningHeader = (ctx) => {
  const { doc } = ctx;
  write(doc, `${BRAND.name} | ${ctx.report.title} | ${ctx.report.scope.label} | ${ctx.report.period.start} to ${ctx.report.period.end}`, PAGE.margin, PAGE.margin, CONTENT_WIDTH - 90, { size: 8, color: BRAND.muted }, { lineBreak: false, ellipsis: true });
  write(doc, ctx.isDemo ? "DEMO DATA" : "LIVE DATA", PAGE.width - PAGE.margin - 90, PAGE.margin, 90, { bold: true, size: 8, color: ctx.isDemo ? BRAND.alert : BRAND.navy }, { align: "right" });
  doc.moveTo(PAGE.margin, PAGE.margin + 14).lineTo(PAGE.width - PAGE.margin, PAGE.margin + 14).lineWidth(0.5).strokeColor(BRAND.rule).stroke();
  ctx.y = PAGE.margin + 24;
};

const ensure = (ctx, height) => {
  if (ctx.y + height <= CONTENT_BOTTOM) return false;
  ctx.doc.addPage();
  runningHeader(ctx);
  return true;
};

const firstHeader = (ctx) => {
  const { doc, report } = ctx;
  let x = PAGE.margin;
  if (existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, PAGE.margin, PAGE.margin, { fit: [72, 42] });
      x += 82;
    } catch {
      // Keep the text wordmark if the logo can't be decoded.
    }
  }
  write(doc, BRAND.name, x, PAGE.margin + 2, 260, { bold: true, size: 16, color: BRAND.navy });
  write(doc, report.title, x, PAGE.margin + 22, 260, { size: 11, color: BRAND.subtext });
  const badgeX = PAGE.width - PAGE.margin - 110;
  doc.roundedRect(badgeX, PAGE.margin + 2, 110, 18, 3).lineWidth(1).strokeColor(ctx.isDemo ? BRAND.alert : BRAND.navy).stroke();
  write(doc, ctx.isDemo ? "DEMO DATA" : "LIVE DATA", badgeX, PAGE.margin + 7, 110, { bold: true, size: 9, color: ctx.isDemo ? BRAND.alert : BRAND.navy }, { align: "center" });
  write(doc, `Generated ${report.generatedAtLabel}`, badgeX - 90, PAGE.margin + 26, 200, { size: 8, color: BRAND.muted }, { align: "right" });
  ctx.y = PAGE.margin + 48;
  doc.moveTo(PAGE.margin, ctx.y).lineTo(PAGE.width - PAGE.margin, ctx.y).lineWidth(1.5).strokeColor(BRAND.navy).stroke();
  ctx.y += 8;

  if (ctx.isDemo) {
    const message = "DEMO DATA - generated from the training and presentation workspace. This is not a live financial record.";
    const height = heightOf(doc, message, CONTENT_WIDTH - 16, { bold: true, size: 9 }) + 10;
    doc.rect(PAGE.margin, ctx.y, CONTENT_WIDTH, height).lineWidth(1).strokeColor(BRAND.alert).stroke();
    write(doc, message, PAGE.margin + 8, ctx.y + 5, CONTENT_WIDTH - 16, { bold: true, size: 9, color: BRAND.alert });
    ctx.y += height + 8;
  }

  const facts = [
    ["Business", report.businessName ?? "-"],
    ["Scope", report.scope.label],
    ["Period", `${report.period.kindLabel}: ${report.period.label}`],
  ];
  const width = CONTENT_WIDTH / 3;
  facts.forEach(([label, value], index) => {
    write(doc, label.toUpperCase(), PAGE.margin + index * width, ctx.y, width - 8, { bold: true, size: 7, color: BRAND.muted });
    write(doc, value, PAGE.margin + index * width, ctx.y + 10, width - 8, { bold: true, size: 9 });
  });
  ctx.y += 34;
};

const section = (ctx, title, keepWithNext = 50) => {
  ensure(ctx, 22 + keepWithNext);
  ctx.y += 6;
  write(ctx.doc, title.toUpperCase(), PAGE.margin, ctx.y, CONTENT_WIDTH, { bold: true, size: 9, color: BRAND.navy });
  ctx.y += 13;
  ctx.doc.moveTo(PAGE.margin, ctx.y).lineTo(PAGE.width - PAGE.margin, ctx.y).lineWidth(0.75).strokeColor(BRAND.navy).stroke();
  ctx.y += 5;
};

// columns: [{ label, width (fraction), align }]
const table = (ctx, columns, rows, { emptyMessage = "None in this period.", bold = () => false } = {}) => {
  const { doc } = ctx;
  const widths = columns.map((column) => column.width * CONTENT_WIDTH);
  const drawHead = () => {
    let x = PAGE.margin;
    doc.rect(PAGE.margin, ctx.y - 2, CONTENT_WIDTH, ROW).fill(BRAND.panel);
    columns.forEach((column, index) => {
      write(doc, column.label, x + 3, ctx.y + 1, widths[index] - 6, { bold: true, size: 7.5, color: BRAND.subtext }, { align: column.align ?? "left", lineBreak: false, ellipsis: true });
      x += widths[index];
    });
    ctx.y += ROW + 1;
  };
  ensure(ctx, ROW * 2);
  drawHead();
  if (!rows.length) {
    write(doc, emptyMessage, PAGE.margin + 3, ctx.y, CONTENT_WIDTH, { size: 8.5, color: BRAND.muted });
    ctx.y += ROW;
    return;
  }
  rows.forEach((row, rowIndex) => {
    const height = Math.max(ROW, ...row.map((cell, index) => heightOf(doc, cell, widths[index] - 6, { size: 8 }) + 3));
    if (ensure(ctx, height)) drawHead();
    let x = PAGE.margin;
    row.forEach((cell, index) => {
      write(doc, cell, x + 3, ctx.y + 1, widths[index] - 6, { size: 8, bold: bold(rowIndex) }, { align: columns[index].align ?? "left" });
      x += widths[index];
    });
    ctx.y += height;
    doc.moveTo(PAGE.margin, ctx.y - 1).lineTo(PAGE.width - PAGE.margin, ctx.y - 1).lineWidth(0.25).strokeColor(BRAND.rule).stroke();
  });
};

const pairs = (ctx, rows) =>
  table(ctx, [{ label: "", width: 0.7 }, { label: "Amount", width: 0.3, align: "right" }], rows.map(([label, value]) => [label, value]), {
    bold: (index) => rows[index][2] === true,
  });

const summary = (ctx) => {
  const { report } = ctx;
  const t = report.totals;
  section(ctx, "Summary", 140);
  const rows = [
    ["Income", amount(t.incomeCents), true],
    ["   Trip income", amount(t.standardIncomeCents)],
    ["   Special hires", amount(t.specialIncomeCents)],
    ["Expenses", amount(t.expenseCents), true],
  ];
  if (report.kind === "business") {
    rows.push(
      ["   Vehicle expenses", amount(t.vehicleExpenseCents)],
      ["   Business costs without a vehicle", amount(t.unallocatedCents)],
      ["   Driver salaries", amount(t.salaryCents)],
      ["      of which paid from drivers' takings", amount(t.salaryFromTakingsCents)],
    );
  }
  rows.push([report.netLabel, amount(t.netCents), true]);
  pairs(ctx, rows);
};

const vehicleDetails = (ctx) => {
  const { vehicle, activity } = ctx.report;
  section(ctx, "Vehicle and activity", 90);
  table(ctx, [{ label: "Detail", width: 0.35 }, { label: "Value", width: 0.65 }], [
    ["Registration", vehicle.registration],
    ["Model / route", `${vehicle.model ?? "-"} / ${vehicle.route ?? "-"}`],
    ["Status / assigned driver", `${vehicle.status} / ${vehicle.assignedDriver ?? "-"}`],
    ["Trips / special hires", `${activity.trips} / ${activity.specialHires}`],
    ["Days with income", String(activity.activeDays)],
    ["Distance", `${activity.distanceKm} km (${activity.tripsWithDistance} trips with odometer readings)`],
    ["Drivers on these entries", activity.drivers.join(", ") || "-"],
  ]);
};

const breakdowns = (ctx) => {
  const { report } = ctx;
  section(ctx, "Expense breakdown");
  table(ctx, [{ label: "Category", width: 0.6 }, { label: "Entries", width: 0.15, align: "right" }, { label: "Amount", width: 0.25, align: "right" }],
    report.expenseBreakdown.map((group) => [group.category, String(group.count), amount(group.amountCents)]));
  if (report.kind !== "business") return;
  section(ctx, "Business costs without a vehicle (not allocated to vehicles)");
  table(ctx, [{ label: "Category", width: 0.6 }, { label: "Entries", width: 0.15, align: "right" }, { label: "Amount", width: 0.25, align: "right" }],
    report.unallocatedBreakdown.map((group) => [group.category, String(group.count), amount(group.amountCents)]));
  section(ctx, "Driver salaries");
  table(ctx, [{ label: "Date", width: 0.14 }, { label: "Payment", width: 0.44 }, { label: "Paid by / from", width: 0.24 }, { label: "Amount", width: 0.18, align: "right" }],
    report.salaries.map((line) => [line.date, line.description, `${line.paidBy}${line.paidFrom ? ` / ${line.paidFrom}` : ""}`, amount(line.amountCents)]));
  section(ctx, "By vehicle (own entries only)");
  table(ctx, [{ label: "Vehicle", width: 0.34 }, { label: "Trips", width: 0.1, align: "right" }, { label: "Income", width: 0.19, align: "right" }, { label: "Expenses", width: 0.19, align: "right" }, { label: "Net", width: 0.18, align: "right" }],
    report.vehicles.map((row) => [row.label, String(row.trips), amount(row.incomeCents), amount(row.expenseCents), amount(row.netCents)]));
};

const commitments = (ctx) => {
  const c = ctx.report.commitments;
  if (!c) return;
  section(ctx, `Scheduled commitments (not expenses; as at ${c.asOf})`);
  table(ctx, [
    { label: "Due", width: 0.12 }, { label: "Description", width: 0.3 }, { label: "Vehicle", width: 0.13 },
    { label: "Scheduled", width: 0.15, align: "right" }, { label: "Status", width: 0.12 }, { label: "Recorded", width: 0.18, align: "right" },
  ], [
    ...c.items.map((item) => [item.dueDate, `${item.description} (${item.periodLabel})`, item.vehicle ?? "No vehicle", amount(item.scheduledCents), item.statusLabel, item.paidCents == null ? "-" : `${amount(item.paidCents)} on ${item.paidDate}`]),
    ...(c.count ? [["Total", `${c.count} in these dates; ${c.paidCount} recorded, ${c.unpaidCount} not (${c.overdueCount} overdue)`, "", amount(c.scheduledCents), "", amount(c.paidCents)]] : []),
  ], { emptyMessage: "No recurring expenses fall due in these dates.", bold: (index) => index === c.items.length });
};

const checking = (ctx) => {
  const { report } = ctx;
  section(ctx, "Verification status");
  table(ctx, [{ label: "Status", width: 0.28 }, { label: "Income entries", width: 0.17, align: "right" }, { label: "Income", width: 0.19, align: "right" }, { label: "Expense entries", width: 0.17, align: "right" }, { label: "Expenses", width: 0.19, align: "right" }],
    report.verification.map((s) => [s.label, String(s.incomeCount), amount(s.incomeCents), String(s.expenseCount), amount(s.expenseCents)]));
  if (report.kind !== "business") return;
  const c = report.cashChecking;
  section(ctx, "Cash checking (driver day hand-ins)", 80);
  pairs(ctx, [
    ["Driver days / awaiting count / closed with no cash to bank", `${c.dayCount} / ${c.awaitingCount} / ${c.closedWithoutDeposit}`],
    ["Expected cash (all days)", amount(c.expectedCents)],
    ["Counted cash", amount(c.countedCents), true],
    ["Expected cash on counted days", amount(c.expectedOfCountedCents)],
    ["Short / over", `${amount(c.shortCents)} / ${amount(c.overCents)}`],
  ]);
  if (c.days.length) {
    ctx.y += 4;
    table(ctx, [{ label: "Date", width: 0.14 }, { label: "Driver", width: 0.3 }, { label: "Status", width: 0.14 }, { label: "Expected", width: 0.14, align: "right" }, { label: "Counted", width: 0.14, align: "right" }, { label: "Variance", width: 0.14, align: "right" }],
      c.days.map((d) => [d.date, d.driver, REPORT_STATUS_LABELS[d.status], amount(d.expectedCents), d.countedCents == null ? "-" : amount(d.countedCents), d.varianceCents == null ? "-" : amount(d.varianceCents)]));
  }
  const b = report.banking;
  section(ctx, "Banking (by deposit date)");
  table(ctx, [{ label: "Date", width: 0.14 }, { label: "Reference", width: 0.24 }, { label: "Entries", width: 0.1, align: "right" }, { label: "Takings", width: 0.17, align: "right" }, { label: "Cash expenses", width: 0.17, align: "right" }, { label: "Deposit", width: 0.18, align: "right" }],
    [...b.deposits.map((d) => [d.date, d.reference, String(d.recordsLocked), amount(d.takingsCents), amount(d.cashExpensesCents), amount(d.depositCents)]),
      ...(b.count ? [["Total", "", "", "", "", amount(b.depositCents)]] : [])],
    { bold: (index) => index === b.deposits.length });
};

const transactions = (ctx) => {
  const { report } = ctx;
  section(ctx, `Transactions (${report.transactions.length})`);
  table(ctx, [
    { label: "Date", width: 0.12 }, { label: "Type", width: 0.14 }, { label: "Description", width: 0.28 },
    { label: "Vehicle", width: 0.12 }, { label: "Driver", width: 0.12 }, { label: "Status", width: 0.1 }, { label: "Amount", width: 0.12, align: "right" },
  ], report.transactions.map((line) => [
    line.date,
    `${line.type === "income" ? "Income" : "Expense"}: ${line.category}`,
    line.description,
    line.vehicle ?? "No vehicle",
    line.driver ?? "-",
    REPORT_STATUS_LABELS[line.status],
    `${line.type === "expense" ? "-" : ""}${amount(line.amountCents)}`,
  ]));
};

const notes = (ctx) => {
  const { report, doc } = ctx;
  section(ctx, "Notes and reconciliation", 40);
  const lines = [
    `Reconciles: ${report.reconciliation.ok ? "yes" : "NO - check the lines"} (${report.reconciliation.checks.map((check) => `${check.label}: ${check.ok ? "yes" : "no"}`).join("; ")}).`,
    ...report.notes,
  ];
  for (const line of lines) {
    const height = heightOf(doc, `- ${line}`, CONTENT_WIDTH, { size: 8 }) + 3;
    ensure(ctx, height);
    write(doc, `- ${line}`, PAGE.margin, ctx.y, CONTENT_WIDTH, { size: 8, color: BRAND.subtext });
    ctx.y += height;
  }
};

const chrome = (ctx, pageNumber, pageCount) => {
  const { doc } = ctx;
  const savedBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;
  if (ctx.isDemo) {
    doc.save();
    doc.rotate(-35, { origin: [PAGE.width / 2, PAGE.height / 2] });
    doc.fillOpacity(0.07);
    write(doc, "DEMO DATA", 0, PAGE.height / 2 - 45, PAGE.width, { bold: true, size: 90, color: BRAND.alert }, { align: "center", lineBreak: false });
    doc.restore();
    doc.fillOpacity(1);
  }
  const lineY = PAGE.height - PAGE.margin - 28;
  doc.moveTo(PAGE.margin, lineY).lineTo(PAGE.width - PAGE.margin, lineY).lineWidth(0.5).strokeColor(BRAND.rule).stroke();
  write(doc, "Recorded entries at the time of generation. Net result is not accounting profit; see Notes.", PAGE.margin, lineY + 6, CONTENT_WIDTH, { size: 7.5, color: BRAND.muted }, { lineBreak: false });
  write(doc, `${BRAND.name} | Generated ${ctx.report.generatedAtLabel} | ${ctx.isDemo ? "DEMO DATA - not a live record" : "Live data"}`, PAGE.margin, lineY + 17, CONTENT_WIDTH - 80, { size: 7.5, color: ctx.isDemo ? BRAND.alert : BRAND.muted }, { lineBreak: false });
  write(doc, `Page ${pageNumber} of ${pageCount}`, PAGE.width - PAGE.margin - 80, lineY + 17, 80, { size: 7.5, color: BRAND.muted }, { align: "right", lineBreak: false });
  doc.page.margins.bottom = savedBottom;
};

export const renderPeriodReportPdf = (report, { source = "live" } = {}) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin },
      bufferPages: true,
      compress: false,
      info: {
        Title: toPdfText(`${BRAND.name} ${report.title} ${report.scope.label} ${report.period.start} to ${report.period.end}`),
        Author: BRAND.name,
        Subject: source === "mock" ? `DEMO DATA - ${report.title}` : report.title,
      },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      const ctx = { doc, report, y: PAGE.margin, isDemo: source === "mock" };
      firstHeader(ctx);
      summary(ctx);
      if (report.kind === "vehicle") vehicleDetails(ctx);
      breakdowns(ctx);
      commitments(ctx);
      checking(ctx);
      transactions(ctx);
      notes(ctx);
      const range = doc.bufferedPageRange();
      for (let index = 0; index < range.count; index += 1) {
        doc.switchToPage(range.start + index);
        chrome(ctx, index + 1, range.count);
      }
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
