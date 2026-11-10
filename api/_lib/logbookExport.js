import ExcelJS from "exceljs";

import { LOGBOOK_FIELDS, reconcileLogbookRow } from "../../src/lib/logbookContract.js";

// Excel export of one logbook batch with confidence flags. One line per row;
// each extracted value sits in its own column and is shaded by confidence
// (amber = medium, red = low or unreadable), with the reasons spelled out in the
// "Confidence flags" column so the sheet still reads correctly without colour.

export const LOGBOOK_EXPORT_COLUMNS = Object.freeze([
  { header: "Row", key: "rowIndex", width: 6 },
  { header: "Page", key: "page", width: 6 },
  ...LOGBOOK_FIELDS.map(({ key, label, kind }) => ({ header: label, key, width: kind === "amount" ? 14 : 18, field: true, kind })),
  { header: "Expected banked", key: "expectedBanked", width: 16, kind: "amount" },
  { header: "Difference", key: "difference", width: 12, kind: "amount" },
  { header: "Confidence flags", key: "flags", width: 48 },
  { header: "Checks", key: "checks", width: 48 },
  { header: "Status", key: "status", width: 11 },
  { header: "Reviewed by", key: "reviewedBy", width: 18 },
  { header: "Reviewed at", key: "reviewedAt", width: 20 },
  { header: "Reject reason", key: "rejectReason", width: 30 },
]);

const FILL = { medium: "FFFFE699", low: "FFF8CBAD" };
const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const labelOf = Object.fromEntries(LOGBOOK_FIELDS.map((field) => [field.key, field.label]));

export const buildLogbookExportRows = ({ pages = [], rows = [], actorNames = {} }) => {
  const pageNumber = new Map(pages.map((page) => [page.id, page.page_number]));
  return rows.map((row) => {
    const reconciliation = reconcileLogbookRow(row.fields);
    const flags = LOGBOOK_FIELDS.filter(({ key }) => row.fields[key]?.confidence !== "high").map(({ key }) => {
      const field = row.fields[key];
      return `${labelOf[key]}: ${field.confidence}${field.value === null ? " (not readable)" : ""}${field.note ? ` - ${field.note}` : ""}`;
    });
    return {
      rowIndex: row.rowIndex,
      page: row.pageId ? pageNumber.get(row.pageId) ?? "" : "",
      ...Object.fromEntries(LOGBOOK_FIELDS.map(({ key }) => [key, row.fields[key]?.value ?? null])),
      expectedBanked: reconciliation ? reconciliation.expectedBankedCents / 100 : null,
      difference: reconciliation ? reconciliation.differenceCents / 100 : null,
      flags: flags.join("; "),
      checks: (row.issues ?? []).map((entry) => `${labelOf[entry.field] ?? entry.field}: ${entry.message}`).join("; "),
      status: row.status,
      reviewedBy: row.reviewedBy ? actorNames[row.reviewedBy] ?? "" : "",
      reviewedAt: row.reviewedAt ?? "",
      rejectReason: row.rejectReason ?? "",
      confidence: Object.fromEntries(LOGBOOK_FIELDS.map(({ key }) => [key, row.fields[key]?.confidence ?? "low"])),
    };
  });
};

export const renderLogbookWorkbook = async ({ batch, pages, rows, actorNames, businessName }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TaxiFlow";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Logbook batch", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = LOGBOOK_EXPORT_COLUMNS.map(({ header, key, width }) => ({ header, key, width }));
  sheet.getRow(1).font = { bold: true };

  for (const line of buildLogbookExportRows({ pages, rows, actorNames })) {
    const { confidence, ...values } = line;
    const excelRow = sheet.addRow(values);
    for (const column of LOGBOOK_EXPORT_COLUMNS) {
      const cell = excelRow.getCell(column.key);
      if (column.kind === "amount") cell.numFmt = "#,##0.00";
      if (column.field && FILL[confidence[column.key]]) cell.fill = fill(FILL[confidence[column.key]]);
    }
  }

  const legend = workbook.addWorksheet("About");
  legend.columns = [{ width: 24 }, { width: 80 }];
  legend.addRows([
    ["Business", businessName ?? ""],
    ["Batch", batch.id],
    ["Source", batch.source === "api" ? "Automation import" : "Photo upload"],
    ["Created", batch.created_at],
    ["Exported", new Date().toISOString()],
    [],
    ["No shading", "High confidence: every character was clearly legible, or a reviewer entered the value."],
    ["Amber", "Medium confidence: readable, with some doubt. Check against the page."],
    ["Red", "Low confidence: the value could not be read and is empty. It was not guessed."],
    ["Expected banked", "Revenue less the four expense columns. Difference = Banked - Expected banked."],
    ["Status", "pending = waiting for review; approved = recorded in TaxiFlow; rejected = not recorded."],
  ]);
  legend.getCell("A8").fill = fill(FILL.medium);
  legend.getCell("A9").fill = fill(FILL.low);

  return Buffer.from(await workbook.xlsx.writeBuffer());
};
