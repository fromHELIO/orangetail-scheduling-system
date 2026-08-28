import { DAYS_OF_WEEK, HOURS, MINUTES } from "../generate_utils";
import "./time_wheel.css";

export default function TimeWheel({
  day,
  start_h,
  start_m,
  end_h,
  end_m,
  onChange,
  hideDay = false,
}) {
  return (
    <div className="tw-row">
      {!hideDay && (
        <select
          className="tw-day-sel"
          value={day}
          onChange={(e) => onChange("day", e.target.value)}
        >
          {DAYS_OF_WEEK.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      )}
      <div className="tw-wheel">
        <select
          className="tw-sel"
          value={start_h}
          onChange={(e) => onChange("start_h", e.target.value)}
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span className="tw-colon">:</span>
        <select
          className="tw-sel tw-sel-min"
          value={start_m}
          onChange={(e) => onChange("start_m", e.target.value)}
        >
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <span className="tw-sep">to</span>
      <div className="tw-wheel">
        <select
          className="tw-sel"
          value={end_h}
          onChange={(e) => onChange("end_h", e.target.value)}
        >
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <span className="tw-colon">:</span>
        <select
          className="tw-sel tw-sel-min"
          value={end_m}
          onChange={(e) => onChange("end_m", e.target.value)}
        >
          {MINUTES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
