import { calculateTripAnalytics } from "../lib/analytics";

const getInputValue = (value) => (value == null ? "" : String(value));
const getPreviewValue = (value) =>
  value == null || !Number.isFinite(Number(value)) ? "" : String(value);

export function TripLegOptionalFields({ entry, onUpdate }) {
  const tripAnalytics = calculateTripAnalytics(entry);

  return (
    <>
      <label className="finance-field">
        <span>Trip start time</span>
        <input
          type="time"
          value={getInputValue(entry?.timeIn)}
          onChange={(event) =>
            onUpdate({
              timeIn: event.target.value || null,
            })
          }
        />
      </label>

      <label className="finance-field">
        <span>Trip finish time</span>
        <input
          type="time"
          value={getInputValue(entry?.timeOut)}
          onChange={(event) =>
            onUpdate({
              timeOut: event.target.value || null,
            })
          }
        />
      </label>

      <label className="finance-field">
        <span>Trip odometer start</span>
        <input
          type="number"
          min="0"
          step="1"
          value={getInputValue(entry?.odometerStart)}
          onChange={(event) =>
            onUpdate({
              odometerStart: event.target.value,
            })
          }
        />
      </label>

      <label className="finance-field">
        <span>Trip odometer end</span>
        <input
          type="number"
          min="0"
          step="1"
          value={getInputValue(entry?.odometerEnd)}
          onChange={(event) =>
            onUpdate({
              odometerEnd: event.target.value,
            })
          }
        />
      </label>

      <label className="finance-field">
        <span>Duration (min)</span>
        <input
          type="text"
          value={getPreviewValue(tripAnalytics.tripDurationMin)}
          placeholder="Auto"
          readOnly
        />
      </label>

      <label className="finance-field">
        <span>KM</span>
        <input
          type="text"
          value={getPreviewValue(tripAnalytics.kmComputed)}
          placeholder="Auto"
          readOnly
        />
      </label>
    </>
  );
}
