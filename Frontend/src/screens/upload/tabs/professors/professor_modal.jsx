import { useState } from "react";
import {
  EMPLOYMENT_STATUSES,
  HIGHEST_DEGREES,
  DAYS_OF_WEEK,
} from "../../../../constants";
import "./professor_modal.css";

function calcAge(birthDate) {
  if (!birthDate) return "";
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function to24h(t) {
  if (!t) return "";
  if (!/\s(AM|PM)$/i.test(t)) return t;
  const [time, period] = t.trim().split(" ");
  let [h, m] = time.split(":").map(Number);
  if (/PM/i.test(period) && h !== 12) h += 12;
  if (/AM/i.test(period) && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export default function ProfessorModal({
  professor,
  specializations,
  onSave,
  onClose,
  error,
}) {
  const [form, setForm] = useState({
    first_name: professor?.first_name || "",
    middle_name: professor?.middle_name || "",
    last_name: professor?.last_name || "",
    employee_num: professor?.employee_num || "",
    birth_date: professor?.birth_date || "",
    degree: professor?.degree || "",
    date_of_first_appointment: professor?.date_of_first_appointment || "",
    employment_status: professor?.employment_status || EMPLOYMENT_STATUSES[0],
    etu: professor?.etu ?? 0,
    specializations: professor?.specializations || [],
    availability: professor?.availability || [],
  });

  const [specOpen, setSpecOpen] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function stepEtu(dir) {
    setForm((prev) => ({
      ...prev,
      etu: Math.max(0, Math.min(24, prev.etu + dir)),
    }));
  }

  function toggleSpec(spec) {
    setForm((prev) => {
      const exists = prev.specializations.some(
        (s) => s.specialization_id === spec.specialization_id,
      );
      return {
        ...prev,
        specializations: exists
          ? prev.specializations.filter(
              (s) => s.specialization_id !== spec.specialization_id,
            )
          : [...prev.specializations, spec],
      };
    });
  }

  function toggleDay(day) {
    setForm((prev) => {
      const exists = prev.availability.some((a) => a.day_of_week === day);
      if (!exists && prev.availability.length >= 5) return prev;
      return {
        ...prev,
        availability: exists
          ? prev.availability.filter((a) => a.day_of_week !== day)
          : [
              ...prev.availability,
              { day_of_week: day, start_time: "00:00", end_time: "00:00" },
            ],
      };
    });
  }

  function setAvailTime(day, field, value) {
    setForm((prev) => ({
      ...prev,
      availability: prev.availability.map((a) =>
        a.day_of_week === day ? { ...a, [field]: value } : a,
      ),
    }));
  }

  // Validation
  const REQUIRED_FIELDS = [
    { field: "first_name", label: "First name" },
    { field: "last_name", label: "Last name" },
    { field: "employee_num", label: "Employee number" },
    { field: "birth_date", label: "Date of birth" },
    { field: "degree", label: "Highest Degree Attained" },
    { field: "date_of_first_appointment", label: "Date of First Appointment" },
  ];

  const fieldErrors = {};
  for (const { field, label } of REQUIRED_FIELDS) {
    if (!String(form[field] ?? "").trim())
      fieldErrors[field] = `${label} is required.`;
  }
  if (form.specializations.length === 0)
    fieldErrors.specializations = "Select at least one specialization.";
  if (form.availability.length === 0)
    fieldErrors.availability = "Select at least one available day.";

  const isValid = Object.keys(fieldErrors).length === 0;

  function err(field) {
    return submitAttempted && fieldErrors[field];
  }

  function handleSubmit() {
    setSubmitAttempted(true);
    if (!isValid) return;
    onSave({
      ...form,
      first_name: form.first_name.toUpperCase().trim(),
      middle_name: form.middle_name.toUpperCase().trim(),
      last_name: form.last_name.toUpperCase().trim(),
      degree: form.degree.trim(),
      etu: Number(form.etu),
    });
  }

  const showTimeWheel =
    form.availability.length > 0 && form.employment_status !== "Regular";

  return (
    <div className="pmod-overlay" onClick={onClose}>
      <div className="pmod-box" onClick={(e) => e.stopPropagation()}>
        <div className="pmod-header">
          <div className="pmod-title">
            {professor ? "Edit Professor" : "Add Professor"}
          </div>
          <button className="pmod-close" onClick={onClose}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        <div className="pmod-body">
          {/* Error summary — shown after submit attempt */}
          {submitAttempted && !isValid && (
            <div className="pmod-error-summary">
              <i className="ti ti-alert-circle" />
              <div>
                <div className="pmod-error-summary-title">
                  Please fill in all required fields:
                </div>
                <ul className="pmod-error-list">
                  {Object.values(fieldErrors).map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Personal Info */}
          <div className="pmod-section">
            <div className="pmod-section-label">Personal Information</div>
            <div className="pmod-row3">
              <div className="pmod-field">
                <label>
                  First name <span className="pmod-req">*</span>
                </label>
                <input
                  value={form.first_name}
                  onChange={(e) =>
                    handleChange("first_name", e.target.value.toUpperCase())
                  }
                  placeholder="FIRST NAME"
                  className={`pmod-input ${err("first_name") ? "pmod-input-error" : ""}`}
                />
                {err("first_name") && (
                  <span className="pmod-field-error">{err("first_name")}</span>
                )}
              </div>
              <div className="pmod-field">
                <label>
                  Middle name{" "}
                  <span className="pmod-optional-label">(optional)</span>
                </label>
                <input
                  value={form.middle_name}
                  onChange={(e) =>
                    handleChange("middle_name", e.target.value.toUpperCase())
                  }
                  placeholder="MIDDLE NAME"
                  className="pmod-input"
                />
              </div>
              <div className="pmod-field">
                <label>
                  Last name <span className="pmod-req">*</span>
                </label>
                <input
                  value={form.last_name}
                  onChange={(e) =>
                    handleChange("last_name", e.target.value.toUpperCase())
                  }
                  placeholder="LAST NAME"
                  className={`pmod-input ${err("last_name") ? "pmod-input-error" : ""}`}
                />
                {err("last_name") && (
                  <span className="pmod-field-error">{err("last_name")}</span>
                )}
              </div>
            </div>
            <div className="pmod-row2">
              <div className="pmod-field">
                <label>
                  Employee number <span className="pmod-req">*</span>
                </label>

                <input
                  value={form.employee_num}
                  onChange={(e) => handleChange("employee_num", e.target.value)}
                  placeholder="e.g. 20901234"
                  className={`pmod-input ${
                    err("employee_num") || error ? "pmod-input-error" : ""
                  }`}
                />

                {err("employee_num") && (
                  <span className="pmod-field-error">
                    {err("employee_num")}
                  </span>
                )}

                {!err("employee_num") && error && (
                  <span className="pmod-field-error">{error}</span>
                )}
              </div>
              <div className="pmod-field">
                <label>
                  Date of birth <span className="pmod-req">*</span>
                </label>
                <input
                  type="date"
                  value={form.birth_date}
                  onChange={(e) => handleChange("birth_date", e.target.value)}
                  className={`pmod-input ${err("birth_date") ? "pmod-input-error" : ""}`}
                />
                {err("birth_date") && (
                  <span className="pmod-field-error">{err("birth_date")}</span>
                )}
                {form.birth_date && !err("birth_date") && (
                  <span className="pmod-age-hint">
                    Age: {calcAge(form.birth_date)} years old
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Employment */}
          <div className="pmod-section">
            <div className="pmod-section-label">Employment</div>
            <div className="pmod-row2">
              <div className="pmod-field">
                <label>Employment status</label>
                <select
                  value={form.employment_status}
                  onChange={(e) =>
                    handleChange("employment_status", e.target.value)
                  }
                  className="pmod-select"
                >
                  {EMPLOYMENT_STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="pmod-field">
                <label>
                  Highest Degree Attained <span className="pmod-req">*</span>
                </label>
                <select
                  value={form.degree}
                  onChange={(e) => handleChange("degree", e.target.value)}
                  className={`pmod-select ${err("degree") ? "pmod-input-error" : ""}`}
                >
                  <option value="">— Select degree —</option>
                  {HIGHEST_DEGREES.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                {err("degree") && (
                  <span className="pmod-field-error">{err("degree")}</span>
                )}
              </div>
            </div>
            <div className="pmod-row2">
              <div className="pmod-field">
                <label>
                  Date of First Appointment <span className="pmod-req">*</span>
                </label>
                <input
                  type="date"
                  value={form.date_of_first_appointment}
                  onChange={(e) =>
                    handleChange("date_of_first_appointment", e.target.value)
                  }
                  className={`pmod-input ${err("date_of_first_appointment") ? "pmod-input-error" : ""}`}
                />
                {err("date_of_first_appointment") && (
                  <span className="pmod-field-error">
                    {err("date_of_first_appointment")}
                  </span>
                )}
              </div>
              <div className="pmod-field">
                <label>ETU (Equivalent Teaching Unit)</label>
                <div className="pmod-stepper">
                  <button
                    type="button"
                    className="pmod-step-btn"
                    onClick={() => stepEtu(-1)}
                    disabled={form.etu <= 0}
                  >
                    <i className="ti ti-minus" />
                  </button>
                  <input
                    type="number"
                    value={form.etu}
                    onChange={(e) =>
                      handleChange(
                        "etu",
                        Math.max(0, Math.min(24, +e.target.value)),
                      )
                    }
                    className="pmod-step-input"
                    min={0}
                    max={24}
                  />
                  <button
                    type="button"
                    className="pmod-step-btn"
                    onClick={() => stepEtu(1)}
                    disabled={form.etu >= 24}
                  >
                    <i className="ti ti-plus" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Specializations */}
          <div className="pmod-section">
            <div className="pmod-section-label">
              Areas of Specialization <span className="pmod-req">*</span>
            </div>
            <div className="pmod-field">
              <div className="pmod-multi-dd">
                <button
                  type="button"
                  className={`pmod-dd-trigger ${specOpen ? "pmod-dd-open" : ""} ${err("specializations") ? "pmod-input-error" : ""}`}
                  onClick={() => setSpecOpen((o) => !o)}
                >
                  <span>
                    {form.specializations.length > 0
                      ? form.specializations
                          .map((s) => s.specialization_name)
                          .join(", ")
                      : "Select specializations…"}
                  </span>
                  <i className="ti ti-chevron-down" />
                </button>
                {specOpen && (
                  <div className="pmod-dd-list">
                    {specializations.length === 0 ? (
                      <div className="pmod-dd-empty">
                        No specializations available.
                      </div>
                    ) : (
                      specializations.map((spec) => (
                        <label
                          key={spec.specialization_id}
                          className="pmod-dd-item"
                        >
                          <input
                            type="checkbox"
                            checked={form.specializations.some(
                              (s) =>
                                s.specialization_id === spec.specialization_id,
                            )}
                            onChange={() => toggleSpec(spec)}
                            className="pmod-chk"
                          />
                          {spec.specialization_name}
                        </label>
                      ))
                    )}
                  </div>
                )}
              </div>
              {err("specializations") && (
                <span className="pmod-field-error">
                  {err("specializations")}
                </span>
              )}
              {form.specializations.length > 0 && (
                <div className="pmod-chips">
                  {form.specializations.map((s) => (
                    <span key={s.specialization_id} className="pmod-chip">
                      {s.specialization_name}
                      <button
                        type="button"
                        className="pmod-chip-remove"
                        onClick={() => toggleSpec(s)}
                      >
                        <i className="ti ti-x" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Time of Availability */}
          <div className="pmod-section">
            <div className="pmod-section-label">
              Time of Availability
              <span className="pmod-optional"> — max 5 days, ideal 4</span>
              <span className="pmod-req"> *</span>
            </div>
            <div className="pmod-day-group">
              {DAYS_OF_WEEK.map((day) => {
                const checked = form.availability.some(
                  (a) => a.day_of_week === day,
                );
                const disabled = !checked && form.availability.length >= 5;
                return (
                  <button
                    key={day}
                    type="button"
                    className={`pmod-day-btn ${checked ? "pmod-day-checked" : ""} ${disabled ? "pmod-day-disabled" : ""}`}
                    onClick={() => !disabled && toggleDay(day)}
                    disabled={disabled}
                  >
                    {day.slice(0, 3)}
                  </button>
                );
              })}
            </div>
            {err("availability") && (
              <span className="pmod-field-error">{err("availability")}</span>
            )}

            {showTimeWheel && (
              <div className="pmod-time-block">
                <div className="pmod-time-label">
                  Available time window (per day)
                </div>
                {form.availability.map((a) => {
                  const start24 = to24h(a.start_time || "00:00");
                  const end24 = to24h(a.end_time || "00:00");
                  const [startH, startM] = start24.includes(":")
                    ? start24.split(":")
                    : ["00", "00"];
                  const [endH, endM] = end24.includes(":")
                    ? end24.split(":")
                    : ["00", "00"];
                  const hours = Array.from({ length: 24 }, (_, i) =>
                    String(i).padStart(2, "0"),
                  );
                  const minutes = [
                    "00",
                    "05",
                    "10",
                    "15",
                    "20",
                    "25",
                    "30",
                    "35",
                    "40",
                    "45",
                    "50",
                    "55",
                  ];
                  return (
                    <div key={a.day_of_week} className="pmod-time-row">
                      <span className="pmod-day-label">
                        {a.day_of_week.slice(0, 3)}
                      </span>
                      <div className="pmod-time-wheel">
                        <select
                          className="pmod-time-sel"
                          value={startH}
                          onChange={(e) =>
                            setAvailTime(
                              a.day_of_week,
                              "start_time",
                              `${e.target.value}:${startM}`,
                            )
                          }
                        >
                          {hours.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                        <span className="pmod-time-colon">:</span>
                        <select
                          className="pmod-time-sel pmod-time-sel-min"
                          value={startM}
                          onChange={(e) =>
                            setAvailTime(
                              a.day_of_week,
                              "start_time",
                              `${startH}:${e.target.value}`,
                            )
                          }
                        >
                          {minutes.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>
                      <span className="pmod-time-sep">to</span>
                      <div className="pmod-time-wheel">
                        <select
                          className="pmod-time-sel"
                          value={endH}
                          onChange={(e) =>
                            setAvailTime(
                              a.day_of_week,
                              "end_time",
                              `${e.target.value}:${endM}`,
                            )
                          }
                        >
                          {hours.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                        <span className="pmod-time-colon">:</span>
                        <select
                          className="pmod-time-sel pmod-time-sel-min"
                          value={endM}
                          onChange={(e) =>
                            setAvailTime(
                              a.day_of_week,
                              "end_time",
                              `${endH}:${e.target.value}`,
                            )
                          }
                        >
                          {minutes.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="pmod-footer">
          <button className="pmod-cancel" onClick={onClose}>
            Cancel
          </button>
          <button className="pmod-save" onClick={handleSubmit}>
            <i className="ti ti-device-floppy" />
            {professor ? "Save changes" : "Add professor"}
          </button>
        </div>
      </div>
    </div>
  );
}
