import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseClient";
import {
  YEAR_LEVELS,
  SCHEDULE_SELECT,
  BLANK_ENTRY,
  flattenSchedule,
  groupSchedulesIntoSessions,
  groupSectionsByCurriculum,
  getSemesterLabel,
  getStatusClass,
  entryToTime,
  checkIntraBatchConflicts,
} from "./generate_utils";
import GenerateDialog from "./generate_dialog";
import ViolationDrilldownDialog from "./violation_drilldown_dialog";
import CreateSummerModal from "./summer/create_summer_modal";
import AddSectionModal from "./sections/add_section_modal";
import AddSummerCourseModal from "./summer/add_summer_course_modal";
import SectionSchedulesModal from "./sections/section_schedules_modal";
import ApproveSessionModal from "./sessions/approve_session_modal";
import "./generate_screen.css";

const CURRENT_YEAR = new Date().getFullYear();

function isMajor(courseCode) {
  return (courseCode || "").startsWith("6");
}
function normDay(d) {
  if (!d) return d;
  const MAP = {
    mon: "Monday",
    tue: "Tuesday",
    wed: "Wednesday",
    thu: "Thursday",
    fri: "Friday",
    sat: "Saturday",
    sun: "Sunday",
  };
  const FULL = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];
  const lower = d.toLowerCase().trim();
  return FULL.find((x) => x.toLowerCase() === lower) || MAP[lower] || d;
}
function normTime(t) {
  if (!t) return t;
  const match12 = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12) {
    let h = parseInt(match12[1], 10);
    const m = match12[2];
    const period = match12[3].toUpperCase();
    if (period === "AM" && h === 12) h = 0;
    if (period === "PM" && h !== 12) h += 12;
    return `${String(h).padStart(2, "0")}:${m}`;
  }
  return t.split(":").slice(0, 2).join(":");
}
function slotKey(day, start, end) {
  return `${normDay(day)}|${normTime(start)}|${normTime(end)}`;
}

export default function GenerateScreen({ onBack, onViewSchedules }) {
  const [curricula, setCurricula] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [professors, setProfessors] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [timeSlots, setTimeSlots] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [allCourses, setAllCourses] = useState([]);

  const [selectedSession, setSelectedSession] = useState(null);
  const [selectedSection, setSelectedSection] = useState(null);
  const [deleteSessionConfirm, setDeleteSessionConfirm] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [generateWarning, setGenerateWarning] = useState(null);
  const [drilldownOpen, setDrilldownOpen] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [schoolYearStart, setSchoolYearStart] = useState(CURRENT_YEAR);
  const [schoolYearEnd, setSchoolYearEnd] = useState(CURRENT_YEAR + 1);
  const [semester, setSemester] = useState(null);
  const [curriculumSelections, setCurriculumSelections] = useState({});

  const [summerOpen, setSummerOpen] = useState(false);
  const [summerStep, setSummerStep] = useState(1);
  const [summerEntries, setSummerEntries] = useState([]);
  const [summerSaving, setSummerSaving] = useState(false);

  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [addSectionStep, setAddSectionStep] = useState(1);
  const [addSummerCourseOpen, setAddSummerCourseOpen] = useState(false);

  const [approvePreviewOpen, setApprovePreviewOpen] = useState(false);
  const [approveConfirm, setApproveConfirm] = useState(false);

  useEffect(() => {
    fetchCurricula();
    fetchPrograms();
    fetchProfessors();
    fetchRooms();
    fetchTimeSlots();
    fetchSchedules();
    fetchCourses();
  }, []);

  async function fetchCurricula() {
    const { data } = await supabase
      .from("curricula")
      .select("*")
      .eq("is_active", true)
      .order("curriculum_year");
    setCurricula(data || []);
  }
  async function fetchPrograms() {
    const { data } = await supabase
      .from("programs")
      .select("*")
      .order("program_code");
    setPrograms(data || []);
  }
  async function fetchProfessors() {
    const { data } = await supabase
      .from("professor")
      .select("*")
      .order("last_name");
    setProfessors(data || []);
  }
  async function fetchRooms() {
    const { data } = await supabase
      .from("rooms")
      .select("*")
      .order("room_name");
    setRooms(data || []);
  }
  async function fetchTimeSlots() {
    const { data } = await supabase
      .from("time_slots")
      .select("*")
      .order("day")
      .order("start_time");
    setTimeSlots(data || []);
  }
  async function fetchCourses() {
    const { data } = await supabase
      .from("courses")
      .select("course_id, course_code, course_name")
      .order("course_code");
    setAllCourses(data || []);
  }
  async function fetchSchedules() {
    const { data, error } = await supabase
      .from("schedules")
      .select(SCHEDULE_SELECT);
    if (error) {
      console.error(error);
      return;
    }
    const grouped = groupSchedulesIntoSessions(
      (data || []).map(flattenSchedule),
    );
    setSessions(grouped);
    return grouped;
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

  function toMinutes(t) {
    if (!t) return 0;
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  }

  async function checkClassConflicts(assignment) {
    const hard = [],
      soft = [];
    const { day, start_time, end_time } = entryToTime(assignment);
    if (!day || !start_time || !end_time) return { hard, soft };

    const startMin = toMinutes(start_time);
    const endMin = toMinutes(end_time);

    // Get all slots on the same day
    const daySlots = timeSlots.filter((t) => t.day === day);
    // Find overlapping slots
    const overlappingSlotIds = daySlots
      .filter(
        (t) =>
          toMinutes(t.start_time) < endMin && toMinutes(t.end_time) > startMin,
      )
      .map((t) => t.slot_id);

    if (overlappingSlotIds.length === 0) return { hard, soft };

    // Professor overlap check
    if (assignment.professor_id) {
      const { data } = await supabase
        .from("schedules")
        .select("schedule_id")
        .eq("professor_id", assignment.professor_id)
        .in("slot_id", overlappingSlotIds)
        .limit(1);
      if (data?.length > 0)
        hard.push("Professor has an overlapping class at this time.");

      // Soft: 3+ classes on same day
      const allDaySlotIds = daySlots.map((t) => t.slot_id);
      const { data: dayData } = await supabase
        .from("schedules")
        .select("slot_id")
        .eq("professor_id", assignment.professor_id)
        .in("slot_id", allDaySlotIds);
      if ((dayData?.length || 0) >= 3)
        soft.push("Professor already has 3+ classes on this day.");
    }

    // Room overlap check
    if (assignment.room_id) {
      const { data } = await supabase
        .from("schedules")
        .select("schedule_id")
        .eq("room_id", assignment.room_id)
        .in("slot_id", overlappingSlotIds)
        .limit(1);
      if (data?.length > 0)
        hard.push("Room has an overlapping class at this time.");
    }

    return { hard, soft };
  }

  async function runConflictCheck(entries) {
    const intraBatch = checkIntraBatchConflicts(entries);
    return Promise.all(
      entries.map(async (e, idx) => {
        const db = await checkClassConflicts(e);
        return {
          ...e,
          conflicts: {
            hard: [...new Set([...intraBatch[idx].hard, ...db.hard])],
            soft: db.soft,
          },
        };
      }),
    );
  }

  async function handleSaveSummer() {
    setSummerSaving(true);
    try {
      const schoolYear = `${schoolYearStart}-${schoolYearEnd}`;
      const generatedAt = new Date().toISOString();
      const LECTURE_PAIRS_SUM = [
        { days: ["Monday", "Thursday"] },
        { days: ["Tuesday", "Friday"] },
        { days: ["Wednesday", "Saturday"] },
      ];

      for (const e of summerEntries) {
        if (!e.course_id) continue;
        const start_time = `${e.start_h}:${e.start_m}`;
        const end_time = `${e.end_h}:${e.end_m}`;
        const isSingle = e.lec_single ?? true;
        const days = isSingle
          ? [e.lec_day || "Monday"]
          : LECTURE_PAIRS_SUM[e.lec_pair ?? 0].days;

        // Get or create offering once
        const course = allCourses.find(
          (c) => c.course_id === Number(e.course_id),
        );
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

        // Insert a schedule row for each day
        for (const day of days) {
          const slotId = await getOrCreateSlot(day, start_time, end_time);
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
      await supabase.from("change_log").insert({
        action: "Created summer schedule",
        entity: `${schoolYearStart}-${schoolYearEnd}`,
        details: `${summerEntries.length} course(s)`,
      });
      await fetchSchedules();
      setSummerOpen(false);
      setSummerStep(1);
      setSummerEntries([]);
    } catch (err) {
      console.error(err);
    }
    setSummerSaving(false);
  }

  async function handleGenerate() {
    setDialogOpen(false);
    setGenerating(true);
    setGenerateError("");
    setGenerateWarning(null);
    const blockRequests = Object.entries(curriculumSelections).flatMap(
      ([id, v]) =>
        v.checked
          ? Object.entries(v.yearLevels)
              .filter(([, yl]) => yl.checked)
              .map(([yl, d]) => ({
                curriculum_id: Number(id),
                year_lvl: Number(yl),
                num_blocks: Number(d.sections),
              }))
          : [],
    );
    try {
      const apiUrl = import.meta.env.VITE_ALGORITHM_API_URL;
      if (!apiUrl) throw new Error("VITE_ALGORITHM_API_URL is not set.");

      // Required when apiUrl points at an ngrok tunnel -- ngrok's free tier
      // injects an HTML warning page on the first request from any client
      // unless this header is present, which would otherwise break these
      // fetches (JSON expected, HTML received). Harmless against a normal
      // server, which just ignores an unrecognized header.
      const ngrokHeaders = { "ngrok-skip-browser-warning": "true" };

      // 1. Start the job. This returns almost immediately with a job ID,
      // rather than holding one connection open for the full generation,
      // which can take up to an hour or more. Polling below replaces that
      // single long-lived connection with short, independent checks -- no
      // one request has to survive the whole computation, so a dropped
      // connection just means the next poll retries moments later, not a
      // lost result.
      const startRes = await fetch(`${apiUrl}/api/generate-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...ngrokHeaders },
        body: JSON.stringify({
          school_year: `${schoolYearStart}-${schoolYearEnd}`,
          semester: Number(semester),
          block_requests: blockRequests,
        }),
      });
      if (!startRes.ok) {
        const body = await startRes.json().catch(() => null);
        throw new Error(
          body?.detail || `Generation failed to start (${startRes.status}).`,
        );
      }
      const { job_id: jobId } = await startRes.json();

      // 2. Poll for completion every few seconds.
      const POLL_INTERVAL_MS = 4000;
      const MAX_POLL_HOURS = 3;
      const maxAttempts = Math.ceil(
        (MAX_POLL_HOURS * 60 * 60 * 1000) / POLL_INTERVAL_MS,
      );

      let job = null;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        const pollRes = await fetch(
          `${apiUrl}/api/generate-schedule/${jobId}`,
          { headers: ngrokHeaders },
        );
        if (!pollRes.ok) {
          if (pollRes.status === 404) {
            throw new Error(
              "The generation job could not be found — the backend may have restarted while this was running. Please try generating again.",
            );
          }
          const body = await pollRes.json().catch(() => null);
          throw new Error(
            body?.detail ||
              `Checking generation status failed (${pollRes.status}).`,
          );
        }
        job = await pollRes.json();
        if (job.status === "complete" || job.status === "failed") break;
      }

      if (!job || job.status === "running") {
        throw new Error(
          "Generation is taking longer than expected and this session stopped waiting. The backend may still be working on it — check the terminal, or try again shortly.",
        );
      }
      if (job.status === "failed") {
        throw new Error(job.error || "Generation failed.");
      }

      const {
        schedule: items,
        hard_violations: hardViolations,
        violation_breakdown: violationBreakdown,
        violation_drilldowns: violationDrilldowns,
      } = job.result;
      if (!items?.length)
        throw new Error("The algorithm didn't return any schedule items.");

      const generatedAt = new Date().toISOString();
      const schoolYearStr = `${schoolYearStart}-${schoolYearEnd}`;
      const sem = Number(semester);

      // 1. Fetch reference data
      const [
        { data: allCurricula },
        { data: existingSections },
        { data: allCoursesData },
      ] = await Promise.all([
        supabase
          .from("curricula")
          .select("curriculum_id, curriculum_year, programs(program_code)")
          .eq("is_active", true),
        supabase.from("section").select("section_id, section_name"),
        supabase
          .from("courses")
          .select("course_id, course_code")
          .order("course_code"),
      ]);

      const curriculumIdMap = {};
      (allCurricula || []).forEach((c) => {
        const label =
          `${c.programs?.program_code || ""} ${c.curriculum_year}`.trim();
        curriculumIdMap[label] = c.curriculum_id;
      });
      const sectionMap = {};
      const sectionNameById = {};
      (existingSections || []).forEach((s) => {
        sectionMap[s.section_name] = s.section_id;
        sectionNameById[s.section_id] = s.section_name;
      });

      // Build courseMap — key by trimmed uppercase code to handle any whitespace differences
      const courseMap = {};
      const courseCodeById = {};
      (allCoursesData || []).forEach((c) => {
        const key = (c.course_code || "").trim().toUpperCase();
        courseMap[key] = c.course_id;
        courseCodeById[c.course_id] = c.course_code;
      });

      // 2. Create missing sections
      const uniqueSections = [
        ...new Map(items.map((it) => [it.section_name, it])).values(),
      ];
      const sectionsToCreate = uniqueSections.filter(
        (it) => !sectionMap[it.section_name],
      );
      if (sectionsToCreate.length > 0) {
        const { data: newSections, error: secErr } = await supabase
          .from("section")
          .insert(
            sectionsToCreate.map((it) => ({
              section_name: it.section_name,
              curriculum_id:
                it.curriculum_id ??
                curriculumIdMap[it.curriculum_label] ??
                null,
              year_lvl: it.year_lvl,
            })),
          )
          .select("section_id, section_name");
        if (secErr) throw secErr;
        (newSections || []).forEach((s) => {
          sectionMap[s.section_name] = s.section_id;
        });
      }

      // 3. Create missing time slots
      const { data: existingSlots } = await supabase
        .from("time_slots")
        .select("slot_id, day, start_time, end_time");
      const slotMap = {};
      (existingSlots || []).forEach((s) => {
        slotMap[slotKey(s.day, s.start_time, s.end_time)] = s.slot_id;
      });
      const uniqueSlots = [
        ...new Map(
          items.map((it) => [slotKey(it.day, it.start_time, it.end_time), it]),
        ).values(),
      ];
      for (const it of uniqueSlots.filter(
        (it) => !slotMap[slotKey(it.day, it.start_time, it.end_time)],
      )) {
        await supabase.from("time_slots").insert({
          day: normDay(it.day),
          start_time: normTime(it.start_time),
          end_time: normTime(it.end_time),
        });
      }
      const { data: refreshedSlots } = await supabase
        .from("time_slots")
        .select("slot_id, day, start_time, end_time");
      (refreshedSlots || []).forEach((s) => {
        slotMap[slotKey(s.day, s.start_time, s.end_time)] = s.slot_id;
      });

      // 4. Create missing class_offerings
      // Normalize algorithm course codes the same way as courseMap keys
      const getCourseId = (it) =>
        it.course_id || courseMap[(it.course_code || "").trim().toUpperCase()];

      const offeringKeys = [
        ...new Map(
          items.map((it) => {
            const sId = sectionMap[it.section_name];
            const cId = getCourseId(it);
            return [`${sId}|${cId}`, { section_id: sId, course_id: cId }];
          }),
        ).values(),
      ].filter((o) => o.section_id && o.course_id);

      const computeClassCode = (sectionId, courseId) => {
        const secName = (
          sectionNameById[sectionId] || String(sectionId)
        )
          .replace(/\s+/g, "")
          .replace(/-/g, "");
        const courseCode = courseCodeById[courseId] || String(courseId);
        const yrShort = schoolYearStr.replace(/20(\d{2})-20(\d{2})/, "$1$2");
        return `${courseCode}-${secName}-${yrShort}-${sem}`;
      };

      const { data: existingOfferings } = await supabase
        .from("class_offerings")
        .select("offering_id, section_id, course_id, class_code")
        .eq("school_year", schoolYearStr)
        .eq("semester", sem);
      const offeringMap = {};
      const classCodeMap = {};
      (existingOfferings || []).forEach((o) => {
        offeringMap[`${o.section_id}|${o.course_id}`] = o.offering_id;
        if (o.class_code) classCodeMap[o.class_code] = o.offering_id;
      });

      // The database's uniqueness guarantee is on class_code itself, not on
      // the (section_id, course_id) pair -- so matching only on that pair
      // isn't enough to rule out a collision. For every candidate not
      // already recognized by that pair, also check whether its computed
      // class_code already exists under some OTHER pair (which can happen
      // if this generation resolves section/course ids slightly differently
      // than whatever created the existing row) and reuse that offering
      // instead of attempting a duplicate insert the database would reject.
      const reusedOfferings = [];
      const offeringsToCreate = [];
      offeringKeys
        .filter((o) => !offeringMap[`${o.section_id}|${o.course_id}`])
        .forEach((o) => {
          const code = computeClassCode(o.section_id, o.course_id);
          const existingId = classCodeMap[code];
          if (existingId) {
            offeringMap[`${o.section_id}|${o.course_id}`] = existingId;
            reusedOfferings.push(code);
          } else {
            offeringsToCreate.push({ ...o, class_code: code });
          }
        });

      if (offeringsToCreate.length > 0) {
        const { data: newOfferings, error: offErr } = await supabase
          .from("class_offerings")
          .insert(
            offeringsToCreate.map((o) => ({
              class_code: o.class_code,
              section_id: o.section_id,
              course_id: o.course_id,
              school_year: schoolYearStr,
              semester: sem,
            })),
          )
          .select("offering_id, section_id, course_id");
        if (offErr) {
          const isDuplicate =
            offErr.code === "23505" ||
            /duplicate key/i.test(offErr.message || "");
          if (isDuplicate) {
            throw new Error(
              `A class offering already exists with a matching code for this term -- this usually means a schedule for this school year and semester already exists. Check the Sessions list before generating again. (${offErr.message})`,
            );
          }
          throw offErr;
        }
        (newOfferings || []).forEach((o) => {
          offeringMap[`${o.section_id}|${o.course_id}`] = o.offering_id;
        });
      }

      // 5. Batch insert schedules
      const skippedItems = [];
      const scheduleRows = items
        .map((it) => {
          const sId = sectionMap[it.section_name];
          const cId = getCourseId(it);
          const slotId = slotMap[slotKey(it.day, it.start_time, it.end_time)];
          const offeringId = offeringMap[`${sId}|${cId}`];
          if (!cId) {
            console.warn("[GEN] skipping — course not found:", it.course_code);
            skippedItems.push(`${it.course_code || "unknown course"} (course not recognized)`);
            return null;
          }
          if (!sId) {
            console.warn(
              "[GEN] skipping — section not found:",
              it.section_name,
            );
            skippedItems.push(`${it.section_name || "unknown section"} (section not recognized)`);
            return null;
          }
          if (!slotId) {
            console.warn(
              "[GEN] skipping — slot not found:",
              it.day,
              it.start_time,
              it.end_time,
            );
            skippedItems.push(`${it.course_code || "item"} (time slot ${it.day} ${it.start_time}-${it.end_time} not recognized)`);
            return null;
          }
          if (!offeringId) {
            console.warn("[GEN] skipping — offering not found:", { sId, cId });
            skippedItems.push(`${it.course_code || "item"} in ${it.section_name || "unknown section"} (offering not recognized)`);
            return null;
          }
          const major = isMajor(it.course_code);
          return {
            offering_id: offeringId,
            professor_id: major ? it.professor_id || null : null,
            room_id: major ? it.room_id || null : null,
            slot_id: slotId,
            status: "Generated",
            generated_at: generatedAt,
          };
        })
        .filter(Boolean);

      if (!scheduleRows.length) {
        const detail =
          skippedItems.length > 0
            ? ` First few: ${skippedItems.slice(0, 3).join("; ")}${skippedItems.length > 3 ? `, and ${skippedItems.length - 3} more` : ""}.`
            : "";
        throw new Error(
          `No schedule rows could be saved — every generated item was skipped.${detail}`,
        );
      }
      const { error: schedErr } = await supabase
        .from("schedules")
        .insert(scheduleRows);
      if (schedErr) throw schedErr;

      const grouped = await fetchSchedules();
      const saved = (grouped || []).find(
        (s) => s.school_year === schoolYearStr && s.semester === sem,
      );
      if (saved) {
        setSelectedSession(saved);
        setSelectedSection(null);
      }

      if (hardViolations > 0 || skippedItems.length > 0 || reusedOfferings.length > 0) {
        setGenerateWarning({
          hardViolations: hardViolations || 0,
          violationBreakdown: violationBreakdown || {},
          violationDrilldowns: violationDrilldowns || {},
          skippedCount: skippedItems.length,
          skippedItems: skippedItems.slice(0, 5),
          reusedCount: reusedOfferings.length,
        });
      }
    } catch (err) {
      console.error(err);
      setGenerateError(err.message);
    }
    setGenerating(false);
  }

  async function handleApprove(action) {
    if (action === "open_confirm") {
      setApproveConfirm(true);
      return;
    }
    if (selectedSession.status === "Approved") {
      setApproveConfirm(false);
      return;
    }
    const ids = selectedSession.sections
      .flatMap((s) => s.schedules.map((sc) => sc.schedule_id))
      .filter(Boolean);
    if (!ids.length) {
      setApproveConfirm(false);
      return;
    }
    await supabase
      .from("schedules")
      .update({ status: "Approved" })
      .in("schedule_id", ids);
    await supabase.from("change_log").insert({
      action: "Approved session",
      entity: `${selectedSession.school_year} · ${getSemesterLabel(selectedSession.semester)}`,
      details: `${ids.length} schedules`,
    });
    const grouped = await fetchSchedules();
    const saved = (grouped || []).find(
      (s) =>
        s.school_year === selectedSession.school_year &&
        s.semester === selectedSession.semester,
    );
    setSelectedSession(saved || null);
    setSelectedSection(null);
    setApproveConfirm(false);
  }

  async function handleDeleteSession(session) {
    const ids = session.sections
      .flatMap((s) => s.schedules.map((sc) => sc.schedule_id))
      .filter(Boolean);
    if (ids.length > 0)
      await supabase.from("schedules").delete().in("schedule_id", ids);
    setSessions((prev) =>
      prev.filter((s) => s.session_id !== session.session_id),
    );
    if (selectedSession?.session_id === session.session_id) {
      setSelectedSession(null);
      setSelectedSection(null);
    }
    setDeleteSessionConfirm(null);
    await supabase.from("change_log").insert({
      action: "Deleted session",
      entity: session.school_year,
      details: `${getSemesterLabel(session.semester)} — ${ids.length} schedules removed`,
    });
  }

  function getProgram(id) {
    return programs.find((p) => p.program_id === id);
  }
  function getCurriculumLabel(c) {
    const prog = getProgram(c.program_id);
    return `${prog?.program_code || "?"} ${c.curriculum_year}`;
  }
  function initSelections() {
    const init = {};
    curricula.forEach((c) => {
      init[c.curriculum_id] = {
        checked: false,
        yearLevels: {
          1: { checked: false, sections: 2 },
          2: { checked: false, sections: 2 },
          3: { checked: false, sections: 2 },
          4: { checked: false, sections: 2 },
        },
      };
    });
    return init;
  }
  function openDialog() {
    setCurriculumSelections(initSelections());
    setSemester(null);
    setSchoolYearStart(CURRENT_YEAR);
    setSchoolYearEnd(CURRENT_YEAR + 1);
    setDialogOpen(true);
  }
  function toggleCurriculum(id) {
    setCurriculumSelections((p) => ({
      ...p,
      [id]: { ...p[id], checked: !p[id].checked },
    }));
  }
  function toggleYearLevel(currId, yl) {
    setCurriculumSelections((p) => ({
      ...p,
      [currId]: {
        ...p[currId],
        yearLevels: {
          ...p[currId].yearLevels,
          [yl]: {
            ...p[currId].yearLevels[yl],
            checked: !p[currId].yearLevels[yl].checked,
          },
        },
      },
    }));
  }
  function stepSections(currId, yl, dir) {
    setCurriculumSelections((p) => ({
      ...p,
      [currId]: {
        ...p[currId],
        yearLevels: {
          ...p[currId].yearLevels,
          [yl]: {
            ...p[currId].yearLevels[yl],
            sections: Math.max(
              1,
              Math.min(8, p[currId].yearLevels[yl].sections + dir),
            ),
          },
        },
      },
    }));
  }
  function isDialogValid() {
    if (
      !semester ||
      semester === 3 ||
      !schoolYearStart ||
      !schoolYearEnd ||
      schoolYearEnd <= schoolYearStart
    )
      return false;
    return Object.values(curriculumSelections).some(
      (c) => c.checked && Object.values(c.yearLevels).some((yl) => yl.checked),
    );
  }

  return (
    <div className="gen-wrapper">
      <header className="gen-topbar">
        <div className="gen-brand">
          OrangeTail <span>Scheduling System</span>
        </div>
      </header>

      <div className="gen-inner-bar">
        <button className="gen-back-btn" onClick={onBack}>
          <i className="ti ti-chevron-left" /> Menu
        </button>
        <span className="gen-sep">/</span>
        <span className="gen-screen-title">Generate Schedule</span>
        <div className="gen-inner-bar-right">
          <button
            className="gen-generate-btn"
            onClick={openDialog}
            disabled={generating}
          >
            {generating ? (
              <>
                <i className="ti ti-loader gen-spin" /> Generating...
              </>
            ) : (
              <>
                <i className="ti ti-player-play" /> Generate Schedule
              </>
            )}
          </button>
        </div>
      </div>

      {generateError && (
        <div className="gen-edit-error" style={{ margin: "12px 24px 0" }}>
          <i className="ti ti-alert-circle" />
          {generateError}
          <button
            onClick={() => setGenerateError("")}
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            <i className="ti ti-x" />
          </button>
        </div>
      )}

      {generateWarning && (
        <div className="gen-edit-warning" style={{ margin: "12px 24px 0" }}>
          <i className="ti ti-alert-triangle" />
          <div>
            {generateWarning.hardViolations > 0 && (
              <div>
                Schedule generated with {generateWarning.hardViolations} hard
                violation
                {generateWarning.hardViolations === 1 ? "" : "s"} remaining —
                review before approving.{" "}
                <button
                  className="gen-view-violations-btn"
                  onClick={() => setDrilldownOpen(true)}
                >
                  View Details
                </button>
              </div>
            )}
            {generateWarning.skippedCount > 0 && (
              <div>
                {generateWarning.skippedCount} item
                {generateWarning.skippedCount === 1 ? "" : "s"} couldn't be
                saved: {generateWarning.skippedItems.join("; ")}
                {generateWarning.skippedCount >
                generateWarning.skippedItems.length
                  ? `, and ${generateWarning.skippedCount - generateWarning.skippedItems.length} more`
                  : ""}
              </div>
            )}
            {generateWarning.reusedCount > 0 && (
              <div>
                {generateWarning.reusedCount} class offering
                {generateWarning.reusedCount === 1 ? "" : "s"} already existed
                for this term and{" "}
                {generateWarning.reusedCount === 1 ? "was" : "were"} reused
                instead of duplicated.
              </div>
            )}
          </div>
          <button
            onClick={() => setGenerateWarning(null)}
            style={{
              marginLeft: "auto",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            <i className="ti ti-x" />
          </button>
        </div>
      )}

      <ViolationDrilldownDialog
        open={drilldownOpen}
        onClose={() => setDrilldownOpen(false)}
        breakdown={generateWarning?.violationBreakdown}
        drilldowns={generateWarning?.violationDrilldowns}
      />

      <div className="gen-content">
        <div className="gen-layout">
          <div className="gen-left">
            <div className="gen-sessions-header">
              <span className="gen-sessions-title">Sessions</span>
              <span className="gen-sessions-sub">Generated runs</span>
            </div>
            <div className="gen-sessions-list">
              {sessions.length === 0 ? (
                <div className="gen-sessions-empty">
                  <i className="ti ti-calendar-off" />
                  <p>No sessions yet.</p>
                  <p>Click Generate Schedule to start.</p>
                </div>
              ) : (
                sessions.map((s) => (
                  <div
                    key={s.session_id}
                    className={`gen-session-row ${selectedSession?.session_id === s.session_id ? "gen-session-row-selected" : ""}`}
                    onClick={() => {
                      setSelectedSession(s);
                      setSelectedSection(null);
                    }}
                  >
                    <div className="gen-session-info">
                      <div className="gen-session-label">
                        {s.school_year} · {getSemesterLabel(s.semester)}
                      </div>
                      <div className="gen-session-date">
                        {new Date(s.generated_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <span
                        className={`gen-status-badge ${getStatusClass(s.status)}`}
                      >
                        {s.status}
                      </span>
                      <button
                        className="gen-session-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteSessionConfirm(s);
                        }}
                      >
                        <i className="ti ti-trash" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="gen-right">
            {!selectedSession ? (
              <div className="gen-right-empty">
                <i className="ti ti-calendar" />
                <p>Select a session to view its schedules.</p>
              </div>
            ) : (
              <>
                <div className="gen-session-view-header">
                  <div>
                    <div className="gen-session-view-title">
                      {selectedSession.school_year} —{" "}
                      {getSemesterLabel(selectedSession.semester)}
                    </div>
                    <div className="gen-session-view-meta">
                      Generated{" "}
                      {new Date(
                        selectedSession.generated_at,
                      ).toLocaleDateString()}{" "}
                      · Click a section to view schedules
                    </div>
                  </div>
                  <div className="gen-session-view-actions">
                    <span
                      className={`gen-status-badge gen-status-badge-lg ${getStatusClass(selectedSession.status)}`}
                    >
                      {selectedSession.status}
                    </span>
                    <button
                      className="gen-view-schedules-btn"
                      onClick={() =>
                        onViewSchedules &&
                        onViewSchedules(selectedSession.session_id)
                      }
                    >
                      <i className="ti ti-calendar" /> View Schedules
                    </button>
                    {selectedSession.status !== "Approved" && (
                      <button
                        className="gen-approve-btn"
                        onClick={() => setApprovePreviewOpen(true)}
                      >
                        <i className="ti ti-circle-check" /> Approve session
                      </button>
                    )}
                    {selectedSession.semester === 3 ? (
                      <button
                        className="gen-add-sched-btn"
                        onClick={() => setAddSummerCourseOpen(true)}
                      >
                        <i className="ti ti-plus" /> Add course
                      </button>
                    ) : (
                      <button
                        className="gen-add-sched-btn"
                        onClick={() => {
                          setAddSectionOpen(true);
                          setAddSectionStep(1);
                        }}
                      >
                        <i className="ti ti-plus" /> Add section
                      </button>
                    )}
                  </div>
                </div>

                <div className="gen-sections-body">
                  {(selectedSession.sections || []).length === 0 ? (
                    <div className="gen-no-sections">
                      <i className="ti ti-calendar-off" />
                      <p>No sections in this session yet.</p>
                    </div>
                  ) : (
                    Object.entries(
                      groupSectionsByCurriculum(selectedSession.sections),
                    ).map(([currLabel, yearGroups]) => (
                      <div key={currLabel} className="gen-curr-group">
                        <div className="gen-curr-group-label">
                          <i className="ti ti-books" />
                          {currLabel}
                        </div>
                        {Object.entries(yearGroups).map(([yl, sectionList]) => (
                          <div key={yl} className="gen-yr-group">
                            <div className="gen-yr-label">
                              {yl === "summer"
                                ? "Summer Term"
                                : YEAR_LEVELS.find((y) => y.value === +yl)
                                    ?.label || `Year ${yl}`}
                            </div>
                            <div className="gen-sections-row">
                              {sectionList.map((sec) => (
                                <div
                                  key={sec.section_id}
                                  className="gen-section-card"
                                  onClick={() => setSelectedSection(sec)}
                                >
                                  <div>
                                    <div className="gen-section-name">
                                      {sec.section_name}
                                    </div>
                                    <div className="gen-section-meta">
                                      {(sec.schedules || []).length} schedules
                                    </div>
                                  </div>
                                  <i className="ti ti-chevron-right gen-section-arrow" />
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {deleteSessionConfirm && (
        <div
          className="gen-confirm-overlay"
          onClick={() => setDeleteSessionConfirm(null)}
        >
          <div className="gen-confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="gen-confirm-icon">
              <i className="ti ti-alert-triangle" />
            </div>
            <div className="gen-confirm-title">Delete session?</div>
            <p className="gen-confirm-msg">
              <strong>
                {deleteSessionConfirm.school_year} ·{" "}
                {getSemesterLabel(deleteSessionConfirm.semester)}
              </strong>{" "}
              and all its schedules will be permanently removed.
            </p>
            <div className="gen-confirm-btns">
              <button
                className="gen-confirm-cancel"
                onClick={() => setDeleteSessionConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="gen-confirm-delete"
                onClick={() => handleDeleteSession(deleteSessionConfirm)}
              >
                <i className="ti ti-trash" /> Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <GenerateDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        schoolYearStart={schoolYearStart}
        setSchoolYearStart={setSchoolYearStart}
        schoolYearEnd={schoolYearEnd}
        setSchoolYearEnd={setSchoolYearEnd}
        semester={semester}
        setSemester={setSemester}
        curricula={curricula}
        curriculumSelections={curriculumSelections}
        onToggleCurriculum={toggleCurriculum}
        onToggleYearLevel={toggleYearLevel}
        onStepSections={stepSections}
        getCurriculumLabel={getCurriculumLabel}
        isDialogValid={isDialogValid}
        onGenerate={handleGenerate}
        onCreateSummer={() => {
          setDialogOpen(false);
          setSummerEntries([{ ...BLANK_ENTRY }]);
          setSummerStep(1);
          setSummerOpen(true);
        }}
      />

      <CreateSummerModal
        open={summerOpen}
        onClose={() => setSummerOpen(false)}
        schoolYearStart={schoolYearStart}
        schoolYearEnd={schoolYearEnd}
        step={summerStep}
        setStep={setSummerStep}
        entries={summerEntries}
        onAdd={() => setSummerEntries((p) => [...p, { ...BLANK_ENTRY }])}
        onRemove={(idx) =>
          setSummerEntries((p) => p.filter((_, i) => i !== idx))
        }
        onUpdate={(idx, field, val) =>
          setSummerEntries((p) =>
            p.map((e, i) =>
              i === idx
                ? { ...e, [field]: val, conflicts: { hard: [], soft: [] } }
                : e,
            ),
          )
        }
        professors={professors}
        rooms={rooms}
        allCourses={allCourses}
        onCheckConflicts={async () => {
          const updated = await runConflictCheck(summerEntries);
          setSummerEntries(updated);
        }}
        onSave={handleSaveSummer}
        saving={summerSaving}
      />

      <AddSectionModal
        open={addSectionOpen}
        onClose={() => setAddSectionOpen(false)}
        selectedSession={selectedSession}
        getSemesterLabel={getSemesterLabel}
        step={addSectionStep}
        setStep={setAddSectionStep}
        professors={professors}
        rooms={rooms}
        timeSlots={timeSlots}
        onSaved={async () => {
          await fetchSchedules();
          setAddSectionOpen(false);
          setAddSectionStep(1);
        }}
      />

      <SectionSchedulesModal
        section={selectedSection}
        session={selectedSession}
        getSemesterLabel={getSemesterLabel}
        professors={professors}
        rooms={rooms}
        timeSlots={timeSlots}
        onClose={() => setSelectedSection(null)}
        onUpdated={(flat) => {
          setSessions((prev) =>
            prev.map((sess) => ({
              ...sess,
              sections: sess.sections.map((sec) => ({
                ...sec,
                schedules: sec.schedules.map((s) =>
                  s.schedule_id === flat.schedule_id ? flat : s,
                ),
              })),
            })),
          );
          setSelectedSection((prev) =>
            prev
              ? {
                  ...prev,
                  schedules: prev.schedules.map((s) =>
                    s.schedule_id === flat.schedule_id ? flat : s,
                  ),
                }
              : prev,
          );
        }}
      />

      <AddSummerCourseModal
        open={addSummerCourseOpen}
        onClose={() => setAddSummerCourseOpen(false)}
        session={selectedSession}
        professors={professors}
        rooms={rooms}
        allCourses={allCourses}
        onSaved={async () => {
          await fetchSchedules();
          setAddSummerCourseOpen(false);
        }}
      />

      <ApproveSessionModal
        previewOpen={approvePreviewOpen}
        confirmOpen={approveConfirm}
        onClosePreview={() => setApprovePreviewOpen(false)}
        onCloseConfirm={() => setApproveConfirm(false)}
        selectedSession={selectedSession}
        getSemesterLabel={getSemesterLabel}
        onApprove={handleApprove}
      />
    </div>
  );
}
