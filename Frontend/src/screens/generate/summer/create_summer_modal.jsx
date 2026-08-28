import { useState } from "react";
import TimeWheel from "../time/time_wheel";
import "./create_summer_modal.css";

const LECTURE_PAIRS = [
  { label: "Mon / Thu", days: ["Monday", "Thursday"] },
  { label: "Tue / Fri", days: ["Tuesday", "Friday"] },
  { label: "Wed / Sat", days: ["Wednesday", "Saturday"] },
];
const ALL_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export default function CreateSummerModal({
  open,
  onClose,
  schoolYearStart,
  schoolYearEnd,
  step,
  setStep,
  entries,
  onAdd,
  onRemove,
  onUpdate,
  professors,
  rooms,
  allCourses,
  onCheckConflicts,
  onSave,
  saving,
}) {
  const [courseSearch, setCourseSearch] = useState("");

  if (!open) return null;

  const majorCourses = allCourses.filter((c) =>
    (c.course_code || "").startsWith("6"),
  );
  const filteredCourses = courseSearch
    ? majorCourses.filter(
        (c) =>
          c.course_code.toLowerCase().includes(courseSearch.toLowerCase()) ||
          c.course_name.toLowerCase().includes(courseSearch.toLowerCase()),
      )
    : majorCourses;

  const steps = ["Add courses", "Review & save"];

  return (
    <div className="csm-overlay" onClick={onClose}>
      <div className="csm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="csm-header">
          <div>
            <div className="csm-title">Create Summer Schedule</div>
            <div className="csm-sub">
              {schoolYearStart}–{schoolYearEnd} · Summer — saved as Draft,
              approve to finalize
            </div>
          </div>
          <button className="csm-close" onClick={onClose}>
            <i className="ti ti-x" />
          </button>
        </div>

        <div className="csm-steps">
          {steps.map((label, i) => (
            <div key={i} className="csm-step">
              <div
                className={`csm-step-num ${step === i + 1 ? "active" : step > i + 1 ? "done" : ""}`}
              >
                {step > i + 1 ? <i className="ti ti-check" /> : i + 1}
              </div>
              <span
                className={`csm-step-label ${step === i + 1 ? "active" : ""}`}
              >
                {label}
              </span>
              {i < steps.length - 1 && <div className="csm-step-line" />}
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="csm-body">
            {entries.map((e, idx) => {
              const isSingle = e.lec_single ?? true;
              const pairIdx = e.lec_pair ?? 0;
              const singleDay = e.lec_day ?? "Monday";
              return (
                <div key={idx} className="csm-entry">
                  <div className="csm-entry-head">
                    <span className="csm-entry-label">Course {idx + 1}</span>
                    {entries.length > 1 && (
                      <button
                        className="csm-remove-btn"
                        onClick={() => onRemove(idx)}
                      >
                        <i className="ti ti-trash" />
                      </button>
                    )}
                  </div>

                  {e.conflicts?.hard?.length > 0 && (
                    <div className="csm-conflict-hard">
                      <i className="ti ti-alert-circle" />
                      {e.conflicts.hard[0]}
                    </div>
                  )}
                  {e.conflicts?.soft?.length > 0 && (
                    <div className="csm-conflict-soft">
                      <i className="ti ti-alert-triangle" />
                      {e.conflicts.soft[0]}
                    </div>
                  )}

                  <div className="csm-field">
                    <label>
                      Course <span className="csm-req">*</span>
                    </label>
                    <div className="csm-course-search-wrap">
                      <i className="ti ti-search csm-course-search-icon" />
                      <input
                        className="csm-course-search-input"
                        placeholder="Search major courses..."
                        value={courseSearch}
                        onChange={(ev) => setCourseSearch(ev.target.value)}
                      />
                      {courseSearch && (
                        <button
                          className="csm-course-search-clear"
                          onClick={() => setCourseSearch("")}
                        >
                          <i className="ti ti-x" />
                        </button>
                      )}
                    </div>
                    <select
                      className="csm-select"
                      value={e.course_id}
                      onChange={(ev) =>
                        onUpdate(idx, "course_id", ev.target.value)
                      }
                    >
                      <option value="">— Select major course —</option>
                      {filteredCourses.map((c) => (
                        <option key={c.course_id} value={c.course_id}>
                          {c.course_code} — {c.course_name}
                        </option>
                      ))}
                    </select>
                    {filteredCourses.length === 0 && courseSearch && (
                      <div className="csm-course-no-results">
                        No courses match "{courseSearch}"
                      </div>
                    )}
                  </div>

                  <div className="csm-grid2">
                    <div className="csm-field">
                      <label>Professor</label>
                      <select
                        className="csm-select"
                        value={e.professor_id}
                        onChange={(ev) =>
                          onUpdate(idx, "professor_id", ev.target.value)
                        }
                      >
                        <option value="">— Unassigned —</option>
                        {professors.map((p) => (
                          <option key={p.professor_id} value={p.professor_id}>
                            {p.last_name}, {p.first_name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="csm-field">
                      <label>Room</label>
                      <select
                        className="csm-select"
                        value={e.room_id}
                        onChange={(ev) =>
                          onUpdate(idx, "room_id", ev.target.value)
                        }
                      >
                        <option value="">— No room —</option>
                        {rooms.map((r) => (
                          <option key={r.room_id} value={r.room_id}>
                            {r.room_name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Day type selector */}
                  <div className="csm-field">
                    <label>
                      Day & time <span className="csm-req">*</span>
                    </label>
                    <div className="csm-pair-btns">
                      <button
                        type="button"
                        className={`csm-pair-btn ${!isSingle ? "csm-pair-btn-active" : ""}`}
                        onClick={() => onUpdate(idx, "lec_single", false)}
                      >
                        <i className="ti ti-calendar-week" /> Paired days
                      </button>
                      <button
                        type="button"
                        className={`csm-pair-btn ${isSingle ? "csm-pair-btn-active" : ""}`}
                        onClick={() => onUpdate(idx, "lec_single", true)}
                      >
                        <i className="ti ti-calendar-event" /> Single day
                      </button>
                    </div>
                  </div>

                  {!isSingle && (
                    <>
                      <div className="csm-field">
                        <label>Day pair</label>
                        <div className="csm-pair-btns">
                          {LECTURE_PAIRS.map((pair, pi) => (
                            <button
                              key={pi}
                              type="button"
                              className={`csm-pair-btn ${pairIdx === pi ? "csm-pair-btn-active" : ""}`}
                              onClick={() => onUpdate(idx, "lec_pair", pi)}
                            >
                              {pair.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="csm-field">
                        <label>Time</label>
                        <TimeWheel
                          day={LECTURE_PAIRS[pairIdx].days[0]}
                          start_h={e.start_h || "00"}
                          start_m={e.start_m || "00"}
                          end_h={e.end_h || "00"}
                          end_m={e.end_m || "00"}
                          hideDay
                          onChange={(field, val) => onUpdate(idx, field, val)}
                        />
                        <div className="csm-pair-days-note">
                          <i className="ti ti-info-circle" />
                          Schedules on both{" "}
                          <strong>
                            {LECTURE_PAIRS[pairIdx].days[0]}
                          </strong> and{" "}
                          <strong>{LECTURE_PAIRS[pairIdx].days[1]}</strong> at
                          the same time
                        </div>
                      </div>
                    </>
                  )}

                  {isSingle && (
                    <div className="csm-field">
                      <label>Day</label>
                      <div className="csm-day-btns">
                        {ALL_DAYS.map((day) => (
                          <button
                            key={day}
                            type="button"
                            className={`csm-day-btn ${singleDay === day ? "csm-day-btn-active" : ""}`}
                            onClick={() => onUpdate(idx, "lec_day", day)}
                          >
                            {day.slice(0, 3)}
                          </button>
                        ))}
                      </div>
                      <TimeWheel
                        day={singleDay}
                        start_h={e.start_h || "00"}
                        start_m={e.start_m || "00"}
                        end_h={e.end_h || "00"}
                        end_m={e.end_m || "00"}
                        hideDay
                        onChange={(field, val) => onUpdate(idx, field, val)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            <button className="csm-add-btn" onClick={onAdd}>
              <i className="ti ti-plus" /> Add another course
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="csm-body">
            {entries
              .filter(
                (e) =>
                  e.course_id &&
                  (e.lec_single ? e.lec_day : e.lec_pair !== undefined),
              )
              .map((e, idx) => {
                const course = allCourses.find(
                  (c) => String(c.course_id) === String(e.course_id),
                );
                const prof = professors.find(
                  (p) => String(p.professor_id) === String(e.professor_id),
                );
                const room = rooms.find(
                  (r) => String(r.room_id) === String(e.room_id),
                );
                const isSingle = e.lec_single ?? true;
                const days = isSingle
                  ? [e.lec_day || "Monday"]
                  : LECTURE_PAIRS[e.lec_pair ?? 0].days;
                const timeLabel = `${e.start_h}:${e.start_m}–${e.end_h}:${e.end_m}`;
                const slotLabel = `${days.join(" & ")} ${timeLabel}`;
                const hasHard = e.conflicts?.hard?.length > 0;
                return (
                  <div
                    key={idx}
                    className={`csm-review-row ${hasHard ? "csm-review-row-error" : ""}`}
                  >
                    <div className="csm-review-course">
                      <span className="csm-course-code">
                        {course?.course_code}
                      </span>
                      <span className="csm-course-name">
                        {course?.course_name}
                      </span>
                    </div>
                    <div className="csm-review-details">
                      <span>
                        <i className="ti ti-user" />{" "}
                        {prof
                          ? `${prof.last_name}, ${prof.first_name}`
                          : "Unassigned"}
                      </span>
                      <span>
                        <i className="ti ti-building" />{" "}
                        {room?.room_name || "No room"}
                      </span>
                      <span>
                        <i className="ti ti-clock" /> {slotLabel}
                      </span>
                    </div>
                    {hasHard && (
                      <div className="csm-conflict-hard sm">
                        <i className="ti ti-alert-circle" />
                        {e.conflicts.hard[0]}
                      </div>
                    )}
                    {!hasHard && e.conflicts?.soft?.length > 0 && (
                      <div className="csm-conflict-soft sm">
                        <i className="ti ti-alert-triangle" />
                        {e.conflicts.soft[0]}
                      </div>
                    )}
                  </div>
                );
              })}
            {entries.filter((e) => !e.course_id).length > 0 && (
              <div className="csm-skipped">
                {entries.filter((e) => !e.course_id).length} incomplete{" "}
                {entries.filter((e) => !e.course_id).length === 1
                  ? "entry"
                  : "entries"}{" "}
                will be skipped.
              </div>
            )}
            <div className="csm-note">
              <i className="ti ti-info-circle" />
              Saved as <strong>Draft</strong>. Approve the session to finalize.
            </div>
          </div>
        )}

        <div className="csm-footer">
          <button
            className="csm-cancel-btn"
            onClick={() => {
              if (step === 1) onClose();
              else setStep(1);
            }}
          >
            {step === 1 ? (
              "Cancel"
            ) : (
              <>
                <i className="ti ti-chevron-left" /> Back
              </>
            )}
          </button>
          {step === 1 && (
            <button
              className="csm-next-btn"
              disabled={entries.every((e) => !e.course_id)}
              onClick={async () => {
                await onCheckConflicts();
                setStep(2);
              }}
            >
              Check conflicts & review <i className="ti ti-chevron-right" />
            </button>
          )}
          {step === 2 && (
            <button
              className="csm-save-btn"
              disabled={
                saving || entries.some((e) => e.conflicts?.hard?.length > 0)
              }
              onClick={onSave}
            >
              {saving ? (
                "Saving..."
              ) : (
                <>
                  <i className="ti ti-device-floppy" /> Save as Draft
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
