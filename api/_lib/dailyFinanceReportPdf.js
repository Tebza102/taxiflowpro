import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import PDFDocument from "pdfkit";

import { formatOperatingDate, formatSastDateTime, formatSastTimestamp } from "./sastTime.js";

// Brand values live here so they can be corrected without touching layout code.
// Colours are the app's own tokens (src/styles.css); the app's Aptos/Bahnschrift
// fonts are licensed system fonts that can't be embedded, so Helvetica is used.
const BRAND = {
  name: "TaxiFlow Pro",
  navy: "#0B2545",
  teal: "#1BC5BD",
  gold: "#F4D03F",
  ink: "#1A1A1A",
  subtext: "#444444",
  muted: "#6B6B6B",
  rule: "#D3D3D3",
  panel: "#F5F7FA",
  alert: "#B03A2E",
};
const LOGO_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "public",
  "taxiflow-logo.png",
);

const PAGE = { width: 595.28, height: 841.89, margin: 40 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
const FOOTER_BAND = 40;
const CONTENT_BOTTOM = PAGE.height - PAGE.margin - FOOTER_BAND;
const GUTTER = 18;

const STAGE_LABELS = { pending: "Submitted", counted: "Counted", verified: "Verified", banked: "Banked" };
const STATUS_LABELS = {
  pending: "Submitted, awaiting count",
  counted: "Counted, awaiting verification",
  verified: "Verified, awaiting banking",
  banked: "Banked",
};
const NOT_RECORDED = "Not recorded";
const MAX_NOTES_LENGTH = 1500;

// The standard PDF fonts only encode Windows-1252. Anything else is reduced to
// its unaccented base letter where possible, otherwise replaced with "?", so a
// stray emoji in a note can never corrupt the page.
const WIN_ANSI_EXTRAS = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const toPdfText = (value) =>
  Array.from(String(value ?? ""))
    .map((char) => {
      const code = char.codePointAt(0);
      if (code === 0x09 || code === 0x0a || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
        return char;
      }
      if (WIN_ANSI_EXTRAS.has(char)) {
        return char;
      }
      const base = char.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      return base && Array.from(base).every((c) => c.codePointAt(0) <= 0xff) ? base : "?";
    })
    .join("");

const money = (value) => {
  const numeric = Number(value);

  if (value == null || !Number.isFinite(numeric)) {
    return NOT_RECORDED;
  }

  const digits = Number.isInteger(numeric) ? 0 : 2;

  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(numeric);
};

const describeVariance = (cashUp) => {
  if (cashUp.cashVariance == null) {
    return cashUp.actualCashReceived == null ? "Awaiting count" : NOT_RECORDED;
  }
  if (cashUp.cashVariance === 0) {
    return `${money(0)}, matched`;
  }

  return `${money(Math.abs(cashUp.cashVariance))} ${cashUp.cashVariance < 0 ? "short" : "over"}`;
};

const orNotRecorded = (value) => {
  const text = String(value ?? "").trim();

  return text || NOT_RECORDED;
};

// ---------------------------------------------------------------------------
// Low-level drawing with an explicit cursor. pdfkit's own text flow adds pages
// whenever text lands below the bottom margin, which is how blank overflow pages
// appear; every block here measures itself first and breaks pages deliberately.

const setFont = (doc, { bold = false, size = 9, color = BRAND.ink } = {}) =>
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color);

const measure = (doc, text, width, style) => {
  setFont(doc, style);

  return doc.heightOfString(toPdfText(text), { width, lineGap: 1 });
};

const write = (doc, text, x, y, width, style = {}, options = {}) => {
  setFont(doc, style);
  doc.text(toPdfText(text), x, y, { width, lineGap: 1, ...options });
};

const ensureSpace = (ctx, height) => {
  if (ctx.y + height <= CONTENT_BOTTOM) {
    return;
  }

  ctx.doc.addPage();
  drawRunningHeader(ctx);
};

const drawRunningHeader = (ctx) => {
  const { doc } = ctx;
  const y = PAGE.margin;

  write(doc, `${BRAND.name} | Daily Finance Report | ${ctx.reportId}`, PAGE.margin, y, CONTENT_WIDTH - 110, {
    size: 8,
    color: BRAND.muted,
  });
  write(doc, ctx.isDemo ? "DEMO DATA" : "LIVE DATA", PAGE.width - PAGE.margin - 110, y, 110, {
    bold: true,
    size: 8,
    color: ctx.isDemo ? BRAND.alert : BRAND.navy,
  }, { align: "right" });
  doc.moveTo(PAGE.margin, y + 14).lineTo(PAGE.width - PAGE.margin, y + 14).lineWidth(0.5).strokeColor(BRAND.rule).stroke();
  ctx.y = y + 26;
};

const drawFirstHeader = (ctx) => {
  const { doc } = ctx;
  const top = PAGE.margin;
  let textX = PAGE.margin;

  if (existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, PAGE.margin, top, { fit: [40, 40] });
      textX = PAGE.margin + 50;
    } catch {
      // Keep the text wordmark if the logo can't be decoded.
    }
  }

  write(doc, BRAND.name, textX, top + 2, 220, { bold: true, size: 16, color: BRAND.navy });
  write(doc, "Daily Finance Report", textX, top + 22, 220, { size: 11, color: BRAND.subtext });

  const badgeWidth = 110;
  const badgeX = PAGE.width - PAGE.margin - badgeWidth;
  doc.roundedRect(badgeX, top + 2, badgeWidth, 18, 3).lineWidth(1)
    .strokeColor(ctx.isDemo ? BRAND.alert : BRAND.navy).stroke();
  write(doc, ctx.isDemo ? "DEMO DATA" : "LIVE DATA", badgeX, top + 7, badgeWidth, {
    bold: true,
    size: 9,
    color: ctx.isDemo ? BRAND.alert : BRAND.navy,
  }, { align: "center" });
  write(doc, `Generated ${ctx.generatedAt}`, badgeX - 90, top + 26, badgeWidth + 90, {
    size: 8,
    color: BRAND.muted,
  }, { align: "right" });

  let y = top + 48;
  doc.moveTo(PAGE.margin, y).lineTo(PAGE.width - PAGE.margin, y).lineWidth(1.5).strokeColor(BRAND.navy).stroke();
  y += 8;

  if (ctx.isDemo) {
    const message =
      "DEMO DATA - generated from the training and presentation workspace. This is not a live financial record.";
    const height = measure(doc, message, CONTENT_WIDTH - 16, { bold: true, size: 9 }) + 10;
    doc.rect(PAGE.margin, y, CONTENT_WIDTH, height).lineWidth(1).strokeColor(BRAND.alert).stroke();
    write(doc, message, PAGE.margin + 8, y + 5, CONTENT_WIDTH - 16, { bold: true, size: 9, color: BRAND.alert });
    y += height + 8;
  }

  ctx.y = y;
};

const drawSectionTitle = (ctx, title, keepWithNext = 60) => {
  ensureSpace(ctx, 22 + keepWithNext);
  ctx.y += 6;
  write(ctx.doc, title.toUpperCase(), PAGE.margin, ctx.y, CONTENT_WIDTH, {
    bold: true,
    size: 9,
    color: BRAND.navy,
  }, { characterSpacing: 0.6 });
  ctx.y += 13;
  ctx.doc.moveTo(PAGE.margin, ctx.y).lineTo(PAGE.width - PAGE.margin, ctx.y)
    .lineWidth(0.5).strokeColor(BRAND.rule).stroke();
  ctx.y += 7;
};

// Label-over-value cells in N columns; each row is as tall as its tallest cell.
const drawDetailGrid = (ctx, items, columns = 3) => {
  const { doc } = ctx;
  const cellWidth = (CONTENT_WIDTH - GUTTER * (columns - 1)) / columns;

  for (let start = 0; start < items.length; start += columns) {
    const row = items.slice(start, start + columns);
    const heights = row.map(
      ([label, value]) =>
        measure(doc, label, cellWidth, { size: 7.5 }) + 2 + measure(doc, orNotRecorded(value), cellWidth, { bold: true, size: 9.5 }),
    );
    const rowHeight = Math.max(...heights) + 8;

    ensureSpace(ctx, rowHeight);
    row.forEach(([label, value], index) => {
      const x = PAGE.margin + index * (cellWidth + GUTTER);
      const labelHeight = measure(doc, label, cellWidth, { size: 7.5 });
      write(doc, label, x, ctx.y, cellWidth, { size: 7.5, color: BRAND.muted });
      write(doc, orNotRecorded(value), x, ctx.y + labelHeight + 2, cellWidth, {
        bold: true,
        size: 9.5,
        color: value == null || value === "" ? BRAND.muted : BRAND.ink,
      });
    });
    ctx.y += rowHeight;
  }
};

// Label-left / amount-right rows; returns the height used. `dryRun` measures only.
const drawFigureTable = (doc, x, y, width, rows, dryRun = false) => {
  const valueWidth = 110;
  const labelX = x + 4;
  const labelWidth = width - valueWidth - 12;
  let cursor = y;

  rows.forEach((row) => {
    const style = { bold: Boolean(row.emphasis), size: row.emphasis ? 10 : 9 };
    const labelHeight = measure(doc, row.label, labelWidth, style);
    const noteHeight = row.note ? measure(doc, row.note, labelWidth, { size: 7.5 }) + 1 : 0;
    const height = Math.max(labelHeight + noteHeight, measure(doc, row.value, valueWidth, style)) + 7;

    if (!dryRun) {
      if (row.emphasis) {
        doc.rect(x, cursor - 2, width, height).fillColor(BRAND.panel).fill();
      }
      write(doc, row.label, labelX, cursor + 2, labelWidth, { ...style, color: BRAND.ink });
      if (row.note) {
        write(doc, row.note, labelX, cursor + 2 + labelHeight + 1, labelWidth, { size: 7.5, color: BRAND.muted });
      }
      write(doc, row.value, x + width - valueWidth - 4, cursor + 2, valueWidth, {
        ...style,
        color: row.value === NOT_RECORDED || row.value === "Awaiting count" ? BRAND.muted : BRAND.ink,
      }, { align: "right" });
      doc.moveTo(x, cursor + height - 2).lineTo(x + width, cursor + height - 2)
        .lineWidth(0.4).strokeColor(BRAND.rule).stroke();
    }
    cursor += height;
  });

  return cursor - y;
};

// ---------------------------------------------------------------------------
// Charts: vector bars with a printed label and rand value on every bar. Fills
// differ in lightness and pattern so the chart still reads in grayscale.

const CHART_HEIGHT = 128;

const drawHatch = (doc, x, y, width, height, color) => {
  doc.save();
  doc.rect(x, y, width, height).clip();
  doc.lineWidth(0.6).strokeColor(color);
  for (let offset = -height; offset < width; offset += 5) {
    doc.moveTo(x + offset, y + height).lineTo(x + offset + height, y).stroke();
  }
  doc.restore();
};

const drawBar = (doc, bar, x, baseY, width, height) => {
  if (height <= 0) {
    doc.moveTo(x, baseY).lineTo(x + width, baseY).lineWidth(1.5).strokeColor(BRAND.navy).stroke();
    return;
  }

  const top = baseY - height;
  if (bar.style === "solid") {
    doc.rect(x, top, width, height).fillColor(bar.color).fill();
  } else if (bar.style === "hatched") {
    doc.rect(x, top, width, height).fillColor("#FFFFFF").fill();
    drawHatch(doc, x, top, width, height, bar.color);
  } else {
    doc.rect(x, top, width, height).fillColor(BRAND.panel).fill();
  }
  doc.rect(x, top, width, height).lineWidth(0.8).strokeColor(BRAND.navy).stroke();
};

const drawBarChart = (doc, { x, y, width, title, bars, emptyMessage }) => {
  write(doc, title, x, y, width, { bold: true, size: 8.5, color: BRAND.subtext });

  const plotTop = y + 28;
  const labelBand = 26;
  const baseY = y + CHART_HEIGHT - labelBand;
  const plotHeight = baseY - plotTop;
  const numericBars = bars.filter((bar) => bar.value != null && Number.isFinite(Number(bar.value)));
  const hasData = numericBars.some((bar) => Number(bar.value) > 0);

  if (bars.length === 0 || (!hasData && !bars.some((bar) => bar.placeholder))) {
    doc.rect(x, plotTop, width, plotHeight + labelBand - 4).lineWidth(0.5).dash(3, { space: 3 })
      .strokeColor(BRAND.rule).stroke().undash();
    write(doc, emptyMessage, x, plotTop + plotHeight / 2, width, { size: 9, color: BRAND.muted }, { align: "center" });
    return;
  }

  const maxValue = Math.max(1, ...numericBars.map((bar) => Number(bar.value)));
  const slot = width / bars.length;
  const barWidth = Math.min(58, slot - 22);

  bars.forEach((bar, index) => {
    const slotX = x + index * slot;
    const barX = slotX + (slot - barWidth) / 2;

    const placeholder = bar.placeholder ?? (bar.value == null ? NOT_RECORDED : null);

    if (placeholder) {
      doc.rect(barX, plotTop + plotHeight * 0.35, barWidth, plotHeight * 0.65).lineWidth(0.8)
        .dash(3, { space: 2 }).strokeColor(BRAND.muted).stroke().undash();
      write(doc, placeholder, slotX, plotTop + plotHeight * 0.6, slot, { size: 8, color: BRAND.muted }, { align: "center" });
    } else {
      const value = Number(bar.value);
      const height = Math.max(0, (value / maxValue) * (plotHeight - 14));
      drawBar(doc, bar, barX, baseY, barWidth, height);
      write(doc, money(value), slotX, baseY - height - 12, slot, { bold: true, size: 8 }, { align: "center" });
    }

    write(doc, bar.label, slotX + 2, baseY + 5, slot - 4, { size: 7.5, color: BRAND.subtext }, { align: "center" });
  });

  doc.moveTo(x, baseY).lineTo(x + width, baseY).lineWidth(0.6).strokeColor(BRAND.muted).stroke();
};

// ---------------------------------------------------------------------------
// Sections

const drawRecordDetails = (ctx, report) => {
  const { cashUp } = report;
  const status =
    cashUp.basis === "driver-day" && !cashUp.submitted
      ? "Captured, day cash-up not yet submitted"
      : STATUS_LABELS[cashUp.status] ?? cashUp.status;
  const driver = report.header.driver;

  drawSectionTitle(ctx, "Record details");
  drawDetailGrid(ctx, [
    ["Operating date", formatOperatingDate(report.header.date) ?? report.header.date],
    ["Source record ID", report.reportId],
    ["Current status", status],
    ["Vehicle", report.header.vehicle],
    ["Route", report.route],
    ["Driver", driver],
    ["Captured by", report.capturedBy],
    [
      "Cash-up type",
      cashUp.basis === "driver-day"
        ? `${cashUp.basisLabel} (${cashUp.entryCount} ${cashUp.entryCount === 1 ? "entry" : "entries"})`
        : cashUp.basisLabel,
    ],
  ]);
};

const drawSideBySide = (ctx, { title, rows, footnote, chart }) => {
  const { doc } = ctx;
  const leftWidth = 290;
  const chartX = PAGE.margin + leftWidth + GUTTER;
  const chartWidth = CONTENT_WIDTH - leftWidth - GUTTER;
  const tableHeight = drawFigureTable(doc, PAGE.margin, 0, leftWidth, rows, true);
  const footnoteHeight = footnote ? measure(doc, footnote, leftWidth, { size: 7.5 }) + 6 : 0;
  const blockHeight = Math.max(tableHeight + footnoteHeight, CHART_HEIGHT);

  drawSectionTitle(ctx, title, blockHeight);
  const top = ctx.y;
  const used = drawFigureTable(doc, PAGE.margin, top, leftWidth, rows);
  if (footnote) {
    write(doc, footnote, PAGE.margin, top + used + 4, leftWidth, { size: 7.5, color: BRAND.muted });
  }
  drawBarChart(doc, { ...chart, x: chartX, y: top, width: chartWidth });
  ctx.y = top + blockHeight + 4;
};

const drawDailyPosition = (ctx, report) => {
  const { cashUp } = report;
  const driverDay = cashUp.basis === "driver-day";
  const rows = [
    { label: "Standard income", value: money(cashUp.standardIncome) },
    {
      label: "Special income",
      value: money(cashUp.specialIncome),
      note: driverDay ? "Included in this cash-up" : "Same vehicle and date, cashed up separately",
    },
    {
      label: "Expenses",
      value: money(cashUp.totalExpenses),
      note: `Cash ${money(cashUp.cashExpenses)} / non-cash ${money(cashUp.nonCashExpenses)}`,
    },
    { label: "Expected cash hand-in", value: money(cashUp.expectedCashHandIn), emphasis: true },
  ];
  const footnote = driverDay
    ? "Expected cash hand-in = all income for the driver's day less cash expenses. Non-cash expenses are not deducted. Same rule as the hand-in queue."
    : "Expected cash hand-in = the amount claimed on this record, as in the hand-in queue. Special income and expenses are shown for context and are not deducted.";

  drawSideBySide(ctx, {
    title: "Daily position",
    rows,
    footnote,
    chart: {
      title: "Income and expenses (rand)",
      emptyMessage: "No data recorded",
      bars: [
        { label: "Standard income", value: cashUp.standardIncome, style: "solid", color: BRAND.navy },
        { label: "Special income", value: cashUp.specialIncome, style: "solid", color: BRAND.teal },
        { label: "Expenses", value: cashUp.totalExpenses, style: "hatched", color: BRAND.navy },
      ],
    },
  });
};

const drawCashControl = (ctx, report) => {
  const { cashUp } = report;
  const awaiting = cashUp.actualCashReceived == null;
  const rows = [
    { label: "Expected cash hand-in", value: money(cashUp.expectedCashHandIn) },
    { label: "Actual cash received", value: awaiting ? "Awaiting count" : money(cashUp.actualCashReceived) },
    { label: "Cash variance", value: describeVariance(cashUp), emphasis: true },
  ];

  drawSideBySide(ctx, {
    title: "Cash control",
    rows,
    footnote: `Variance = actual cash received less expected cash hand-in. ${
      awaiting ? "Cash has not been counted yet, so no variance is shown." : ""
    }`.trim(),
    chart: {
      title: `Cash reconciliation - variance: ${describeVariance(cashUp)}`,
      emptyMessage: "No data recorded",
      bars:
        cashUp.expectedCashHandIn == null
          ? []
          : [
              { label: "Expected cash", value: cashUp.expectedCashHandIn, style: "outline" },
              awaiting
                ? { label: "Actual cash", placeholder: "Awaiting count" }
                : { label: "Actual cash", value: cashUp.actualCashReceived, style: "solid", color: BRAND.navy },
            ],
    },
  });
};

const drawWorkflow = (ctx, report) => {
  const { doc } = ctx;
  const columnWidth = CONTENT_WIDTH / report.stages.length;
  const lines = report.stages.map((stage) => [
    stage.reached ? "Done" : "Not reached",
    stage.reached ? formatSastDateTime(stage.at) ?? "Time not recorded" : null,
    stage.reached ? stage.by : null,
  ].filter(Boolean));
  const textHeight = Math.max(
    ...lines.map((stageLines) => measure(doc, stageLines.join("\n"), columnWidth - 10, { size: 7.5 })),
  );
  const blockHeight = 34 + textHeight + 6;

  drawSectionTitle(ctx, "Workflow and banking", blockHeight + 40);
  const top = ctx.y;
  const markerY = top + 8;

  report.stages.forEach((stage, index) => {
    const centerX = PAGE.margin + columnWidth * index + columnWidth / 2;

    if (index < report.stages.length - 1) {
      const nextReached = report.stages[index + 1].reached;
      doc.moveTo(centerX + 8, markerY).lineTo(centerX + columnWidth - 8, markerY)
        .lineWidth(nextReached ? 2 : 1).strokeColor(nextReached ? BRAND.navy : BRAND.rule);
      if (!nextReached) doc.dash(2, { space: 2 });
      doc.stroke().undash();
    }

    if (stage.reached) {
      doc.circle(centerX, markerY, 6).fillColor(BRAND.navy).fill();
    } else {
      doc.circle(centerX, markerY, 6).lineWidth(1).strokeColor(BRAND.muted).stroke();
    }

    write(doc, STAGE_LABELS[stage.stage], PAGE.margin + columnWidth * index, markerY + 11, columnWidth, {
      bold: true,
      size: 9,
      color: stage.reached ? BRAND.ink : BRAND.muted,
    }, { align: "center" });
    write(doc, lines[index].join("\n"), PAGE.margin + columnWidth * index + 5, markerY + 24, columnWidth - 10, {
      size: 7.5,
      color: stage.reached ? BRAND.subtext : BRAND.muted,
    }, { align: "center" });
  });
  ctx.y = top + blockHeight;

  const { deposit, cashUp } = report;
  const depositItems = deposit
    ? [
        ["Deposit status", "Deposited"],
        ["Deposit reference", deposit.reference],
        [
          "Deposit batch total",
          deposit.batchAmount == null
            ? null
            : `${money(deposit.batchAmount)}${deposit.recordsInBatch ? ` (batch of ${deposit.recordsInBatch} records)` : ""}`,
        ],
      ]
    : [["Deposit status", cashUp.status === "banked" ? "Banked; linked deposit record not found" : "Not banked yet"]];

  drawDetailGrid(ctx, depositItems);
};

const drawReviewDetails = (ctx, report) => {
  const counted = report.stages.find((stage) => stage.stage === "counted");
  const verified = report.stages.find((stage) => stage.stage === "verified");
  const items = [];

  if (counted?.reached) {
    items.push(["Counted by", counted.by], ["Counted at", formatSastDateTime(counted.at)]);
  }
  if (verified?.reached) {
    items.push(["Verified by", verified.by], ["Verified at", formatSastDateTime(verified.at)]);
  }

  drawSectionTitle(ctx, "Review details", 40);
  if (items.length === 0) {
    write(ctx.doc, "No count or verification has been recorded for this cash-up yet.", PAGE.margin, ctx.y, CONTENT_WIDTH, {
      size: 9,
      color: BRAND.muted,
    });
    ctx.y += 16;
  } else {
    drawDetailGrid(ctx, items, 4);
  }

  if (report.recordNotes) {
    const notes =
      report.recordNotes.length > MAX_NOTES_LENGTH
        ? `${report.recordNotes.slice(0, MAX_NOTES_LENGTH)}... [truncated; see the record in TaxiFlow Pro]`
        : report.recordNotes;
    drawDetailGrid(ctx, [["Record notes", notes]], 1);
  }
};

const SNAPSHOT_NOTE =
  "This report reflects the selected record at the time of generation. Later changes to the record, its cash-up or its deposit are not included.";

const drawPageChrome = (ctx, pageNumber, pageCount) => {
  const { doc } = ctx;
  const savedBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  if (ctx.isDemo) {
    doc.save();
    doc.rotate(-35, { origin: [PAGE.width / 2, PAGE.height / 2] });
    doc.fillOpacity(0.07);
    write(doc, "DEMO DATA", 0, PAGE.height / 2 - 45, PAGE.width, { bold: true, size: 90, color: BRAND.alert }, {
      align: "center",
      lineBreak: false,
    });
    doc.restore();
    doc.fillOpacity(1);
  }

  const lineY = PAGE.height - PAGE.margin - 28;
  doc.moveTo(PAGE.margin, lineY).lineTo(PAGE.width - PAGE.margin, lineY).lineWidth(0.5).strokeColor(BRAND.rule).stroke();
  write(doc, SNAPSHOT_NOTE, PAGE.margin, lineY + 6, CONTENT_WIDTH, { size: 7.5, color: BRAND.muted }, {
    lineBreak: false,
    ellipsis: true,
  });
  write(
    doc,
    `${BRAND.name} | Generated ${ctx.generatedAt} | ${ctx.isDemo ? "DEMO DATA - not a live record" : "Live data"}`,
    PAGE.margin,
    lineY + 17,
    CONTENT_WIDTH - 80,
    { size: 7.5, color: ctx.isDemo ? BRAND.alert : BRAND.muted },
    { lineBreak: false },
  );
  write(doc, `Page ${pageNumber} of ${pageCount}`, PAGE.width - PAGE.margin - 80, lineY + 17, 80, {
    size: 7.5,
    color: BRAND.muted,
  }, { align: "right", lineBreak: false });

  doc.page.margins.bottom = savedBottom;
};

export const renderDailyFinanceReportPdf = (report, { source = "live", generatedAt = new Date() } = {}) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "portrait",
      margins: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin },
      bufferPages: true,
      // Uncompressed content keeps the output inspectable in tests; the size
      // cost for a one- or two-page report is small.
      compress: false,
      info: {
        Title: toPdfText(`${BRAND.name} Daily Finance Report ${report.reportId}`),
        Author: BRAND.name,
        Subject: source === "mock" ? "DEMO DATA - Daily Finance Report" : "Daily Finance Report",
      },
    });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    try {
      const ctx = {
        doc,
        y: PAGE.margin,
        isDemo: source === "mock",
        reportId: report.reportId,
        generatedAt: formatSastTimestamp(generatedAt),
      };

      drawFirstHeader(ctx);
      drawRecordDetails(ctx, report);
      drawDailyPosition(ctx, report);
      drawCashControl(ctx, report);
      drawWorkflow(ctx, report);
      drawReviewDetails(ctx, report);

      const range = doc.bufferedPageRange();
      for (let index = 0; index < range.count; index += 1) {
        doc.switchToPage(range.start + index);
        drawPageChrome(ctx, index + 1, range.count);
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
