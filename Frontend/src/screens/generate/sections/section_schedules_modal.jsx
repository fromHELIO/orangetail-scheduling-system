import { useState, useMemo } from "react";
import { supabase } from "../../../lib/supabaseClient";
import {
  SCHEDULE_SELECT,
  flattenSchedule,
  HOURS,
  MINUTES,
  DAYS_OF_WEEK,
} from "../generate_utils";
import "./section_schedules_modal.css";

const DAY_ORDER = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function normalizeDay(d) {
  if (!d) return "";
  const val = d.toLowerCase().trim();
  // Match full name (e.g. "monday") or abbreviation (e.g. "mon")
  return (
    DAY_ORDER.find(
      (day) => day.toLowerCase() === val || day.toLowerCase().startsWith(val),
    ) || d
  ); // fall back to original value if no match
}

function toMin(t) {
  // Handles "HH:MM", "H:MM", "HH:MM:SS" from postgres
  if (!t) return 0;
  const p = t.split(":");
  return parseInt(p[0], 10) * 60 + parseInt(p[1] || "0", 10);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  // True if two time ranges overlap (not just touch)
  return aStart < bEnd && aEnd > bStart;
}

export default function SectionSchedulesModal({
  section,
  session,
  getSemesterLabel,
  professors,
  rooms,
  onClose,
  onUpdated,
}) {
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [editForm, setEditForm] = useState({
    professor_id: null,
    room_id: null,
    day: "Monday",
    start_h: "07",
    start_m: "30",
    end_h: "09",
    end_m: "00",
  });
  const [editError, setEditError] = useState("");
  const [conflictWarning, setConflictWarning] = useState(null);
  const [saving, setSaving] = useState(false);

  const isApproved = session?.status === "Approved";
  const schedules = section?.schedules || [];

  function getRoomName(sched) {
    if (sched.room_name) return sched.room_name;

    if (sched.room_id) {
      const room = rooms.find(
        (r) => Number(r.room_id) === Number(sched.room_id),
      );

      if (room) return room.room_name;
    }

    return "TBA";
  }

  const sortedSchedules = useMemo(() => {
    return [...(section?.schedules || [])].sort((a, b) => {
      const ai = normalizeDay(a.day)
        ? DAY_ORDER.indexOf(normalizeDay(a.day))
        : 99;
      const bi = normalizeDay(b.day)
        ? DAY_ORDER.indexOf(normalizeDay(b.day))
        : 99;
      if (ai !== bi) return ai - bi;
      return toMin(a.start_time) - toMin(b.start_time);
    });
  }, [section]);

  function openEdit(sched) {
    const [startH, startM] = (sched.start_time || "07:30")
      .split(":")
      .map((v) => v.padStart(2, "0"));
    const [endH, endM] = (sched.end_time || "09:00")
      .split(":")
      .map((v) => v.padStart(2, "0"));
    setEditingSchedule(sched);
    setEditForm({
      professor_id: sched.professor_id || null,
      room_id: sched.room_id || null,
      day: normalizeDay(sched.day) || "Monday",
      start_h: startH,
      start_m: startM,
      end_h: endH,
      end_m: endM,
    });
    setEditError("");
    setConflictWarning(null);
  }

  async function getOrCreateSlot(day, start_time, end_time) {
    const { data: existing } = await supabase
      .from("time_slots")
      .select("slot_id")
      .eq("day", day)
      .eq("start_time", start_time)
      .eq("end_time", end_time)
      .maybeSingle();
    if (existing) return existing.slot_id;
    const { data: newSlot, error } = await supabase
      .from("time_slots")
      .insert({ day, start_time, end_time })
      .select("slot_id")
      .single();
    if (error) throw error;
    return newSlot.slot_id;
  }

  // Pass professor_id and room_id explicitly to avoid stale closure
  async function checkConflicts(
    day,
    start_time,
    end_time,
    professor_id,
    room_id,
    excludeId,
  ) {
    const hard = [],
      soft = [];

    const newStart = toMin(start_time);
    const newEnd = toMin(end_time);
    const normDay = normalizeDay(day);

    // Fetch ALL time slots from DB (includes all days, all times)
    const { data: allSlots, error: slotErr } = await supabase
      .from("time_slots")
      .select("slot_id, day, start_time, end_time");

    if (slotErr) {
      console.error("slot fetch error", slotErr);
      return { hard, soft };
    }

    // Filter to slots on the same day
    const sameDay = (allSlots || []).filter(
      (s) => normalizeDay(s.day) === normDay,
    );

    // Find all slots that overlap with the new time range
    const overlappingIds = sameDay
      .filter((s) =>
        overlaps(newStart, newEnd, toMin(s.start_time), toMin(s.end_time)),
      )
      .map((s) => s.slot_id);
    // Hard conflict: same section already has a class during this time
    if (overlappingIds.length > 0) {
      const { data, error } = await supabase
        .from("schedules")
        .select(
          `
      schedule_id,
      offering_id,
      class_offerings!inner(section_id)
    `,
        )
        .in("slot_id", overlappingIds)
        .eq("class_offerings.section_id", section.section_id)
        .neq("schedule_id", excludeId);

      if (error) {
        console.error("section conflict error", error);
      }

      if (data?.length > 0) {
        hard.push("This section already has a class during this time.");
      }
    }

    // Hard conflict: professor booked in any overlapping slot
    if (professor_id && overlappingIds.length > 0) {
      const { data, error } = await supabase
        .from("schedules")
        .select("schedule_id, slot_id")
        .in("slot_id", overlappingIds)
        .eq("professor_id", professor_id)
        .neq("schedule_id", excludeId);
      if (error) console.error("prof conflict error", error);
      if (data?.length > 0)
        hard.push("Professor is already booked during this time.");
    }

    // Hard conflict: room booked in any overlapping slot
    if (room_id && overlappingIds.length > 0) {
      const { data, error } = await supabase
        .from("schedules")
        .select("schedule_id, slot_id")
        .in("slot_id", overlappingIds)
        .eq("room_id", room_id)
        .neq("schedule_id", excludeId);
      if (error) console.error("room conflict error", error);
      if (data?.length > 0)
        hard.push("Room is already booked during this time.");
    }

    // Soft conflict: professor has 3+ classes on this day (any time)
    if (professor_id) {
      const allDayIds = sameDay.map((s) => s.slot_id);
      if (allDayIds.length > 0) {
        const { data, error } = await supabase
          .from("schedules")
          .select("schedule_id")
          .in("slot_id", allDayIds)
          .eq("professor_id", professor_id)
          .neq("schedule_id", excludeId);
        if (error) console.error("soft conflict error", error);
        if ((data?.length || 0) >= 3)
          soft.push("Professor already has 3+ classes on this day.");
      }
    }

    return { hard, soft };
  }

  async function handleSave() {
    setSaving(true);
    setEditError("");
    setConflictWarning(null);
    try {
      const start_time = `${editForm.start_h}:${editForm.start_m}`;
      const end_time = `${editForm.end_h}:${editForm.end_m}`;

      if (toMin(end_time) <= toMin(start_time)) {
        setEditError("End time must be later than start time.");
        setSaving(false);
        return;
      }

      // Check conflicts BEFORE creating the slot, passing values explicitly
      const conflicts = await checkConflicts(
        editForm.day,
        start_time,
        end_time,
        editForm.professor_id,
        editForm.room_id,
        editingSchedule.schedule_id,
      );

      if (conflicts.hard.length > 0) {
        setConflictWarning(conflicts);
        setSaving(false);
        return;
      }
      if (conflicts.soft.length > 0) setConflictWarning(conflicts);

      // Create slot only after conflict check passes
      const slotId = await getOrCreateSlot(editForm.day, start_time, end_time);

      const { data, error } = await supabase
        .from("schedules")
        .update({
          professor_id: editForm.professor_id,
          room_id: editForm.room_id,
          slot_id: slotId,
        })
        .eq("schedule_id", editingSchedule.schedule_id)
        .select(SCHEDULE_SELECT)
        .single();

      if (error) {
        setEditError("Something went wrong. Please try again.");
        setSaving(false);
        return;
      }

      onUpdated(flattenSchedule(data));
      setEditingSchedule(null);
    } catch (err) {
      setEditError(err.message || "Something went wrong.");
    }
    setSaving(false);
  }

  if (!section) return null;

  return (
    <>
      {/* ── Main modal ── */}
      <div className="ssm-overlay" onClick={onClose}>
        <div className="ssm-modal" onClick={(e) => e.stopPropagation()}>
          <div className="ssm-header">
            <div>
              <div className="ssm-title">{section.section_name} Schedules</div>
              <div className="ssm-sub">
                {section.curriculum_label} · {session?.school_year} ·{" "}
                {getSemesterLabel(session?.semester)}
                {!isApproved && (
                  <span className="ssm-status-note ssm-status-draft">
                    {" "}
                    · Draft
                  </span>
                )}
                {isApproved && (
                  <span className="ssm-status-note ssm-status-approved">
                    {" "}
                    · Approved
                  </span>
                )}
              </div>
            </div>
            <button className="ssm-close" onClick={onClose}>
              <i className="ti ti-x" />
            </button>
          </div>

          <div className="ssm-body">
            {schedules.length === 0 ? (
              <div className="ssm-empty">
                No schedules found for this section.
              </div>
            ) : (
              <table className="ssm-table">
                <thead>
                  <tr>
                    <th>Course Code</th>
                    <th>Course Name</th>
                    <th>Professor</th>
                    <th>Room</th>
                    <th>Day & Time</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSchedules.map((sched, idx) => (
                    <tr
                      key={sched.schedule_id || `row-${idx}`}
                      className="ssm-row"
                      onClick={() => openEdit(sched)}
                    >
                      <td className="ssm-td-code">
                        {sched.course_code || "—"}
                      </td>
                      <td className="ssm-course-name">
                        {sched.course_name || "—"}
                      </td>
                      <td>
                        {sched.professor_name || (
                          <span className="ssm-unassigned">Unassigned</span>
                        )}
                      </td>
                      <td>
                        {getRoomName(sched) === "TBA" ? (
                          <span className="apm-tba">TBA</span>
                        ) : (
                          getRoomName(sched)
                        )}
                      </td>
                      <td>
                        <div className="ssm-day-time">
                          {sched.day && (
                            <span className="ssm-day-badge">
                              {(normalizeDay(sched.day) || sched.day).slice(
                                0,
                                3,
                              )}
                            </span>
                          )}
                          <span className="ssm-time-text">
                            {sched.start_time} – {sched.end_time}
                          </span>
                        </div>
                      </td>
                      <td>
                        <button
                          className="ssm-edit-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(sched);
                          }}
                        >
                          <i className="ti ti-edit" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* ── Edit modal ── */}
      {editingSchedule && (
        <div
          className="ssm-overlay ssm-overlay-top"
          onClick={() => setEditingSchedule(null)}
        >
          <div className="ssm-edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ssm-edit-header">
              <div>
                <div className="ssm-edit-title">Edit Schedule</div>
                <div className="ssm-edit-sub">
                  {editingSchedule.course_code} — {editingSchedule.course_name}
                </div>
              </div>
              <button
                className="ssm-close"
                onClick={() => setEditingSchedule(null)}
              >
                <i className="ti ti-x" />
              </button>
            </div>

            <div className="ssm-edit-body">
              <div className="ssm-current">
                <div className="ssm-current-label">Current assignment</div>
                <div className="ssm-current-row">
                  <span>
                    <i className="ti ti-user" />{" "}
                    {editingSchedule.professor_name || "Unassigned"}
                  </span>
                  <span>
                    <i className="ti ti-building" />{" "}
                    {getRoomName(editingSchedule)}{" "}
                  </span>
                  <span>
                    <i className="ti ti-clock" />{" "}
                    {normalizeDay(editingSchedule.day)}{" "}
                    {editingSchedule.start_time}–{editingSchedule.end_time}
                  </span>
                </div>
              </div>

              {editError && (
                <div className="ssm-edit-error">
                  <i className="ti ti-alert-circle" />
                  {editError}
                </div>
              )}

              {conflictWarning?.hard.length > 0 && (
                <div className="ssm-conflict-hard">
                  <i className="ti ti-alert-circle" />
                  <div>
                    <div className="ssm-conflict-label">
                      Hard conflict — cannot save
                    </div>
                    {conflictWarning.hard.map((c, i) => (
                      <div key={i}>{c}</div>
                    ))}
                  </div>
                </div>
              )}
              {conflictWarning?.soft.length > 0 &&
                !conflictWarning?.hard.length && (
                  <div className="ssm-conflict-soft">
                    <i className="ti ti-alert-triangle" />
                    <div>
                      <div className="ssm-conflict-label">Warning</div>
                      {conflictWarning.soft.map((c, i) => (
                        <div key={i}>{c}</div>
                      ))}
                    </div>
                  </div>
                )}

              {/* Professor — only editable for major subjects (course code starts with "6") */}
              {(() => {
                const isMajor = (editingSchedule.course_code || "").startsWith(
                  "6",
                );
                return (
                  <div className="ssm-edit-field">
                    <label>Professor</label>
                    {isMajor ? (
                      <select
                        className="ssm-edit-select"
                        value={editForm.professor_id ?? ""}
                        onChange={(e) => {
                          setEditForm((p) => ({
                            ...p,
                            professor_id: e.target.value
                              ? Number(e.target.value)
                              : null,
                          }));
                          setConflictWarning(null);
                        }}
                      >
                        <option value="">— Unassigned —</option>
                        {professors.map((p) => (
                          <option key={p.professor_id} value={p.professor_id}>
                            {p.last_name}, {p.first_name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="ssm-gen-ed-note">
                        <i className="ti ti-info-circle" />
                        General Education subject — professor is managed by
                        another department.
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="ssm-edit-field">
                <label>Room</label>
                <select
                  className="ssm-edit-select"
                  value={editForm.room_id ?? ""}
                  onChange={(e) => {
                    setEditForm((p) => ({
                      ...p,
                      room_id: e.target.value ? Number(e.target.value) : null,
                    }));
                    setConflictWarning(null);
                  }}
                >
                  <option value="">— Select room —</option>
                  {rooms.map((r) => (
                    <option key={r.room_id} value={r.room_id}>
                      {r.room_name} (Cap {r.capacity})
                    </option>
                  ))}
                </select>
              </div>

              <div className="ssm-edit-field">
                <label>Day & time</label>
                <div className="ssm-time-row">
                  <select
                    className="ssm-edit-select ssm-day-sel"
                    value={editForm.day}
                    onChange={(e) => {
                      setEditForm((p) => ({ ...p, day: e.target.value }));
                      setConflictWarning(null);
                    }}
                  >
                    {DAYS_OF_WEEK.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <div className="ssm-time-wheel">
                    <select
                      className="ssm-time-sel"
                      value={editForm.start_h}
                      onChange={(e) => {
                        setEditForm((p) => ({ ...p, start_h: e.target.value }));
                        setConflictWarning(null);
                      }}
                    >
                      {HOURS.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                    <span className="ssm-time-colon">:</span>
                    <select
                      className="ssm-time-sel ssm-time-sel-min"
                      value={editForm.start_m}
                      onChange={(e) => {
                        setEditForm((p) => ({ ...p, start_m: e.target.value }));
                        setConflictWarning(null);
                      }}
                    >
                      {MINUTES.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className="ssm-time-sep">to</span>
                  <div className="ssm-time-wheel">
                    <select
                      className="ssm-time-sel"
                      value={editForm.end_h}
                      onChange={(e) => {
                        setEditForm((p) => ({ ...p, end_h: e.target.value }));
                        setConflictWarning(null);
                      }}
                    >
                      {HOURS.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                    <span className="ssm-time-colon">:</span>
                    <select
                      className="ssm-time-sel ssm-time-sel-min"
                      value={editForm.end_m}
                      onChange={(e) => {
                        setEditForm((p) => ({ ...p, end_m: e.target.value }));
                        setConflictWarning(null);
                      }}
                    >
                      {MINUTES.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className="ssm-edit-footer">
              <button
                className="ssm-cancel-btn"
                onClick={() => setEditingSchedule(null)}
              >
                Cancel
              </button>
              <button
                className="ssm-save-btn"
                onClick={handleSave}
                disabled={saving || conflictWarning?.hard.length > 0}
              >
                {saving ? (
                  "Saving…"
                ) : (
                  <>
                    <i className="ti ti-device-floppy" /> Save changes
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
