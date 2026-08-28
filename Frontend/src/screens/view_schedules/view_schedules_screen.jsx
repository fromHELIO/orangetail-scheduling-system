import { useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../../lib/supabaseClient";
import "./view_schedules_screen.css";
import "../generate/sessions/approve_session_modal.css";

const SEMESTERS = [
  { value: 1, label: "1st Semester" },
  { value: 2, label: "2nd Semester" },
  { value: 3, label: "Summer" },
];

const YEAR_LEVELS = [
  { value: 1, label: "1st Year" },
  { value: 2, label: "2nd Year" },
  { value: 3, label: "3rd Year" },
  { value: 4, label: "4th Year" },
];

const DAY_ORDER = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const HOURS = Array.from({ length: 15 }, (_, i) =>
  String(i + 6).padStart(2, "0"),
); // 06-20
const MINUTES = ["00", "15", "30", "45"];

function getSemesterLabel(val) {
  return SEMESTERS.find((s) => s.value === val)?.label || "—";
}

function normDay(d) {
  if (!d) return "";
  const lower = d.toLowerCase().trim();
  return (
    DAY_ORDER.find(
      (day) =>
        day.toLowerCase() === lower || day.toLowerCase().startsWith(lower),
    ) || d
  );
}

function timeToMinutes(t) {
  if (!t) return 9999;
  const p = t.split(":");
  return parseInt(p[0], 10) * 60 + parseInt(p[1] || "0", 10);
}

function sortSchedules(schedules) {
  return [...(schedules || [])].sort((a, b) => {
    const ai = DAY_ORDER.indexOf(normDay(a.day));
    const bi = DAY_ORDER.indexOf(normDay(b.day));
    if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return timeToMinutes(a.start_time) - timeToMinutes(b.start_time);
  });
}

function groupSchedules(schedules) {
  const groups = {};
  (schedules || []).forEach((s) => {
    const isSummer = s.semester === 3;
    const curr = s.curriculum_label || (isSummer ? "Summer" : "Unknown");
    const yl = s.year_lvl || (isSummer ? "summer" : 1);
    const sec = s.section_name || (isSummer ? "Summer" : "Unknown");
    if (!groups[curr]) groups[curr] = {};
    if (!groups[curr][yl]) groups[curr][yl] = {};
    if (!groups[curr][yl][sec]) groups[curr][yl][sec] = [];
    groups[curr][yl][sec].push(s);
  });
  // Sort within each section by day+time
  Object.values(groups).forEach((yg) =>
    Object.values(yg).forEach((sg) =>
      Object.keys(sg).forEach((sec) => {
        sg[sec] = sortSchedules(sg[sec]);
      }),
    ),
  );
  return groups;
}

function flattenSchedule(row) {
  const section = row.class_offerings?.section;
  const curriculum = section?.curricula;
  const program = curriculum?.programs;
  return {
    schedule_id: row.schedule_id,
    status: row.status,
    generated_at: row.generated_at,
    professor_id: row.professor_id,
    room_id: row.room_id,
    slot_id: row.slot_id,
    day: row.time_slots?.day,
    start_time: row.time_slots?.start_time,
    end_time: row.time_slots?.end_time,
    professor_name: row.professor
      ? `${row.professor.first_name} ${row.professor.last_name}`
      : null,
    room_name: row.rooms?.room_name || null,
    class_code: row.class_offerings?.class_code,
    course_code: row.class_offerings?.courses?.course_code,
    course_name: row.class_offerings?.courses?.course_name,
    section_id: section?.section_id,
    section_name: section?.section_name,
    year_lvl: section?.year_lvl,
    curriculum_label:
      program && curriculum
        ? `${program.program_code} ${curriculum.curriculum_year}`
        : null,
    school_year: row.class_offerings?.school_year,
    semester: row.class_offerings?.semester,
  };
}

const SCHEDULE_SELECT = `
  schedule_id, status, generated_at, professor_id, room_id, slot_id,
  time_slots ( day, start_time, end_time ),
  professor ( first_name, last_name ),
  rooms ( room_name ),
  class_offerings (
    class_code, school_year, semester,
    courses ( course_code, course_name ),
    section (
      section_id, section_name, year_lvl,
      curricula ( curriculum_year, programs ( program_code ) )
    )
  )
`;

function groupIntoSessions(scheduleList) {
  const groups = {};
  scheduleList.forEach((s) => {
    // Use full generated_at ISO string as key so two generations on the same day stay separate
    const key = `${s.school_year}-${s.semester}-${s.generated_at}`;
    if (!groups[key]) {
      groups[key] = {
        session_id: key,
        school_year: s.school_year,
        semester: s.semester,
        status: s.status,
        generated_at: s.generated_at,
        schedules: [],
      };
    }
    groups[key].schedules.push(s);
    const statusOrder = { Draft: 0, Generated: 1, Approved: 2 };
    if (statusOrder[s.status] < statusOrder[groups[key].status])
      groups[key].status = s.status;
  });
  return Object.values(groups).sort(
    (a, b) => new Date(b.generated_at) - new Date(a.generated_at),
  );
}

function getStatusClass(status) {
  if (status === "Approved") return "vs-status-approved";
  if (status === "Generated") return "vs-status-generated";
  return "vs-status-draft";
}

export default function ViewSchedulesScreen({ onBack, initialSessionId }) {
  const [sessions, setSessions] = useState([]);
  const [professors, setProfessors] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [timeSlots, setTimeSlots] = useState([]);

  const [selectedSessionId, setSelectedSessionId] = useState(
    initialSessionId || "",
  );
  const [filterCurriculum, setFilterCurriculum] = useState("");
  const [filterYear, setFilterYear] = useState("");
  const [filterSection, setFilterSection] = useState("");

  // Edit modal
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
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Export preview
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSection, setPreviewSection] = useState(null);

  useEffect(() => {
    async function loadAll() {
      const [profsRes, roomsRes, slotsRes, schedsRes] = await Promise.all([
        supabase.from("professor").select("*").order("last_name"),
        supabase.from("rooms").select("*").order("room_name"),
        supabase
          .from("time_slots")
          .select("*")
          .order("day")
          .order("start_time"),
        supabase
          .from("schedules")
          .select(SCHEDULE_SELECT)
          .eq("status", "Approved"),
      ]);
      if (!profsRes.error) setProfessors(profsRes.data || []);
      if (!roomsRes.error) setRooms(roomsRes.data || []);
      if (!slotsRes.error) setTimeSlots(slotsRes.data || []);
      if (!schedsRes.error) {
        const flattened = (schedsRes.data || []).map(flattenSchedule);
        setSessions(groupIntoSessions(flattened));
      }
    }
    loadAll();
  }, []);

  const selectedSession = sessions.find(
    (s) => s.session_id === selectedSessionId,
  );
  const sessionSchedules = selectedSession?.schedules || [];

  const curricula = [
    ...new Set(sessionSchedules.map((s) => s.curriculum_label).filter(Boolean)),
  ].sort();
  const yearLevels = [
    ...new Set(sessionSchedules.map((s) => s.year_lvl).filter(Boolean)),
  ].sort();
  const sectionOptions = [
    ...new Set(
      sessionSchedules
        .filter((s) => {
          if (filterCurriculum && s.curriculum_label !== filterCurriculum)
            return false;
          if (filterYear && s.year_lvl !== +filterYear) return false;
          return true;
        })
        .map((s) => s.section_name)
        .filter(Boolean),
    ),
  ].sort();

  const filtered = sessionSchedules.filter((s) => {
    if (filterCurriculum && s.curriculum_label !== filterCurriculum)
      return false;
    if (filterYear && s.year_lvl !== +filterYear) return false;
    if (filterSection && s.section_name !== filterSection) return false;
    return true;
  });

  const grouped = groupSchedules(filtered);

  function openEditModal(sched) {
    setEditingSchedule(sched);
    const [startH, startM] = (sched.start_time || "07:30")
      .split(":")
      .map((v) => v.padStart(2, "0"));
    const [endH, endM] = (sched.end_time || "09:00")
      .split(":")
      .map((v) => v.padStart(2, "0"));
    setEditForm({
      professor_id: sched.professor_id || null,
      room_id: sched.room_id || null,
      day: normDay(sched.day) || "Monday",
      start_h: startH,
      start_m: startM,
      end_h: endH,
      end_m: endM,
    });
    setEditError("");
    setConflictWarning(null);
    setDeleteConfirm(false);
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

  async function checkConflicts(slotId, excludeId) {
    const hard = [],
      soft = [];
    // Professor conflict — same slot
    if (editForm.professor_id) {
      const { data } = await supabase
        .from("schedules")
        .select("schedule_id")
        .eq("slot_id", slotId)
        .eq("professor_id", editForm.professor_id)
        .neq("schedule_id", excludeId);
      if (data?.length > 0)
        hard.push("Professor is already booked at this time slot.");
    }
    // Room conflict — same slot
    if (editForm.room_id) {
      const { data } = await supabase
        .from("schedules")
        .select("schedule_id")
        .eq("slot_id", slotId)
        .eq("room_id", editForm.room_id)
        .neq("schedule_id", excludeId);
      if (data?.length > 0)
        hard.push("Room is already booked at this time slot.");
    }
    // Time overlap — professor across overlapping slots (not same slot_id)
    if (editForm.professor_id) {
      const startMin = timeToMinutes(`${editForm.start_h}:${editForm.start_m}`);
      const endMin = timeToMinutes(`${editForm.end_h}:${editForm.end_m}`);
      const daySlots = timeSlots.filter(
        (t) => normDay(t.day) === editForm.day && t.slot_id !== slotId,
      );
      const overlapping = daySlots.filter((t) => {
        const tStart = timeToMinutes(t.start_time);
        const tEnd = timeToMinutes(t.end_time);
        return startMin < tEnd && endMin > tStart;
      });
      if (overlapping.length > 0) {
        const { data } = await supabase
          .from("schedules")
          .select("schedule_id")
          .eq("professor_id", editForm.professor_id)
          .in(
            "slot_id",
            overlapping.map((t) => t.slot_id),
          )
          .neq("schedule_id", excludeId);
        if (data?.length > 0)
          hard.push("Professor has an overlapping class at this time.");
      }
      // Soft: 3+ classes on same day
      const { data: dayData } = await supabase
        .from("schedules")
        .select("slot_id")
        .eq("professor_id", editForm.professor_id)
        .in(
          "slot_id",
          daySlots.map((t) => t.slot_id),
        )
        .neq("schedule_id", excludeId);
      if (dayData?.length >= 3)
        soft.push("Professor already has 3+ classes on this day.");
    }
    // Room overlap — room across overlapping slots
    if (editForm.room_id) {
      const startMin = timeToMinutes(`${editForm.start_h}:${editForm.start_m}`);
      const endMin = timeToMinutes(`${editForm.end_h}:${editForm.end_m}`);
      const daySlots = timeSlots.filter(
        (t) => normDay(t.day) === editForm.day && t.slot_id !== slotId,
      );
      const overlapping = daySlots.filter((t) => {
        const tStart = timeToMinutes(t.start_time);
        const tEnd = timeToMinutes(t.end_time);
        return startMin < tEnd && endMin > tStart;
      });
      if (overlapping.length > 0) {
        const { data } = await supabase
          .from("schedules")
          .select("schedule_id")
          .eq("room_id", editForm.room_id)
          .in(
            "slot_id",
            overlapping.map((t) => t.slot_id),
          )
          .neq("schedule_id", excludeId);
        if (data?.length > 0)
          hard.push("Room has an overlapping class at this time.");
      }
    }
    return { hard, soft };
  }

  async function handleSaveEdit() {
    setSaving(true);
    setEditError("");
    setConflictWarning(null);
    try {
      const start_time = `${editForm.start_h}:${editForm.start_m}`;
      const end_time = `${editForm.end_h}:${editForm.end_m}`;
      const slotId = await getOrCreateSlot(editForm.day, start_time, end_time);
      const conflicts = await checkConflicts(
        slotId,
        editingSchedule.schedule_id,
      );
      if (conflicts.hard.length > 0) {
        setConflictWarning(conflicts);
        setSaving(false);
        return;
      }
      if (conflicts.soft.length > 0) setConflictWarning(conflicts);

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

      const flat = flattenSchedule(data);
      setSessions((prev) =>
        prev.map((sess) => ({
          ...sess,
          schedules: sess.schedules.map((s) =>
            s.schedule_id === flat.schedule_id ? flat : s,
          ),
        })),
      );
      setEditingSchedule(null);
    } catch (err) {
      setEditError(err.message || "Something went wrong.");
    }
    setSaving(false);
  }

  async function handleDelete() {
    try {
      const { error } = await supabase
        .from("schedules")
        .delete()
        .eq("schedule_id", editingSchedule.schedule_id);
      if (error) throw error;
      setSessions((prev) =>
        prev.map((sess) => ({
          ...sess,
          schedules: sess.schedules.filter(
            (s) => s.schedule_id !== editingSchedule.schedule_id,
          ),
        })),
      );
      setEditingSchedule(null);
      setDeleteConfirm(false);
    } catch {
      setEditError("Delete failed. Please try again.");
    }
  }

  function handleConfirmExport() {
    if (!selectedSession || filtered.length === 0) return;
    const wb = XLSX.utils.book_new();
    Object.entries(groupSchedules(filtered)).forEach(
      ([currLabel, yearGroups]) => {
        const rows = [];
        Object.entries(yearGroups)
          .sort(([a], [b]) => +a - +b)
          .forEach(([yl, sectionGroups]) => {
            const yearLabel =
              YEAR_LEVELS.find((y) => y.value === +yl)?.label || `Year ${yl}`;
            Object.entries(sectionGroups)
              .sort(([a], [b]) => a.localeCompare(b))
              .forEach(([secName, schedules]) => {
                rows.push({
                  "Course Code": `${yearLabel} · ${secName}`,
                  "Course Name": "",
                  Professor: "",
                  Room: "",
                  Day: "",
                  Time: "",
                  Status: "",
                });
                sortSchedules(schedules).forEach((sched) => {
                  rows.push({
                    "Course Code": sched.course_code || "",
                    "Course Name": sched.course_name || "",
                    Professor: sched.professor_name || "Unassigned",
                    Room: sched.room_name || "TBA",
                    Day: normDay(sched.day) || "",
                    Time:
                      sched.start_time && sched.end_time
                        ? `${sched.start_time} - ${sched.end_time}`
                        : "",
                    Status: sched.status || "",
                  });
                });
                rows.push({
                  "Course Code": "",
                  "Course Name": "",
                  Professor: "",
                  Room: "",
                  Day: "",
                  Time: "",
                  Status: "",
                });
              });
          });
        const ws = XLSX.utils.json_to_sheet(rows);
        ws["!cols"] = [
          { wch: 14 },
          { wch: 36 },
          { wch: 22 },
          { wch: 14 },
          { wch: 12 },
          { wch: 22 },
          { wch: 12 },
        ];
        XLSX.utils.book_append_sheet(
          wb,
          ws,
          currLabel.replace(/[/\\?*[\]]/g, "").slice(0, 31),
        );
      },
    );
    XLSX.writeFile(
      wb,
      `Schedule_${selectedSession.school_year}_${getSemesterLabel(selectedSession.semester).replace(/\s/g, "_")}.xlsx`,
    );
    setPreviewOpen(false);
  }

  return (
    <div className="vs-wrapper">
      <header className="vs-topbar">
        <div className="vs-brand">
          OrangeTail <span>Scheduling System</span>
        </div>
      </header>

      <div className="vs-inner-bar">
        <button className="vs-back-btn" onClick={onBack}>
          <i className="ti ti-chevron-left" /> Menu
        </button>
        <span className="vs-sep">/</span>
        <span className="vs-screen-title">View Schedules</span>
        <div className="vs-inner-bar-right">
          <button
            className="vs-export-btn"
            onClick={() => {
              setPreviewSection(null);
              setPreviewOpen(true);
            }}
            disabled={!selectedSession || filtered.length === 0}
          >
            <i className="ti ti-file-spreadsheet" /> Export Excel
          </button>
        </div>
      </div>

      <div className="vs-filters-bar">
        <div className="vs-filter-group">
          <label>Session</label>
          <select
            className="vs-filter-select"
            value={selectedSessionId}
            onChange={(e) => {
              setSelectedSessionId(e.target.value);
              setFilterCurriculum("");
              setFilterYear("");
              setFilterSection("");
            }}
          >
            <option value="">— Select session —</option>
            {sessions.map((s) => (
              <option key={s.session_id} value={s.session_id}>
                {s.school_year} · {getSemesterLabel(s.semester)} ·{" "}
                {new Date(s.generated_at).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>

        {selectedSession && (
          <>
            <div className="vs-filter-group">
              <label>Curriculum</label>
              <select
                className="vs-filter-select"
                value={filterCurriculum}
                onChange={(e) => {
                  setFilterCurriculum(e.target.value);
                  setFilterSection("");
                }}
              >
                <option value="">All curricula</option>
                {curricula.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="vs-filter-group">
              <label>Year level</label>
              <select
                className="vs-filter-select"
                value={filterYear}
                onChange={(e) => {
                  setFilterYear(e.target.value);
                  setFilterSection("");
                }}
              >
                <option value="">All year levels</option>
                {yearLevels.map((yl) => (
                  <option key={yl} value={yl}>
                    {YEAR_LEVELS.find((y) => y.value === yl)?.label ||
                      `Year ${yl}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="vs-filter-group">
              <label>Section</label>
              <select
                className="vs-filter-select"
                value={filterSection}
                onChange={(e) => setFilterSection(e.target.value)}
              >
                <option value="">All sections</option>
                {sectionOptions.map((sec) => (
                  <option key={sec} value={sec}>
                    {sec}
                  </option>
                ))}
              </select>
            </div>
            <div className="vs-filter-group vs-filter-group-right">
              <span
                className={`vs-status-badge vs-status-badge-lg ${getStatusClass(selectedSession.status)}`}
              >
                {selectedSession.status}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="vs-content">
        {!selectedSession ? (
          <div className="vs-empty">
            <i className="ti ti-calendar" />
            <p>Select a session above to view its schedules.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="vs-empty">
            <i className="ti ti-calendar-off" />
            <p>No schedules found for the selected filters.</p>
          </div>
        ) : (
          <div className="vs-groups">
            {Object.entries(grouped).map(([currLabel, yearGroups]) => (
              <div key={currLabel} className="vs-curr-group">
                <div className="vs-curr-header">
                  <i className="ti ti-books" />
                  {currLabel}
                </div>
                {Object.entries(yearGroups)
                  .sort(([a], [b]) => +a - +b)
                  .map(([yl, sectionGroups]) => (
                    <div key={yl} className="vs-year-group">
                      {Object.entries(sectionGroups)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([secName, schedules]) => (
                          <div key={secName} className="vs-section-group">
                            <div className="vs-section-header">
                              <span className="vs-section-yr">
                                {YEAR_LEVELS.find((y) => y.value === +yl)
                                  ?.label || `Year ${yl}`}
                              </span>
                              <span className="vs-section-sep">·</span>
                              <span className="vs-section-name">{secName}</span>
                              <span className="vs-section-count">
                                {schedules.length} subject
                                {schedules.length !== 1 ? "s" : ""}
                              </span>
                            </div>
                            <div className="vs-table-wrap">
                              <table className="vs-table">
                                <thead>
                                  <tr>
                                    <th>Course Code</th>
                                    <th>Course Name</th>
                                    <th>Professor</th>
                                    <th>Room</th>
                                    <th>Day</th>
                                    <th>Time</th>
                                    <th>Status</th>
                                    <th></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {schedules.map((sched) => (
                                    <tr
                                      key={sched.schedule_id}
                                      className="vs-table-row"
                                      onClick={() => openEditModal(sched)}
                                    >
                                      <td className="vs-td-code">
                                        {sched.course_code}
                                      </td>
                                      <td>{sched.course_name}</td>
                                      <td>
                                        {sched.professor_name || (
                                          <span className="vs-unassigned">
                                            Unassigned
                                          </span>
                                        )}
                                      </td>
                                      <td>
                                        {sched.room_name || (
                                          <span className="vs-unassigned">
                                            TBA
                                          </span>
                                        )}
                                      </td>
                                      <td>
                                        {sched.day ? (
                                          <span className="vs-day-badge">
                                            {normDay(sched.day).slice(0, 3)}
                                          </span>
                                        ) : (
                                          "—"
                                        )}
                                      </td>
                                      <td className="vs-td-time">
                                        {sched.start_time} – {sched.end_time}
                                      </td>
                                      <td>
                                        <span
                                          className={`vs-status-badge ${getStatusClass(sched.status)}`}
                                        >
                                          {sched.status}
                                        </span>
                                      </td>
                                      <td>
                                        <button
                                          className="vs-edit-row-btn"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openEditModal(sched);
                                          }}
                                        >
                                          <i className="ti ti-edit" />
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ))}
                    </div>
                  ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editingSchedule && (
        <div
          className="vs-modal-overlay"
          onClick={() => {
            setEditingSchedule(null);
            setDeleteConfirm(false);
          }}
        >
          <div className="vs-edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vs-edit-modal-header">
              <div>
                <div className="vs-edit-modal-title">Edit Schedule</div>
                <div className="vs-edit-modal-sub">
                  {editingSchedule.course_code} — {editingSchedule.course_name}{" "}
                  · {editingSchedule.section_name}
                </div>
              </div>
              <button
                className="vs-modal-close"
                onClick={() => {
                  setEditingSchedule(null);
                  setDeleteConfirm(false);
                }}
              >
                <i className="ti ti-x" />
              </button>
            </div>

            <div className="vs-edit-modal-body">
              <div className="vs-edit-current">
                <div className="vs-edit-current-label">Current assignment</div>
                <div className="vs-edit-current-row">
                  <span>
                    <i className="ti ti-user" />{" "}
                    {editingSchedule.professor_name || "Unassigned"}
                  </span>
                  <span>
                    <i className="ti ti-building" />{" "}
                    {editingSchedule.room_name || "TBA"}
                  </span>
                  <span>
                    <i className="ti ti-clock" /> {normDay(editingSchedule.day)}{" "}
                    {editingSchedule.start_time}–{editingSchedule.end_time}
                  </span>
                </div>
              </div>

              {editError && (
                <div className="vs-edit-error">
                  <i className="ti ti-alert-circle" />
                  {editError}
                </div>
              )}

              {conflictWarning?.hard.length > 0 && (
                <div className="vs-conflict-hard">
                  <i className="ti ti-alert-circle" />
                  <div>
                    <div className="vs-conflict-label">
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
                  <div className="vs-conflict-soft">
                    <i className="ti ti-alert-triangle" />
                    <div>
                      <div className="vs-conflict-label">Warning</div>
                      {conflictWarning.soft.map((c, i) => (
                        <div key={i}>{c}</div>
                      ))}
                    </div>
                  </div>
                )}

              {!deleteConfirm ? (
                <>
                  <div className="vs-edit-field">
                    <label>Professor</label>
                    <select
                      className="vs-edit-select"
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
                      <option value="">— Select professor —</option>
                      {professors.map((p) => (
                        <option key={p.professor_id} value={p.professor_id}>
                          {p.last_name}, {p.first_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="vs-edit-field">
                    <label>Room</label>
                    <select
                      className="vs-edit-select"
                      value={editForm.room_id ?? ""}
                      onChange={(e) => {
                        setEditForm((p) => ({
                          ...p,
                          room_id: e.target.value
                            ? Number(e.target.value)
                            : null,
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

                  <div className="vs-edit-field">
                    <label>Day & time</label>
                    <div className="vs-time-row">
                      <select
                        className="vs-edit-select vs-day-sel"
                        value={editForm.day}
                        onChange={(e) => {
                          setEditForm((p) => ({ ...p, day: e.target.value }));
                          setConflictWarning(null);
                        }}
                      >
                        {DAY_ORDER.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                      <div className="vs-time-wheel">
                        <select
                          className="vs-time-sel"
                          value={editForm.start_h}
                          onChange={(e) => {
                            setEditForm((p) => ({
                              ...p,
                              start_h: e.target.value,
                            }));
                            setConflictWarning(null);
                          }}
                        >
                          {HOURS.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                        <span className="vs-time-colon">:</span>
                        <select
                          className="vs-time-sel vs-time-sel-min"
                          value={editForm.start_m}
                          onChange={(e) => {
                            setEditForm((p) => ({
                              ...p,
                              start_m: e.target.value,
                            }));
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
                      <span className="vs-time-sep">to</span>
                      <div className="vs-time-wheel">
                        <select
                          className="vs-time-sel"
                          value={editForm.end_h}
                          onChange={(e) => {
                            setEditForm((p) => ({
                              ...p,
                              end_h: e.target.value,
                            }));
                            setConflictWarning(null);
                          }}
                        >
                          {HOURS.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                        <span className="vs-time-colon">:</span>
                        <select
                          className="vs-time-sel vs-time-sel-min"
                          value={editForm.end_m}
                          onChange={(e) => {
                            setEditForm((p) => ({
                              ...p,
                              end_m: e.target.value,
                            }));
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

                  <div className="vs-edit-note">
                    <i className="ti ti-info-circle" />
                    Hard conflicts block saving. Soft warnings allow saving with
                    caution.
                  </div>
                </>
              ) : (
                <div className="vs-delete-confirm">
                  <i className="ti ti-alert-triangle vs-delete-icon" />
                  <div className="vs-delete-msg">
                    Are you sure you want to delete this schedule?
                    <br />
                    <strong>
                      {editingSchedule.course_code} —{" "}
                      {editingSchedule.section_name}
                    </strong>
                    <br />
                    This cannot be undone.
                  </div>
                </div>
              )}
            </div>

            <div className="vs-edit-modal-footer">
              {!deleteConfirm ? (
                <>
                  <button
                    className="vs-delete-btn"
                    onClick={() => setDeleteConfirm(true)}
                  >
                    <i className="ti ti-trash" /> Delete
                  </button>
                  <div className="vs-footer-right">
                    <button
                      className="vs-cancel-btn"
                      onClick={() => setEditingSchedule(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className="vs-save-btn"
                      onClick={handleSaveEdit}
                      disabled={saving || conflictWarning?.hard.length > 0}
                    >
                      {saving ? (
                        "Saving..."
                      ) : (
                        <>
                          <i className="ti ti-device-floppy" /> Save changes
                        </>
                      )}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <button
                    className="vs-cancel-btn"
                    onClick={() => setDeleteConfirm(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="vs-confirm-delete-btn"
                    onClick={handleDelete}
                  >
                    <i className="ti ti-trash" /> Yes, delete
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Export preview — exact same structure as approve_session_modal */}
      {previewOpen &&
        (() => {
          const activePreviewSection =
            previewSection ||
            (() => {
              const firstCurr = Object.values(grouped)[0];
              const firstYl = firstCurr ? Object.values(firstCurr)[0] : null;
              const firstSec = firstYl ? Object.keys(firstYl)[0] : null;
              return firstSec && firstYl
                ? {
                    section_id: firstSec,
                    section_name: firstSec,
                    schedules: firstYl[firstSec],
                  }
                : null;
            })();
          return (
            <div className="apm-overlay" onClick={() => setPreviewOpen(false)}>
              <div
                className="apm-preview-modal"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="apm-header">
                  <div>
                    <div className="apm-title">
                      Export Preview — {selectedSession?.school_year} ·{" "}
                      {getSemesterLabel(selectedSession?.semester)}
                    </div>
                    <div className="apm-sub">
                      Review schedules before exporting to Excel.
                    </div>
                  </div>
                  <div className="apm-header-actions">
                    <button
                      className="apm-cancel-btn"
                      onClick={() => setPreviewOpen(false)}
                    >
                      Cancel
                    </button>
                    <button
                      className="apm-approve-btn"
                      onClick={handleConfirmExport}
                    >
                      <i className="ti ti-download" /> Confirm & Export
                    </button>
                  </div>
                </div>

                <div className="apm-split">
                  <div className="apm-section-list">
                    {Object.entries(grouped).map(([currLabel, yearGroups]) => (
                      <div key={currLabel} className="apm-list-curriculum">
                        <div className="apm-list-curr-label">
                          <i className="ti ti-books" aria-hidden="true" />{" "}
                          {currLabel}
                        </div>
                        {Object.entries(yearGroups)
                          .sort(([a], [b]) => +a - +b)
                          .map(([yl, sectionGroups]) => (
                            <div key={yl} className="apm-list-yr-group">
                              <div className="apm-list-yr-label">
                                {YEAR_LEVELS.find((y) => y.value === +yl)
                                  ?.label || `Year ${yl}`}
                              </div>
                              {Object.entries(sectionGroups)
                                .sort(([a], [b]) => a.localeCompare(b))
                                .map(([secName, scheds]) => (
                                  <button
                                    key={secName}
                                    className={`apm-list-item ${activePreviewSection?.section_id === secName ? "apm-list-item-active" : ""}`}
                                    onClick={() =>
                                      setPreviewSection({
                                        section_id: secName,
                                        section_name: secName,
                                        schedules: scheds,
                                      })
                                    }
                                  >
                                    <span className="apm-list-item-name">
                                      {secName}
                                    </span>
                                    <span className="apm-list-item-count">
                                      {scheds.length}
                                    </span>
                                  </button>
                                ))}
                            </div>
                          ))}
                      </div>
                    ))}
                  </div>

                  <div className="apm-table-panel">
                    {activePreviewSection ? (
                      <>
                        <div className="apm-table-header">
                          <div className="apm-table-header-name">
                            {activePreviewSection.section_name}
                          </div>
                          <div className="apm-table-header-count">
                            {activePreviewSection.schedules.length} schedule
                            {activePreviewSection.schedules.length !== 1
                              ? "s"
                              : ""}
                          </div>
                        </div>
                        <div className="apm-table-scroll">
                          <table className="apm-table">
                            <thead>
                              <tr>
                                <th>Course</th>
                                <th>Professor</th>
                                <th>Room</th>
                                <th>Day</th>
                                <th>Time</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sortSchedules(
                                activePreviewSection.schedules,
                              ).map((sched, idx) => (
                                <tr key={sched.schedule_id || idx}>
                                  <td>
                                    <div className="apm-course-code">
                                      {sched.course_code || "—"}
                                    </div>
                                    <div className="apm-course-name">
                                      {sched.course_name || ""}
                                    </div>
                                  </td>
                                  <td>
                                    {sched.professor_name ? (
                                      sched.professor_name
                                    ) : (
                                      <span className="apm-unassigned">
                                        Unassigned
                                      </span>
                                    )}
                                  </td>
                                  <td>{sched.room_name || "—"}</td>
                                  <td>
                                    {sched.day ? (
                                      <span className="apm-day-badge">
                                        {normDay(sched.day).slice(0, 3)}
                                      </span>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                  <td className="apm-time">
                                    {sched.start_time} – {sched.end_time}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    ) : (
                      <div className="apm-table-empty">
                        <i className="ti ti-calendar" aria-hidden="true" />
                        <p>Select a section to view its schedules.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
