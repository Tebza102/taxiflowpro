// Fetches a report file (PDF or CSV) and hands it to the browser to save.
//
// A page cannot tell whether the browser actually saved the file: phone browsers
// can block or drop it silently (Chrome warns on files from a plain http address,
// such as the demo opened over a phone hotspot). So the file is kept in memory,
// the screen says it is ready (never "downloaded"), and offers a link the person
// taps to open or save it again, plus a retry when preparing it failed.

// A report request that has not answered after this long is abandoned, so the
// screen never stays on "Preparing..." (the person can try again).
export const REPORT_REQUEST_TIMEOUT_MS = 60_000;

export const fetchWithTimeout = (url, init = {}, timeoutMs = REPORT_REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => window.clearTimeout(timer));
};

export const filenameOf = (response, fallback) =>
  /filename="([^"]+)"/i.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? fallback;

// A PDF must start with "%PDF-"; anything else (an HTML error page, an empty
// body) is reported as a failure instead of being saved as a broken file.
export const isPdfBytes = (bytes) =>
  bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-";

const triggerSave = (url, filename) => {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
};

// Returns { ok: true, file: { url, filename, format, size } } or
// { ok: false, status, error } where status is the HTTP status, "timeout",
// "invalid" (not a readable PDF) or 0 (network).
export async function fetchReportFile(url, init, { format, fallbackName }) {
  let response;
  try {
    response = await fetchWithTimeout(url, init);
  } catch (error) {
    return { ok: false, status: error?.name === "AbortError" ? "timeout" : 0 };
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return { ok: false, status: response.status, error: body.error };
  }
  let blob;
  try {
    blob = await response.blob();
  } catch {
    return { ok: false, status: 0 };
  }
  if (format === "pdf" && !isPdfBytes(new Uint8Array(await blob.slice(0, 5).arrayBuffer()))) {
    return { ok: false, status: "invalid" };
  }
  // Chrome on Android hands a blob typed application/pdf to its PDF viewer
  // instead of saving it (the CSV, typed text/csv, saves normally). The same
  // bytes typed as a generic file are saved; the .pdf name still opens as a PDF.
  const saveable = format === "pdf" ? new Blob([blob], { type: "application/octet-stream" }) : blob;
  const file = {
    url: URL.createObjectURL(saveable),
    filename: filenameOf(response, fallbackName),
    format,
    size: blob.size,
  };
  triggerSave(file.url, file.filename);
  return { ok: true, file };
}

export const releaseReportFile = (file) => {
  if (file?.url) URL.revokeObjectURL(file.url);
};

export const formatFileSize = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
