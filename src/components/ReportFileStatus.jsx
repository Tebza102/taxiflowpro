import { useEffect } from "react";
import { ExternalLink, RotateCcw } from "lucide-react";

import { formatFileSize, releaseReportFile } from "../lib/reportDownload";

// What happened to a report download: ready (with a link to open or save it
// again, because the page cannot see whether the browser saved it) or failed
// (with the reason and a retry). `testIdPrefix` keeps the existing test ids.
export function ReportFileStatus({ download, onRetry, testIdPrefix }) {
  const file = download.status === "done" ? download.file : null;

  // The kept file is released when it is replaced or the screen closes.
  useEffect(() => () => releaseReportFile(file), [file]);

  if (file) {
    const label = file.format === "pdf" ? "PDF" : "CSV";
    return (
      <div className="finance-form-note report-file-status" data-tone="success" data-testid={`${testIdPrefix}-done`} role="status">
        <p>
          {label} ready: <strong>{file.filename}</strong> ({formatFileSize(file.size)}). Your browser is saving it to Downloads.
          If it did not appear, tap {file.format === "pdf" ? "Open PDF" : "Save CSV"}.
        </p>
        <a
          className="action-button"
          href={file.url}
          download={file.filename}
          target="_blank"
          rel="noopener"
          data-testid={`${testIdPrefix}-open`}
        >
          <ExternalLink size={16} />
          {file.format === "pdf" ? "Open PDF" : "Save CSV"}
        </a>
      </div>
    );
  }

  if (download.status === "error") {
    return (
      <div className="finance-form-note report-file-status" data-tone="danger" data-testid={`${testIdPrefix}-error`} role="alert">
        <p>{download.message}</p>
        <button className="action-button" type="button" onClick={onRetry} data-testid={`${testIdPrefix}-retry`}>
          <RotateCcw size={16} />
          Try again
        </button>
      </div>
    );
  }

  return null;
}
