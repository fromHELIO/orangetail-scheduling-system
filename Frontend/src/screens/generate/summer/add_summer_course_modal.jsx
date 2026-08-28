import { useState } from "react";
import { supabase } from "../../../lib/supabaseClient";
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

export default function AddSummerCourseModal({
  open,
  onClose,
  session,
  professors,
  rooms,
  allCourses,
  onSaved,
}) {
  const [courseSearch, setCourseSearch] = useState("");
  const [entries, setEntries] = useState([blankEntry()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  function getUsername() {
    return (
      JSON.parse(localStorage.getItem("user") || "{}").username || "unknown"
    );
  }
  function blankEntry() {
    return {
      course_id: "",
      professor_id: "",
      room_id: "",
      lec_single: true,
      lec_pair: 0,
      lec_day: "Monday",
      start_h: "00",
      start_m: "00",
      end_h: "00",
      end_m: "00",
      conflicts: { hard: [], soft: [] },
    };
  }

  function toMinutes(t) {
    if (!t) return 0;
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  }

  async function checkConflicts() {
    const updated = await Promise.all(
      entries.map(async (e) => {
        const hard = [],
          soft = [];
        if (!e.course_id) return { ...e, conflicts: { hard, soft } };

        const start_time = `${e.start_h}:${e.start_m}`;
        const end_time = `${e.end_h}:${e.end_m}`;
        const isSingle = e.lec_single ?? true;
        const days = isSingle
          ? [e.lec_day || "Monday"]
          : LECTURE_PAIRS[e.lec_pair ?? 0].days;
        const startMin = toMinutes(start_time);
        const endMin = toMinutes(end_time);

        for (const day of days) {
          // Get all slots on this day
          const { data: daySlots } = await supabase
            .from("time_slots")
            .select("slot_id, start_time, end_time")
            .eq("day", day);
          const overlappingSlotIds = (daySlots || [])
            .filter(
              (t) =>
                toMinutes(t.start_time) < endMin &&
                toMinutes(t.end_time) > startMin,
            )
            .map((t) => t.slot_id);

          if (!overlappingSlotIds.length) continue;

          if (e.professor_id) {
            const { data } = await supabase
              .from("schedules")
              .select("schedule_id")
              .eq("professor_id", e.professor_id)
              .in("slot_id", overlappingSlotIds)
              .limit(1);
            if (data?.length > 0)
              hard.push(`Professor has an overlapping class on ${day}.`);
          }
          if (e.room_id) {
            const { data } = await supabase
              .from("schedules")
              .select("schedule_id")
              .eq("room_id", e.room_id)
              .in("slot_id", overlappingSlotIds)
              .limit(1);
            if (data?.length > 0)
              hard.push(`Room has an overlapping class on ${day}.`);
          }
        }

        // Intra-batch: check against other entries
        entries.forEach((other) => {
          if (other === e || !other.course_id) return;
          const oStart = `${other.start_h}:${other.start_m}`;
          const oEnd = `${other.end_h}:${other.end_m}`;
          const oDays =
            (other.lec_single ?? true)
              ? [other.lec_day || "Monday"]
              : LECTURE_PAIRS[other.lec_pair ?? 0].days;
          const overlappingDays = days.filter((d) => oDays.includes(d));
          if (!overlappingDays.length) return;
          const overlaps =
            toMinutes(start_time) < toMinutes(oEnd) &&
            toMinutes(end_time) > toMinutes(oStart);
          if (!overlaps) return;
          if (e.professor_id && e.professor_id === other.professor_id)
            hard.push(
              "Same professor has an overlapping course in this batch.",
            );
          if (e.room_id && e.room_id === other.room_id)
            hard.push("Same room has an overlapping course in this batch.");
        });

        return { ...e, conflicts: { hard: [...new Set(hard)], soft } };
      }),
    );
    setEntries(updated);
    return updated;
  }

  if (!open || !session) return null;

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

  function updateEntry(idx, field, val) {
    setEntries((prev) =>
      prev.map((e, i) =>
        i === idx
          ? { ...e, [field]: val, conflicts: { hard: [], soft: [] } }
          : e,
      ),
    );
    setError("");
  }

  function addEntry() {
    setEntries((prev) => [...prev, blankEntry()]);
  }

  function removeEntry(idx) {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    const valid = entries.filter((e) => e.course_id);
    if (!valid.length) {
      setError("Add at least one course.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // Run conflict check first
      const checked = await checkConflicts();
      const hasHard = checked.some((e) => e.conflicts?.hard?.length > 0);
      if (hasHard) {
        setSaving(false);
        return;
      }
      const schoolYear = session.school_year;
      const generatedAt = session.generated_at;

      for (const e of valid) {
        const start_time = `${e.start_h}:${e.start_m}`;
        const end_time = `${e.end_h}:${e.end_m}`;
        const days = e.lec_single
          ? [e.lec_day || "Monday"]
          : LECTURE_PAIRS[e.lec_pair ?? 0].days;
        const course = allCourses.find(
          (c) => c.course_id === Number(e.course_id),
        );

        // Get or create offering
        const { data: existing } = await supabase
          .from("class_offerings")
          .select("offering_id")
          .eq("course_id", e.course_id)
          .eq("school_year", schoolYear)
          .eq("semester", 3)
          .maybeSingle();
        let offeringId = existing?.offering_id;
        if (!offeringId) {
          const yrShort = schoolYear.replace(/20(\d{2})-20(\d{2})/, "$1$2");
          const { data: newOff, error: offErr } = await supabase
            .from("class_offerings")
            .insert({
              class_code: `${course?.course_code || e.course_id}-SUM-${yrShort}`,
              course_id: Number(e.course_id),
              school_year: schoolYear,
              semester: 3,
            })
            .select()
            .single();
          if (offErr) throw offErr;
          offeringId = newOff.offering_id;
        }

        // Insert schedule rows
        for (const day of days) {
          const { data: slotData } = await supabase
            .from("time_slots")
            .select("slot_id")
            .eq("day", day)
            .eq("start_time", start_time)
            .eq("end_time", end_time)
            .maybeSingle();
          let slotId = slotData?.slot_id;
          if (!slotId) {
            const { data: newSlot, error: slotErr } = await supabase
              .from("time_slots")
              .insert({ day, start_time, end_time })
              .select("slot_id")
              .single();
            if (slotErr) throw slotErr;
            slotId = newSlot.slot_id;
          }
          await supabase.from("schedules").insert({
            offering_id: offeringId,
            professor_id: e.professor_id ? Number(e.professor_id) : null,
            room_id: e.room_id ? Number(e.room_id) : null,
            slot_id: slotId,
            status: "Draft",
            generated_at: generatedAt,
          });
        }
      }

      // If session was Approved, revert to Draft since new unapproved courses were added
      if (session.status === "Approved") {
        const allSessionScheduleIds =
          session.sections
            ?.flatMap((s) => s.schedules?.map((sc) => sc.schedule_id) || [])
            .filter(Boolean) || [];
        if (allSessionScheduleIds.length > 0) {
          await supabase
            .from("schedules")
            .update({ status: "Draft" })
            .in("schedule_id", allSessionScheduleIds);
        }
      }

      await supabase.from("change_log").insert({
        action: "Added summer courses",
        entity: session.school_year,
        details: `${valid.length} course(s) added to Summer session${session.status === "Approved" ? " — session reverted to Draft" : ""}`,
        performed_by: getUsername(),
      });

      setEntries([blankEntry()]);
      onSaved();
    } catch (err) {
      console.error(err);
      setError(err.message || "Save failed. Please try again.");
    }
    setSaving(false);
  }

  return (
    <div className="csm-overlay" onClick={onClose}>
      <div className="csm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="csm-header">
          <div>
            <div className="csm-title">Add Course to Summer</div>
            <div className="csm-sub">{session.school_year} · Summer</div>
          </div>
          <button className="csm-close" onClick={onClose}>
            <i className="ti ti-x" />
          </button>
        </div>

        <div className="csm-body">
          {error && (
            <div className="csm-conflict-hard">
              <i className="ti ti-alert-circle" />
              {error}
            </div>
          )}

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
                      onClick={() => removeEntry(idx)}
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
                      updateEntry(idx, "course_id", ev.target.value)
                    }
                  >
                    <option value="">— Select major course —</option>
                    {filteredCourses.map((c) => (
                      <option key={c.course_id} value={c.course_id}>
                        {c.course_code} — {c.course_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="csm-grid2">
                  <div className="csm-field">
                    <label>Professor</label>
                    <select
                      className="csm-select"
                      value={e.professor_id}
                      onChange={(ev) =>
                        updateEntry(idx, "professor_id", ev.target.value)
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
                        updateEntry(idx, "room_id", ev.target.value)
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

                <div className="csm-field">
                  <label>
                    Day & time <span className="csm-req">*</span>
                  </label>
                  <div className="csm-pair-btns">
                    <button
                      type="button"
                      className={`csm-pair-btn ${!isSingle ? "csm-pair-btn-active" : ""}`}
                      onClick={() => updateEntry(idx, "lec_single", false)}
                    >
                      <i className="ti ti-calendar-week" /> Paired days
                    </button>
                    <button
                      type="button"
                      className={`csm-pair-btn ${isSingle ? "csm-pair-btn-active" : ""}`}
                      onClick={() => updateEntry(idx, "lec_single", true)}
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
                            onClick={() => updateEntry(idx, "lec_pair", pi)}
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
                        start_h={e.start_h}
                        start_m={e.start_m}
                        end_h={e.end_h}
                        end_m={e.end_m}
                        hideDay
                        onChange={(field, val) => updateEntry(idx, field, val)}
                      />
                      <div className="csm-pair-days-note">
                        <i className="ti ti-info-circle" />
                        Schedules on both{" "}
                        <strong>
                          {LECTURE_PAIRS[pairIdx].days[0]}
                        </strong> and{" "}
                        <strong>{LECTURE_PAIRS[pairIdx].days[1]}</strong> at the
                        same time
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
                          onClick={() => updateEntry(idx, "lec_day", day)}
                        >
                          {day.slice(0, 3)}
                        </button>
                      ))}
                    </div>
                    <TimeWheel
                      day={singleDay}
                      start_h={e.start_h}
                      start_m={e.start_m}
                      end_h={e.end_h}
                      end_m={e.end_m}
                      hideDay
                      onChange={(field, val) => updateEntry(idx, field, val)}
                    />
                  </div>
                )}
              </div>
            );
          })}

          <button className="csm-add-btn" onClick={addEntry}>
            <i className="ti ti-plus" /> Add another course
          </button>
        </div>

        <div className="csm-footer">
          <button className="csm-cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="csm-save-btn"
            disabled={
              saving || entries.some((e) => e.conflicts?.hard?.length > 0)
            }
            onClick={handleSave}
          >
            {saving ? (
              "Saving..."
            ) : (
              <>
                <i className="ti ti-device-floppy" /> Save courses
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
