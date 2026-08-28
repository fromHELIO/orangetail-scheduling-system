import { useState, useEffect } from "react";
import { supabase } from "../../../lib/supabaseClient";
import TimeWheel from "../time/time_wheel";
import { YEAR_LEVELS } from "../generate_utils";
import "./add_section_modal.css";

const DAY_ORDER = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const LECTURE_PAIRS = [
  { label: "Mon / Thu", days: ["Monday", "Thursday"] },
  { label: "Tue / Fri", days: ["Tuesday", "Friday"] },
  { label: "Wed / Sat", days: ["Wednesday", "Saturday"] },
];

function getUsername() {
  return JSON.parse(localStorage.getItem("user") || "{}").username || "unknown";
}

function normalizeDay(d) {
  if (!d) return "";
  const val = d.toLowerCase().trim();
  return (
    DAY_ORDER.find(
      (day) => day.toLowerCase() === val || day.toLowerCase().startsWith(val),
    ) || d
  );
}
function toMin(t) {
  if (!t) return 0;
  const p = t.split(":");
  return parseInt(p[0], 10) * 60 + parseInt(p[1] || "0", 10);
}
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

// Default assignment shape per course
function makeAssignment(c) {
  const hasLec = (c.lec_hours || 0) > 0;
  const hasLab = (c.lab_hours || 0) > 0;
  return {
    course_id: c.course_id,
    course_code: c.course_code,
    course_name: c.course_name,
    lec_hours: c.lec_hours || 0,
    lab_hours: c.lab_hours || 0,
    has_lec: hasLec,
    has_lab: hasLab,
    // Lecture
    lec_pair: 0, // index into LECTURE_PAIRS
    lec_single: false, // true = single day, false = paired days
    lec_day: "Monday", // used only when lec_single=true
    lec_start_h: "00",
    lec_start_m: "00",
    lec_end_h: "00",
    lec_end_m: "00",
    // Lab
    lab_day: "Monday",
    lab_start_h: "00",
    lab_start_m: "00",
    lab_end_h: "00",
    lab_end_m: "00",
    professor_id: "",
    room_id: "",
    lab_room_id: "",
    conflicts: { hard: [], soft: [] },
  };
}

export default function AddSectionModal({
  open,
  onClose,
  selectedSession,
  getSemesterLabel,
  step,
  setStep,
  professors,
  rooms,
  onSaved,
}) {
  const [filter, setFilter] = useState({ curriculum_label: "", year_lvl: "" });
  const [sectionCourses, setSectionCourses] = useState([]);
  const [classAssignments, setClassAssignments] = useState([]);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);

  const sessionCurricula = [
    ...new Set(
      (selectedSession?.sections || [])
        .map((s) => s.curriculum_label)
        .filter(Boolean),
    ),
  ].sort();

  // Auto-generate next section name based on existing sections in session
  const autoSectionName = (() => {
    if (!filter.curriculum_label || !filter.year_lvl) return "";
    const existing = (selectedSession?.sections || []).filter(
      (s) =>
        s.curriculum_label === filter.curriculum_label &&
        String(s.year_lvl) === String(filter.year_lvl),
    );
    // Extract letters from names like "BSCS 1-A", "BSCS 1-B"
    const letters = existing
      .map((s) => {
        const m = s.section_name.match(/-([A-Z])$/i);
        return m ? m[1].toUpperCase() : null;
      })
      .filter(Boolean)
      .sort();
    const nextLetter =
      letters.length === 0
        ? "A"
        : String.fromCharCode(letters[letters.length - 1].charCodeAt(0) + 1);
    // Build prefix from curriculum_label (e.g. "BSCS 2024") → program code + year level
    // Pattern: use existing section names as template, or build from program code + year_lvl
    if (existing.length > 0) {
      // Use existing name as template, just increment the letter
      const template = existing[existing.length - 1].section_name;
      return template.replace(/-[A-Z]$/i, `-${nextLetter}`);
    }
    // No existing sections — build from curriculum label program code + year level
    const programCode = filter.curriculum_label.split(" ")[0]; // e.g. "BSCS"
    return `${programCode} ${filter.year_lvl}-${nextLetter}`;
  })();

  // Always show all 4 year levels — not just ones already in the session
  const sessionYearLevels = [1, 2, 3, 4];

  useEffect(() => {
    if (!filter.curriculum_label || !filter.year_lvl) return;
    loadCourses();
  }, [filter.curriculum_label, filter.year_lvl]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadCourses() {
    let curriculumId = null;

    // First try: get curriculum_id from an existing section in this session
    const anySection = (selectedSession?.sections || []).find(
      (s) => s.curriculum_label === filter.curriculum_label,
    );
    if (anySection?.section_id != null) {
      const { data: secData } = await supabase
        .from("section")
        .select("curriculum_id")
        .eq("section_id", anySection.section_id)
        .maybeSingle();
      curriculumId = secData?.curriculum_id;
    }

    // Fallback: parse curriculum_label "BSCS 2024" → look up from curricula + programs tables
    if (!curriculumId) {
      const parts = filter.curriculum_label.split(" ");
      const programCode = parts[0];
      const currYear = parts[1];
      const { data: prog } = await supabase
        .from("programs")
        .select("program_id")
        .eq("program_code", programCode)
        .maybeSingle();
      if (prog?.program_id) {
        const { data: curr } = await supabase
          .from("curricula")
          .select("curriculum_id")
          .eq("program_id", prog.program_id)
          .eq("curriculum_year", currYear)
          .maybeSingle();
        curriculumId = curr?.curriculum_id;
      }
    }

    if (!curriculumId) return;

    const { data: cc } = await supabase
      .from("curriculum_courses")
      .select(
        "*, courses(course_id, course_code, course_name, units, lec_hours, lab_hours, lab_cat)",
      )
      .eq("curriculum_id", curriculumId)
      .eq("year_lvl", filter.year_lvl)
      .eq("semester", selectedSession.semester)
      .eq("is_required", true);

    const courses = (cc || []).map((c) => c.courses).filter(Boolean);
    setSectionCourses(courses);
    setClassAssignments(courses.map(makeAssignment));
  }

  function updateAssignment(idx, patch) {
    setClassAssignments((prev) =>
      prev.map((x, i) =>
        i === idx ? { ...x, ...patch, conflicts: { hard: [], soft: [] } } : x,
      ),
    );
  }

  function removeAssignment(courseId) {
    setClassAssignments((prev) => prev.filter((a) => a.course_id !== courseId));
  }

  function restoreAssignment(course) {
    setClassAssignments((prev) => [...prev, makeAssignment(course)]);
  }

  // Build all schedule rows for an assignment (for conflict checking and saving)
  function getScheduleRows(a) {
    const rows = [];
    if (a.has_lec) {
      const start_time = `${a.lec_start_h}:${a.lec_start_m}`;
      const end_time = `${a.lec_end_h}:${a.lec_end_m}`;
      if (a.lec_single) {
        rows.push({
          type: "lec",
          day: a.lec_day,
          start_time,
          end_time,
          professor_id: a.professor_id,
          room_id: a.room_id,
        });
      } else {
        LECTURE_PAIRS[a.lec_pair].days.forEach((day) =>
          rows.push({
            type: "lec",
            day,
            start_time,
            end_time,
            professor_id: a.professor_id,
            room_id: a.room_id,
          }),
        );
      }
    }
    if (a.has_lab) {
      rows.push({
        type: "lab",
        day: a.lab_day,
        start_time: `${a.lab_start_h}:${a.lab_start_m}`,
        end_time: `${a.lab_end_h}:${a.lab_end_m}`,
        professor_id: a.professor_id,
        room_id: a.lab_room_id || a.room_id,
      });
    }
    return rows;
  }

  async function checkAllConflicts(assignments) {
    const { data: allSlots } = await supabase
      .from("time_slots")
      .select("slot_id, day, start_time, end_time");

    // Flatten all rows from all assignments for intra-batch checking
    const allRows = assignments.flatMap((a, ai) =>
      getScheduleRows(a).map((r) => ({ ...r, assignmentIdx: ai })),
    );

    return Promise.all(
      assignments.map(async (a, idx) => {
        const hard = new Set(),
          soft = new Set();
        const myRows = getScheduleRows(a);

        for (const row of myRows) {
          const normDay = normalizeDay(row.day);
          const newStart = toMin(row.start_time);
          const newEnd = toMin(row.end_time);

          if (newEnd <= newStart) {
            hard.add("End time must be later than start time.");
            continue;
          }

          // ── Intra-batch overlap ──
          allRows.forEach((other) => {
            if (other.assignmentIdx === idx) return;
            if (normalizeDay(other.day) !== normDay) return;

            if (
              !overlaps(
                newStart,
                newEnd,
                toMin(other.start_time),
                toMin(other.end_time),
              )
            ) {
              return;
            }

            // Same section cannot have two classes at overlapping times
            hard.add(
              "This section has another course scheduled during this time.",
            );

            if (row.professor_id && row.professor_id === other.professor_id) {
              hard.add(
                "Professor is assigned to another course at an overlapping time.",
              );
            }

            if (row.room_id && row.room_id === other.room_id) {
              hard.add(
                "Room is assigned to another course at an overlapping time.",
              );
            }
          });

          // ── DB overlap ──
          const sameDay = (allSlots || []).filter(
            (s) => normalizeDay(s.day) === normDay,
          );
          const overlappingIds = sameDay
            .filter((s) =>
              overlaps(
                newStart,
                newEnd,
                toMin(s.start_time),
                toMin(s.end_time),
              ),
            )
            .map((s) => s.slot_id);

          if (overlappingIds.length > 0) {
            if (row.professor_id) {
              const { data } = await supabase
                .from("schedules")
                .select("schedule_id")
                .in("slot_id", overlappingIds)
                .eq("professor_id", row.professor_id);
              if (data?.length > 0)
                hard.add("Professor is already booked during this time.");
            }
            if (row.room_id) {
              const { data } = await supabase
                .from("schedules")
                .select("schedule_id")
                .in("slot_id", overlappingIds)
                .eq("room_id", row.room_id);
              if (data?.length > 0)
                hard.add("Room is already booked during this time.");
            }
          }

          // ── Soft: 3+ classes same day ──
          if (row.professor_id) {
            const allDayIds = sameDay.map((s) => s.slot_id);
            if (allDayIds.length > 0) {
              const { data } = await supabase
                .from("schedules")
                .select("schedule_id")
                .in("slot_id", allDayIds)
                .eq("professor_id", row.professor_id);
              if ((data?.length || 0) >= 3)
                soft.add("Professor already has 3+ classes on this day.");
            }
          }
        }

        return { ...a, conflicts: { hard: [...hard], soft: [...soft] } };
      }),
    );
  }

  async function handleCheckConflicts() {
    setChecking(true);
    try {
      const updated = await checkAllConflicts(classAssignments);
      setClassAssignments(updated);
      return updated;
    } finally {
      setChecking(false);
    }
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

  async function handleSave() {
    setSaving(true);
    try {
      const schoolYear = selectedSession.school_year;
      const sem = selectedSession.semester;
      const generatedAt =
        selectedSession.generated_at || new Date().toISOString();

      // Get curriculum_id — try matching section in session, fallback to any section with same curriculum_label
      let curriculumId = null;
      const matchingSection =
        (selectedSession?.sections || []).find(
          (s) =>
            s.curriculum_label === filter.curriculum_label &&
            String(s.year_lvl) === String(filter.year_lvl),
        ) ||
        (selectedSession?.sections || []).find(
          (s) => s.curriculum_label === filter.curriculum_label,
        );
      if (matchingSection?.section_id != null) {
        const { data: secData } = await supabase
          .from("section")
          .select("curriculum_id")
          .eq("section_id", matchingSection.section_id)
          .maybeSingle();
        curriculumId = secData?.curriculum_id;
      }
      // Fallback: look up from programs + curricula tables
      if (!curriculumId) {
        const parts = filter.curriculum_label.split(" ");
        const programCode = parts[0];
        const currYear = parts[1];
        const { data: prog } = await supabase
          .from("programs")
          .select("program_id")
          .eq("program_code", programCode)
          .maybeSingle();
        if (prog?.program_id) {
          const { data: curr } = await supabase
            .from("curricula")
            .select("curriculum_id")
            .eq("program_id", prog.program_id)
            .eq("curriculum_year", currYear)
            .maybeSingle();
          curriculumId = curr?.curriculum_id;
        }
      }

      const { data: newSection, error: secErr } = await supabase
        .from("section")
        .insert({
          section_name: autoSectionName,
          curriculum_id: curriculumId,
          year_lvl: Number(filter.year_lvl),
        })
        .select()
        .single();
      if (secErr) throw secErr;

      for (const a of classAssignments) {
        // Find or create class_offering (shared for both lec+lab rows)
        const { data: existingOff } = await supabase
          .from("class_offerings")
          .select("offering_id")
          .eq("section_id", newSection.section_id)
          .eq("course_id", a.course_id)
          .eq("school_year", schoolYear)
          .eq("semester", sem)
          .maybeSingle();
        let offeringId = existingOff?.offering_id;
        if (!offeringId) {
          const { data: newOff, error: offErr } = await supabase
            .from("class_offerings")
            .insert({
              class_code: (() => {
                const yrShort = schoolYear.replace(
                  /20(\d{2})-20(\d{2})/,
                  "$1$2",
                );
                const secName = (newSection.section_name || "")
                  .replace(/\s+/g, "")
                  .replace(/-/g, "");
                return `${a.course_code}-${secName}-${yrShort}-S${selectedSession?.semester || ""}`; // e.g. 6CFUN-BSCS1A-2627-S1
              })(),
              section_id: newSection.section_id,
              course_id: a.course_id,
              school_year: schoolYear,
              semester: sem,
            })
            .select()
            .single();
          if (offErr) throw offErr;
          offeringId = newOff.offering_id;
        }

        // Insert one schedule row per slot (lec = 2 rows, lab = 1 row)
        const rows = getScheduleRows(a);
        for (const row of rows) {
          const slotId = await getOrCreateSlot(
            row.day,
            row.start_time,
            row.end_time,
          );
          await supabase.from("schedules").insert({
            offering_id: offeringId,
            professor_id: row.professor_id ? Number(row.professor_id) : null,
            room_id: row.room_id ? Number(row.room_id) : null,
            slot_id: slotId,
            status: "Draft",
            generated_at: generatedAt,
          });
        }
      }

      // Downgrade approved schedules back to Draft
      const scheduleIds = (selectedSession.sections || [])
        .flatMap((s) => s.schedules.map((sc) => sc.schedule_id))
        .filter(Boolean);
      if (scheduleIds.length > 0) {
        await supabase
          .from("schedules")
          .update({ status: "Draft" })
          .eq("status", "Approved")
          .in("schedule_id", scheduleIds);
      }

      await supabase.from("change_log").insert({
        action: "Added section to session",
        entity: schoolYear,
        details: `New section: ${autoSectionName} — ${classAssignments.length} courses`,
        performed_by: getUsername(),
      });

      onSaved();
      handleClose();
    } catch (err) {
      console.error(err);
    }
    setSaving(false);
  }

  function handleClose() {
    onClose();
    setStep(1);
    setFilter({ curriculum_label: "", year_lvl: "" });
    setSectionCourses([]);
    setClassAssignments([]);
  }

  function validateStep1() {
    if (!filter.curriculum_label || !filter.year_lvl) return false;
    if (classAssignments.length === 0) return false;
    return true;
  }

  if (!open) return null;

  const steps = ["Pick curriculum & year", "Assign classes", "Review & save"];
  const hasHardConflict = classAssignments.some(
    (a) => a.conflicts.hard.length > 0,
  );

  return (
    <div className="asm-overlay" onClick={handleClose}>
      <div className="asm-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="asm-header">
          <div>
            <div className="asm-title">Add section to session</div>
            <div className="asm-sub">
              {selectedSession?.school_year} ·{" "}
              {getSemesterLabel(selectedSession?.semester)}
              <span className="asm-reapprove">
                {" "}
                — session will need re-approval
              </span>
            </div>
          </div>
          <button className="asm-close" onClick={handleClose}>
            <i className="ti ti-x" />
          </button>
        </div>

        {/* Steps */}
        <div className="asm-steps">
          {steps.map((label, i) => (
            <div key={i} className="asm-step">
              <div
                className={`asm-step-num ${step === i + 1 ? "active" : step > i + 1 ? "done" : ""}`}
              >
                {step > i + 1 ? <i className="ti ti-check" /> : i + 1}
              </div>
              <span
                className={`asm-step-label ${step === i + 1 ? "active" : ""}`}
              >
                {label}
              </span>
              {i < steps.length - 1 && <div className="asm-step-line" />}
            </div>
          ))}
        </div>

        {/* ── Step 1 ── */}
        {step === 1 && (
          <div className="asm-body">
            <div className="asm-field">
              <label>
                Curriculum <span className="asm-req">*</span>
              </label>
              <select
                className="asm-select"
                value={filter.curriculum_label}
                onChange={(e) =>
                  setFilter((p) => ({
                    ...p,
                    curriculum_label: e.target.value,
                    year_lvl: "",
                  }))
                }
              >
                <option value="">— Select curriculum —</option>
                {sessionCurricula.map((cl) => (
                  <option key={cl} value={cl}>
                    {cl}
                  </option>
                ))}
              </select>
              <div className="asm-hint">
                Only curricula from this session are shown.
              </div>
            </div>

            {filter.curriculum_label && (
              <div className="asm-field">
                <label>
                  Year level <span className="asm-req">*</span>
                </label>
                <div className="asm-yl-grid">
                  {sessionYearLevels.map((yl) => {
                    const found = YEAR_LEVELS.find((y) => y.value === yl);
                    return (
                      <button
                        key={yl}
                        type="button"
                        className={`asm-yl-btn ${String(filter.year_lvl) === String(yl) ? "asm-yl-btn-active" : ""}`}
                        onClick={() =>
                          setFilter((p) => ({ ...p, year_lvl: String(yl) }))
                        }
                      >
                        {found?.label || `Year ${yl}`}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {filter.curriculum_label && filter.year_lvl && (
              <div className="asm-field">
                <label>New section name</label>
                <div className="asm-auto-name">{autoSectionName}</div>
              </div>
            )}

            {sectionCourses.length > 0 && (
              <div className="asm-preview">
                <div className="asm-preview-label">
                  Courses to schedule ({classAssignments.length} of{" "}
                  {sectionCourses.length})
                </div>
                {sectionCourses.map((c) => {
                  const included = classAssignments.some(
                    (a) => a.course_id === c.course_id,
                  );
                  const hasLec = (c.lec_hours || 0) > 0;
                  const hasLab = (c.lab_hours || 0) > 0;
                  return (
                    <div
                      key={c.course_id}
                      className={`asm-course-row ${!included ? "asm-course-removed" : ""}`}
                    >
                      <span className="asm-course-code">{c.course_code}</span>
                      <span className="asm-course-name">{c.course_name}</span>
                      <div className="asm-course-tags">
                        {hasLec && (
                          <span className="asm-tag asm-tag-lec">Lec</span>
                        )}
                        {hasLab && (
                          <span className="asm-tag asm-tag-lab">Lab</span>
                        )}
                      </div>
                      <span className="asm-course-units">{c.units} units</span>
                      {included ? (
                        <button
                          className="asm-course-remove-btn"
                          title="Remove from this section"
                          onClick={() => removeAssignment(c.course_id)}
                        >
                          <i className="ti ti-minus" />
                        </button>
                      ) : (
                        <button
                          className="asm-course-add-btn"
                          title="Add back"
                          onClick={() => restoreAssignment(c)}
                        >
                          <i className="ti ti-plus" />
                        </button>
                      )}
                    </div>
                  );
                })}
                {classAssignments.length < sectionCourses.length && (
                  <div className="asm-removed-note">
                    <i className="ti ti-info-circle" />
                    {sectionCourses.length - classAssignments.length} course
                    {sectionCourses.length - classAssignments.length !== 1
                      ? "s"
                      : ""}{" "}
                    removed — only selected courses will be scheduled.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Step 2 ── */}
        {step === 2 && (
          <div className="asm-body">
            {classAssignments.map((a, idx) => (
              <div key={a.course_id} className="asm-assign-row">
                {/* Course header */}
                <div className="asm-assign-course">
                  <span className="asm-course-code">{a.course_code}</span>
                  <span className="asm-course-name">{a.course_name}</span>
                  <div className="asm-course-tags">
                    {a.has_lec && (
                      <span className="asm-tag asm-tag-lec">Lec</span>
                    )}
                    {a.has_lab && (
                      <span className="asm-tag asm-tag-lab">Lab</span>
                    )}
                  </div>
                </div>

                {/* Conflicts */}
                {a.conflicts.hard.length > 0 && (
                  <div className="asm-conflict-hard">
                    <i className="ti ti-alert-circle" />
                    <div>
                      {a.conflicts.hard.map((c, i) => (
                        <div key={i}>{c}</div>
                      ))}
                    </div>
                  </div>
                )}
                {!a.conflicts.hard.length && a.conflicts.soft.length > 0 && (
                  <div className="asm-conflict-soft">
                    <i className="ti ti-alert-triangle" />
                    <div>
                      {a.conflicts.soft.map((c, i) => (
                        <div key={i}>{c}</div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Professor (shared for lec+lab) */}
                <div className="asm-grid2">
                  <div className="asm-field">
                    <label>Professor</label>
                    <select
                      className="asm-select"
                      value={a.professor_id}
                      onChange={(e) =>
                        updateAssignment(idx, { professor_id: e.target.value })
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
                  <div className="asm-field">
                    <label>{a.has_lab ? "Lecture room" : "Room"}</label>
                    <select
                      className="asm-select"
                      value={a.room_id}
                      onChange={(e) =>
                        updateAssignment(idx, { room_id: e.target.value })
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

                {/* Lecture schedule */}
                {a.has_lec && (
                  <div className="asm-schedule-block asm-schedule-lec">
                    <div className="asm-schedule-block-label">
                      <i className="ti ti-school" /> Lecture
                    </div>

                    {/* Single vs Paired toggle */}
                    <div className="asm-field">
                      <label>Schedule type</label>
                      <div className="asm-pair-btns">
                        <button
                          type="button"
                          className={`asm-pair-btn ${!a.lec_single ? "asm-pair-btn-active" : ""}`}
                          onClick={() =>
                            updateAssignment(idx, { lec_single: false })
                          }
                        >
                          <i className="ti ti-calendar-repeat" /> Paired days
                        </button>
                        <button
                          type="button"
                          className={`asm-pair-btn ${a.lec_single ? "asm-pair-btn-active" : ""}`}
                          onClick={() =>
                            updateAssignment(idx, { lec_single: true })
                          }
                        >
                          <i className="ti ti-calendar-event" /> Single day
                        </button>
                      </div>
                    </div>

                    {/* Paired day picker */}
                    {!a.lec_single && (
                      <>
                        <div className="asm-field">
                          <label>Day pair</label>
                          <div className="asm-pair-btns">
                            {LECTURE_PAIRS.map((pair, pi) => (
                              <button
                                key={pi}
                                type="button"
                                className={`asm-pair-btn ${a.lec_pair === pi ? "asm-pair-btn-active" : ""}`}
                                onClick={() =>
                                  updateAssignment(idx, { lec_pair: pi })
                                }
                              >
                                {pair.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="asm-field">
                          <label>Time (same for both days)</label>
                          <TimeWheel
                            day={LECTURE_PAIRS[a.lec_pair].days[0]}
                            start_h={a.lec_start_h}
                            start_m={a.lec_start_m}
                            end_h={a.lec_end_h}
                            end_m={a.lec_end_m}
                            hideDay={true}
                            onChange={(field, val) => {
                              if (field === "day") return;
                              updateAssignment(idx, { [`lec_${field}`]: val });
                            }}
                          />
                        </div>
                        <div className="asm-pair-days-note">
                          <i className="ti ti-calendar" />
                          Schedules on both{" "}
                          <strong>
                            {LECTURE_PAIRS[a.lec_pair].days[0]}
                          </strong>{" "}
                          and{" "}
                          <strong>{LECTURE_PAIRS[a.lec_pair].days[1]}</strong>
                        </div>
                      </>
                    )}

                    {/* Single day picker */}
                    {a.lec_single && (
                      <div className="asm-field">
                        <label>Day & time</label>
                        <TimeWheel
                          day={a.lec_day}
                          start_h={a.lec_start_h}
                          start_m={a.lec_start_m}
                          end_h={a.lec_end_h}
                          end_m={a.lec_end_m}
                          onChange={(field, val) =>
                            updateAssignment(idx, {
                              [field === "day" ? "lec_day" : `lec_${field}`]:
                                val,
                            })
                          }
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Lab schedule */}
                {a.has_lab && (
                  <div className="asm-schedule-block asm-schedule-lab">
                    <div className="asm-schedule-block-label">
                      <i className="ti ti-flask" /> Lab
                    </div>
                    <div className="asm-field">
                      <label>Lab room</label>
                      <select
                        className="asm-select"
                        value={a.lab_room_id}
                        onChange={(e) =>
                          updateAssignment(idx, { lab_room_id: e.target.value })
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
                    <div className="asm-field">
                      <label>Day & time</label>
                      <TimeWheel
                        day={a.lab_day}
                        start_h={a.lab_start_h}
                        start_m={a.lab_start_m}
                        end_h={a.lab_end_h}
                        end_m={a.lab_end_m}
                        onChange={(field, val) =>
                          updateAssignment(idx, { [`lab_${field}`]: val })
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Step 3 ── */}
        {step === 3 && (
          <div className="asm-body">
            <div className="asm-review-summary">
              <i className="ti ti-users" />
              <strong>{autoSectionName}</strong> · {filter.curriculum_label} ·{" "}
              {
                YEAR_LEVELS.find(
                  (y) => String(y.value) === String(filter.year_lvl),
                )?.label
              }
            </div>
            {hasHardConflict && (
              <div className="asm-conflict-hard">
                <i className="ti ti-alert-circle" />
                <div>
                  <strong>Hard conflicts found</strong> — go back to Step 2 to
                  fix them.
                </div>
              </div>
            )}
            {classAssignments.map((a) => {
              const prof = professors.find(
                (p) => String(p.professor_id) === String(a.professor_id),
              );
              const room = rooms.find(
                (r) => String(r.room_id) === String(a.room_id),
              );
              const labRoom = rooms.find(
                (r) => String(r.room_id) === String(a.lab_room_id),
              );
              const hasHard = a.conflicts.hard.length > 0;
              const pair = LECTURE_PAIRS[a.lec_pair];
              return (
                <div
                  key={a.course_id}
                  className={`asm-review-row ${hasHard ? "asm-review-row-error" : ""}`}
                >
                  <div className="asm-assign-course">
                    <span className="asm-course-code">{a.course_code}</span>
                    <span className="asm-course-name">{a.course_name}</span>
                    <div className="asm-course-tags">
                      {a.has_lec && (
                        <span className="asm-tag asm-tag-lec">Lec</span>
                      )}
                      {a.has_lab && (
                        <span className="asm-tag asm-tag-lab">Lab</span>
                      )}
                    </div>
                  </div>
                  <div className="asm-review-details">
                    <span>
                      <i className="ti ti-user" />{" "}
                      {prof
                        ? `${prof.last_name}, ${prof.first_name}`
                        : "Unassigned"}
                    </span>
                  </div>
                  {a.has_lec && (
                    <div className="asm-review-slot asm-review-slot-lec">
                      <span className="asm-review-slot-label">Lec</span>
                      <span>
                        <i className="ti ti-building" />{" "}
                        {room?.room_name || "No room"}
                      </span>
                      <span>
                        <i className="ti ti-calendar" />
                        {a.lec_single ? a.lec_day : `${pair.label}`}
                      </span>
                      <span>
                        <i className="ti ti-clock" /> {a.lec_start_h}:
                        {a.lec_start_m}–{a.lec_end_h}:{a.lec_end_m}
                      </span>
                    </div>
                  )}
                  {a.has_lab && (
                    <div className="asm-review-slot asm-review-slot-lab">
                      <span className="asm-review-slot-label">Lab</span>
                      <span>
                        <i className="ti ti-building" />{" "}
                        {labRoom?.room_name || room?.room_name || "No room"}
                      </span>
                      <span>
                        <i className="ti ti-calendar" /> {a.lab_day}
                      </span>
                      <span>
                        <i className="ti ti-clock" /> {a.lab_start_h}:
                        {a.lab_start_m}–{a.lab_end_h}:{a.lab_end_m}
                      </span>
                    </div>
                  )}
                  {hasHard && (
                    <div className="asm-conflict-hard sm">
                      <i className="ti ti-alert-circle" />
                      <div>
                        {a.conflicts.hard.map((c, i) => (
                          <div key={i}>{c}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  {!hasHard && a.conflicts.soft.length > 0 && (
                    <div className="asm-conflict-soft sm">
                      <i className="ti ti-alert-triangle" />
                      {a.conflicts.soft[0]}
                    </div>
                  )}
                </div>
              );
            })}
            <div className="asm-note">
              <i className="ti ti-info-circle" />
              Saved as <strong>Draft</strong>. The session must be re-approved
              before changes take effect.
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="asm-footer">
          <button
            className="asm-cancel-btn"
            onClick={() => {
              if (step === 1) handleClose();
              else setStep((s) => s - 1);
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
          <div style={{ display: "flex", gap: 8 }}>
            {step === 1 && (
              <button
                className="asm-next-btn"
                disabled={
                  !filter.curriculum_label ||
                  !filter.year_lvl ||
                  classAssignments.length === 0
                }
                onClick={() => {
                  if (validateStep1()) setStep(2);
                }}
              >
                Next — assign classes <i className="ti ti-chevron-right" />
              </button>
            )}
            {step === 2 && (
              <button
                className="asm-next-btn"
                disabled={checking}
                onClick={async () => {
                  await handleCheckConflicts();
                  setStep(3);
                }}
              >
                {checking ? (
                  "Checking…"
                ) : (
                  <>
                    Check conflicts & review{" "}
                    <i className="ti ti-chevron-right" />
                  </>
                )}
              </button>
            )}
            {step === 3 && (
              <button
                className="asm-save-btn"
                disabled={saving || hasHardConflict}
                onClick={handleSave}
              >
                {saving ? (
                  "Saving…"
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
    </div>
  );
}
