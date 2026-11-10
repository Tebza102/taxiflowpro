import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Download, FileUp, KeyRound, X } from "lucide-react";

import { LOGBOOK_FIELDS, hasLogbookErrors, hasLogbookWarnings } from "../lib/logbookContract";
import { logbookRequest } from "../lib/tenantWorkspace";

// Money > Logbook import (Owner, or Admin with Money access). A photo of a paper
// logbook page is read on the server into rows that wait here for review: the
// page on one side, the rows on the other. Nothing is recorded in TaxiFlow until
// a row is approved, and the server decides every step (this screen only shows
// what it returns).

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_EDGE = 2200; // px; larger photos are scaled down before upload
const ACCEPT = "image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif";
const STATUS_TONE = { pending: "warning", approved: "success", rejected: "neutral" };
const STATUS_LABEL = { pending: "Waiting for review", approved: "Approved", rejected: "Rejected" };
const CONFIDENCE_LABEL = { medium: "Check this", low: "Not readable" };

const toBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

// Large photos are scaled down to a JPEG so they upload quickly; a file this
// browser cannot decode (HEIC on most browsers) is sent as it is and converted
// on the server.
const preparePage = async (file) => {
  let blob = file;
  let mediaType = file.type || "application/octet-stream";
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_UPLOAD_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale < 1 || file.size > 3 * 1024 * 1024) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const scaled = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (scaled) {
        blob = scaled;
        mediaType = "image/jpeg";
      }
    }
    bitmap.close?.();
  } catch {
    // Not decodable here: the server checks and converts the original bytes.
  }
  return { filename: file.name, mediaType, dataBase64: await toBase64(blob) };
};

const formatWhen = (value) => (value ? new Date(value).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" }) : "");
const inputValue = (field) => (field?.value === null || field?.value === undefined ? "" : String(field.value));

export function LogbookImportPanel({ isOwner, onLiveDataChanged }) {
  const [batches, setBatches] = useState([]);
  const [batchId, setBatchId] = useState(null);
  const [batch, setBatch] = useState(null);
  const [pageId, setPageId] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [drafts, setDrafts] = useState({}); // rowId -> { fieldKey: text }
  const [rejecting, setRejecting] = useState(null); // { rowId, reason }
  const [confirming, setConfirming] = useState(null); // rowId awaiting warning confirmation
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(null);
  const [keys, setKeys] = useState(null);
  const [newKey, setNewKey] = useState(null);
  const [keyName, setKeyName] = useState("");
  const fileInput = useRef(null);

  const say = (tone, message) => setFeedback({ tone, message });

  const loadBatches = useCallback(async () => {
    const result = await logbookRequest("batches");
    if (!result.ok) return say("danger", result.error);
    setBatches(result.batches ?? []);
    return result.batches ?? [];
  }, []);

  const loadBatch = useCallback(async (id) => {
    const result = await logbookRequest("batch", { query: { id } });
    if (!result.ok) return say("danger", result.error);
    setBatch(result);
    setDrafts({});
    setPageId((current) => (result.pages.some((page) => page.id === current) ? current : result.pages[0]?.id ?? null));
    return result;
  }, []);

  useEffect(() => {
    loadBatches().then((list) => {
      if (Array.isArray(list) && list.length) setBatchId((current) => current ?? list[0].id);
    });
  }, [loadBatches]);

  useEffect(() => {
    if (batchId) loadBatch(batchId);
    else setBatch(null);
  }, [batchId, loadBatch]);

  // The page image is fetched with the sign-in token and shown from memory only.
  useEffect(() => {
    let cancelled = false;
    let url = null;
    setImageUrl(null);
    if (!pageId) return undefined;
    logbookRequest("page-image", { query: { id: pageId }, as: "blob" }).then((result) => {
      if (cancelled || !result.ok) return;
      url = URL.createObjectURL(result.blob);
      setImageUrl(url);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [pageId]);

  const upload = async (event) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!files.length) return;
    const tooBig = files.find((file) => file.size > MAX_FILE_BYTES);
    if (tooBig) return say("danger", `"${tooBig.name}" is larger than 10 MB. Nothing was uploaded.`);
    setBusy("upload");
    let targetBatch = null;
    let openBatch = null;
    let queued = 0;
    let skipped = 0;
    const notes = [];
    try {
      // One page per request keeps each upload small; later pages join the first page's batch.
      for (const [index, file] of files.entries()) {
        say("info", `Reading page ${index + 1} of ${files.length}. This can take up to a minute.`);
        const page = await preparePage(file);
        const result = await logbookRequest("extract", { method: "POST", body: { ...(targetBatch ? { batchId: targetBatch } : {}), pages: [page] } });
        if (!result.ok) {
          say("danger", `${file.name}: ${result.error}${queued ? ` ${queued} earlier row(s) are waiting for review.` : ""}`);
          break;
        }
        const info = result.pages?.[0] ?? {};
        if (info.duplicatePage) notes.push(`${file.name} was uploaded before; its rows are in the batch shown.`);
        else if (info.extractedRows === 0) notes.push(`${file.name}: no logbook lines were found${info.pageNote ? ` (${info.pageNote})` : ""}.`);
        if (!info.duplicatePage && result.batchId) targetBatch = result.batchId;
        openBatch = targetBatch ?? result.batchId ?? openBatch;
        queued += result.queuedRows ?? 0;
        skipped += result.skippedDuplicateRows?.length ?? 0;
        if (index === files.length - 1) {
          say(queued ? "success" : "info", [`${queued} row(s) are waiting for review.`, skipped ? `${skipped} row(s) were already imported and were skipped.` : "", ...notes].filter(Boolean).join(" "));
        }
      }
    } finally {
      // Whatever happened, show what the server now holds.
      await loadBatches();
      if (openBatch) {
        setBatchId(openBatch);
        await loadBatch(openBatch);
      }
      setBusy(null);
    }
  };

  const setDraft = (rowId, key, value) => setDrafts((current) => ({ ...current, [rowId]: { ...(current[rowId] ?? {}), [key]: value } }));
  const dirtyValues = (row) => {
    const draft = drafts[row.id] ?? {};
    const changed = {};
    for (const { key, kind } of LOGBOOK_FIELDS) {
      if (!(key in draft) || draft[key] === inputValue(row.fields[key])) continue;
      const text = draft[key].trim();
      changed[key] = text === "" ? null : kind === "amount" && /^\d+(\.\d+)?$/.test(text) ? Number(text) : text;
    }
    return changed;
  };

  const act = async (row, action, body, successMessage) => {
    setBusy(row.id);
    try {
      const result = await logbookRequest(action, { method: "POST", body });
      if (!result.ok) {
        if (result.needsAcknowledgement) setConfirming(row.id);
        say("danger", result.error);
        // The server's view of the row may have changed (for example its checks).
        await loadBatch(batchId);
        return false;
      }
      await Promise.all([loadBatch(batchId), loadBatches()]);
      say("success", successMessage);
      return true;
    } finally {
      setBusy(null);
    }
  };

  const save = (row) => act(row, "row-edit", { rowId: row.id, values: dirtyValues(row) }, "Changes saved. The row is still waiting for approval.");
  const approve = async (row, acknowledgeWarnings = false) => {
    const approved = await act(row, "row-approve", { rowId: row.id, ...(acknowledgeWarnings ? { acknowledgeWarnings: true } : {}) }, "Approved and recorded in Money as entries waiting for cash checking.");
    if (approved) {
      setConfirming(null);
      await onLiveDataChanged?.();
    }
  };
  const reject = async () => {
    const row = batch.rows.find((entry) => entry.id === rejecting.rowId);
    if (await act(row, "row-reject", { rowId: row.id, reason: rejecting.reason.trim() }, "Rejected. Nothing was recorded; the row is kept for the record.")) setRejecting(null);
  };

  const exportBatch = async () => {
    setBusy("export");
    const result = await logbookRequest("export", { query: { id: batchId }, as: "blob" });
    setBusy(null);
    if (!result.ok) return say("danger", result.error);
    const url = URL.createObjectURL(result.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = result.filename ?? "taxiflow-logbook.xlsx";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return say("success", "Excel file ready.");
  };

  const loadKeys = async () => {
    const result = await logbookRequest("keys");
    if (!result.ok) return say("danger", result.error);
    return setKeys(result.keys ?? []);
  };
  const createKey = async () => {
    const result = await logbookRequest("keys", { method: "POST", body: { action: "create", name: keyName.trim() } });
    if (!result.ok) return say("danger", result.error);
    setNewKey(result.created);
    setKeyName("");
    return loadKeys();
  };
  const revokeKey = async (keyId) => {
    const result = await logbookRequest("keys", { method: "POST", body: { action: "revoke", keyId } });
    if (!result.ok) return say("danger", result.error);
    say("success", "Key revoked. It stopped working immediately.");
    return loadKeys();
  };

  const pending = useMemo(() => (batch?.rows ?? []).filter((row) => row.status === "pending").length, [batch]);
  const pageNumber = useMemo(() => new Map((batch?.pages ?? []).map((page) => [page.id, page.page_number])), [batch]);
  const visibleRows = useMemo(() => (batch?.rows ?? []).filter((row) => !pageId || !row.pageId || row.pageId === pageId), [batch, pageId]);

  return (
    <div className="content-stack logbook-import">
      <article className="overview-board">
        <div className="overview-board-head">
          <p className="eyebrow">Paper logbook</p>
          <h3>Logbook import</h3>
        </div>
        <p className="panel-note">
          Upload a photo of a logbook page. TaxiFlow reads it into rows for you to check against the photo. Nothing is
          recorded until you approve a row, and a value that cannot be read is left empty for you to fill in.
        </p>
        <div className="finance-form-actions">
          <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={upload} data-testid="logbook-file-input" />
          <button type="button" className="action-button primary" disabled={busy === "upload"} onClick={() => fileInput.current?.click()}>
            <FileUp size={16} />
            {busy === "upload" ? "Reading the page" : "Upload logbook photos"}
          </button>
          {batchId && (
            <button type="button" className="action-button" disabled={busy === "export"} onClick={exportBatch}>
              <Download size={16} />
              Export this batch to Excel
            </button>
          )}
        </div>
        <p className="panel-note">JPG, PNG or HEIC, up to 10 MB each.</p>
        {feedback && (
          <div className="finance-feedback" data-tone={feedback.tone} role="status">
            <span>{feedback.message}</span>
          </div>
        )}
      </article>

      {batches.length > 0 && (
        <article className="overview-board">
          <div className="overview-board-head">
            <p className="eyebrow">Review queue</p>
            <h3>{pending ? `${pending} row${pending === 1 ? "" : "s"} waiting for review in this batch` : "Batches"}</h3>
          </div>
          <label className="logbook-batch-select">
            <span>Batch</span>
            <select value={batchId ?? ""} onChange={(event) => setBatchId(event.target.value)}>
              {batches.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {formatWhen(entry.created_at)} / {entry.source === "api" ? "automation" : "photo"} / {entry.counts.pending} waiting, {entry.counts.approved} approved, {entry.counts.rejected} rejected
                </option>
              ))}
            </select>
          </label>

          {batch && (
            <div className="logbook-review">
              <section className="logbook-page" aria-label="Logbook page">
                {batch.pages.length > 1 && (
                  <div className="logbook-page-tabs">
                    {batch.pages.map((page) => (
                      <button key={page.id} type="button" className="action-button" data-active={page.id === pageId} onClick={() => setPageId(page.id)}>
                        Page {page.page_number}
                      </button>
                    ))}
                  </div>
                )}
                {batch.pages.length === 0 && <p className="panel-note">These rows came from the automation import, so there is no photo.</p>}
                {pageId && (imageUrl ? <img src={imageUrl} alt={`Logbook page ${pageNumber.get(pageId) ?? ""}`} /> : <p className="panel-note">Loading the page.</p>)}
                {batch.pages.find((page) => page.id === pageId)?.page_note && <p className="panel-note">{batch.pages.find((page) => page.id === pageId).page_note}</p>}
              </section>

              <section className="logbook-rows" aria-label="Extracted rows">
                {visibleRows.length === 0 && <p className="panel-note">No rows were read from this page.</p>}
                {visibleRows.map((row) => {
                  const editable = row.status === "pending";
                  const changed = Object.keys(dirtyValues(row)).length > 0;
                  const errors = hasLogbookErrors(row.issues);
                  const warnings = hasLogbookWarnings(row.issues);
                  return (
                    <article key={row.id} className="logbook-row" data-status={row.status} data-testid="logbook-row">
                      <header>
                        <strong>Row {row.rowIndex}</strong>
                        <span className="status-chip" data-tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</span>
                      </header>
                      <div className="logbook-fields">
                        {LOGBOOK_FIELDS.map(({ key, label, kind }) => {
                          const field = row.fields[key];
                          const issue = row.issues.find((entry) => entry.field === key);
                          const confidence = field?.confidence ?? "low";
                          const describedBy = `${row.id}-${key}-hint`;
                          return (
                            <label key={key} className="logbook-field" data-confidence={confidence} data-issue={issue?.severity ?? "none"}>
                              <span className="logbook-field-label">
                                {label}
                                {confidence !== "high" && <em>{CONFIDENCE_LABEL[confidence]}</em>}
                              </span>
                              <input
                                type={kind === "date" ? "date" : "text"}
                                inputMode={kind === "amount" ? "decimal" : undefined}
                                value={drafts[row.id]?.[key] ?? inputValue(field)}
                                placeholder={field?.value === null ? "Not readable" : ""}
                                disabled={!editable || busy === row.id}
                                aria-describedby={describedBy}
                                onChange={(event) => setDraft(row.id, key, event.target.value)}
                              />
                              <small id={describedBy}>{[issue?.message, field?.note].filter(Boolean).join(" ")}</small>
                            </label>
                          );
                        })}
                      </div>

                      {editable && (
                        <div className="finance-form-actions">
                          {changed && (
                            <button type="button" className="action-button primary" disabled={busy === row.id} onClick={() => save(row)}>
                              Save changes
                            </button>
                          )}
                          <button
                            type="button"
                            className="action-button primary"
                            disabled={busy === row.id || changed || errors}
                            title={changed ? "Save your changes first." : errors ? "Correct the highlighted fields first." : undefined}
                            onClick={() => (warnings ? setConfirming(row.id) : approve(row))}
                          >
                            <Check size={16} />
                            Approve
                          </button>
                          <button type="button" className="action-button" disabled={busy === row.id} onClick={() => setRejecting({ rowId: row.id, reason: "" })}>
                            <X size={16} />
                            Reject
                          </button>
                        </div>
                      )}
                      {editable && errors && <p className="panel-note">Correct the highlighted fields from the photo before approving.</p>}
                      {confirming === row.id && editable && (
                        <div className="logbook-confirm" role="alertdialog" aria-label="Confirm approval">
                          <p>{row.issues.filter((entry) => entry.severity === "warning").map((entry) => entry.message).join(" ")} Approve the figures as written?</p>
                          <div className="finance-form-actions">
                            <button type="button" className="action-button primary" disabled={busy === row.id} onClick={() => approve(row, true)}>
                              Approve as written
                            </button>
                            <button type="button" className="action-button" onClick={() => setConfirming(null)}>
                              Keep reviewing
                            </button>
                          </div>
                        </div>
                      )}
                      {rejecting?.rowId === row.id && (
                        <div className="logbook-confirm">
                          <label>
                            <span>Reason for rejecting</span>
                            <input type="text" value={rejecting.reason} maxLength={300} onChange={(event) => setRejecting({ rowId: row.id, reason: event.target.value })} />
                          </label>
                          <div className="finance-form-actions">
                            <button type="button" className="action-button primary" disabled={busy === row.id || rejecting.reason.trim().length < 3} onClick={reject}>
                              Reject row
                            </button>
                            <button type="button" className="action-button" onClick={() => setRejecting(null)}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                      {row.status !== "pending" && (
                        <p className="panel-note">
                          {STATUS_LABEL[row.status]} by {batch.actorNames?.[row.reviewedBy] ?? "a team member"} on {formatWhen(row.reviewedAt)}
                          {row.rejectReason ? `: ${row.rejectReason}` : "."}
                        </p>
                      )}
                    </article>
                  );
                })}
              </section>
            </div>
          )}
        </article>
      )}

      {isOwner && (
        <article className="overview-board">
          <div className="overview-board-head">
            <p className="eyebrow">Automation</p>
            <h3>Import keys</h3>
          </div>
          <p className="panel-note">
            A key lets another system send rows into this review queue. It cannot read anything or approve anything.
          </p>
          {keys === null ? (
            <div className="finance-form-actions">
              <button type="button" className="action-button" onClick={loadKeys}>
                <KeyRound size={16} />
                Manage import keys
              </button>
            </div>
          ) : (
            <>
              {newKey && (
                <div className="finance-feedback" data-tone="warning" role="status">
                  <span>
                    Copy this key now. It is shown once and cannot be shown again: <code data-testid="logbook-new-key">{newKey.key}</code>
                  </span>
                </div>
              )}
              <div className="logbook-key-form">
                <label>
                  <span>Name for a new key</span>
                  <input type="text" value={keyName} maxLength={80} onChange={(event) => setKeyName(event.target.value)} />
                </label>
                <button type="button" className="action-button primary" disabled={keyName.trim().length < 2} onClick={createKey}>
                  Create key
                </button>
              </div>
              {keys.length === 0 && <p className="panel-note">No keys yet.</p>}
              <ul className="logbook-key-list">
                {keys.map((key) => (
                  <li key={key.id}>
                    <span>
                      <strong>{key.name}</strong> ({key.key_prefix}...) / created {formatWhen(key.created_at)}
                      {key.last_used_at ? ` / last used ${formatWhen(key.last_used_at)}` : " / never used"}
                    </span>
                    {key.revoked_at ? (
                      <span className="status-chip" data-tone="neutral">Revoked</span>
                    ) : (
                      <button type="button" className="action-button" onClick={() => revokeKey(key.id)}>
                        Revoke
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </article>
      )}
    </div>
  );
}
