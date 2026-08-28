export const SEMESTERS = [
  { value: 1, label: "1st Semester" },
  { value: 2, label: "2nd Semester" },
  { value: 3, label: "Summer" },
];

export const YEAR_LEVELS = [
  { value: 1, label: "1st Year" },
  { value: 2, label: "2nd Year" },
  { value: 3, label: "3rd Year" },
  { value: 4, label: "4th Year" },
];

export const DAYS_OF_WEEK = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export const HOURS = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, "0"),
);
export const MINUTES = [
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

export const SCHEDULE_SELECT = `
  schedule_id,
  status,
  generated_at,
  professor_id,
  room_id,
  slot_id,
  offering_id,
  time_slots ( day, start_time, end_time ),
  professor ( first_name, last_name ),
  rooms ( room_name ),
  class_offerings (
    class_code,
    school_year,
    semester,
    courses ( course_code, course_name ),
    section (
      section_id,
      section_name,
      year_lvl,
      curricula ( curriculum_year, programs ( program_code ) )
    )
  )
`;

export function getSemesterLabel(val) {
  return SEMESTERS.find((s) => s.value === val)?.label || "—";
}

export function getStatusClass(status) {
  if (status === "Approved") return "gen-status-approved";
  if (status === "Generated") return "gen-status-generated";
  return "gen-status-draft";
}

export function flattenSchedule(row) {
  const section = row.class_offerings?.section;
  const curriculum = section?.curricula;
  const program = curriculum?.programs;
  return {
    schedule_id: row.schedule_id,
    status: row.status,
    generated_at: row.generated_at,
    professor_id: row.professor_id,
    room_id: row.room_id,
    room_name: row.rooms?.room_name || null,
    slot_id: row.slot_id,
    offering_id: row.offering_id,
    day: row.time_slots?.day,
    start_time: row.time_slots?.start_time,
    end_time: row.time_slots?.end_time,
    professor_name: row.professor
      ? `${row.professor.first_name} ${row.professor.last_name}`
      : null,
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

export function groupSchedulesIntoSessions(scheduleList) {
  const groups = {};
  scheduleList.forEach((s) => {
    if (!s.school_year || !s.semester || !s.generated_at) return;
    // Use full ISO timestamp — rows in the same generation run share the same
    // generated_at value so they group together; different runs produce a different timestamp.
    const key = `${s.school_year}-${s.semester}-${s.generated_at}`;
    if (!groups[key]) {
      groups[key] = {
        session_id: key,
        school_year: s.school_year,
        semester: s.semester,
        status: s.status,
        generated_at: s.generated_at,
        sections: [],
      };
    }
    const existing = groups[key].sections.find(
      (sec) => sec.section_id === s.section_id,
    );
    if (existing) {
      existing.schedules.push(s);
    } else {
      groups[key].sections.push({
        section_id: s.section_id,
        section_name: s.section_name,
        year_lvl: s.year_lvl,
        curriculum_label: s.curriculum_label,
        schedules: [s],
      });
    }
    const statusOrder = { Draft: 0, Generated: 1, Approved: 2 };
    if (statusOrder[s.status] < statusOrder[groups[key].status])
      groups[key].status = s.status;
  });
  return Object.values(groups).sort(
    (a, b) => new Date(b.generated_at) - new Date(a.generated_at),
  );
}

export function groupSectionsByCurriculum(sections) {
  const groups = {};
  (sections || []).forEach((s) => {
    const key = s.curriculum_label || "Summer Courses";
    if (!groups[key]) groups[key] = {};
    const yl = s.year_lvl ?? "summer";
    if (!groups[key][yl]) groups[key][yl] = [];
    groups[key][yl].push(s);
  });
  // Sort sections alphabetically within each year level
  Object.values(groups).forEach((ylGroups) =>
    Object.keys(ylGroups).forEach((yl) => {
      ylGroups[yl].sort((a, b) =>
        (a.section_name || "").localeCompare(b.section_name || ""),
      );
    }),
  );
  return groups;
}

export function entryToTime(e) {
  return {
    day: e.day,
    start_time: `${e.start_h}:${e.start_m}`,
    end_time: `${e.end_h}:${e.end_m}`,
  };
}

function toMinutes(t) {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return (
    toMinutes(aStart) < toMinutes(bEnd) && toMinutes(aEnd) > toMinutes(bStart)
  );
}

export function checkIntraBatchConflicts(entries) {
  return entries.map((entry, idx) => {
    const hard = [];
    const {
      day: eDay,
      start_time: eStart,
      end_time: eEnd,
    } = entryToTime(entry);
    if (!eDay || !eStart || !eEnd) return { hard: [], soft: [] };

    entries.forEach((other, otherIdx) => {
      if (otherIdx === idx) return;
      const {
        day: oDay,
        start_time: oStart,
        end_time: oEnd,
      } = entryToTime(other);
      if (eDay !== oDay) return;
      if (!overlaps(eStart, eEnd, oStart, oEnd)) return;

      if (entry.professor_id && entry.professor_id === other.professor_id)
        hard.push("Same professor has an overlapping course in this batch.");
      if (entry.room_id && entry.room_id === other.room_id)
        hard.push("Same room has an overlapping course in this batch.");
    });
    return { hard: [...new Set(hard)], soft: [] };
  });
}

export const BLANK_ENTRY = {
  course_id: "",
  professor_id: "",
  room_id: "",
  day: "Monday",
  start_h: "00",
  start_m: "00",
  end_h: "00",
  end_m: "00",
  lec_single: true,
  lec_pair: 0,
  lec_day: "Monday",
  conflicts: { hard: [], soft: [] },
};
