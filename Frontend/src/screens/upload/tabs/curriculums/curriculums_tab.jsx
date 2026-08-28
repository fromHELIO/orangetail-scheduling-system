import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../../../../lib/supabaseClient";
import { LAB_CATEGORIES } from "../../../../constants";
import "./curriculums_tab.css";

const YEAR_LEVELS = [
  { value: 1, label: "1st Year" },
  { value: 2, label: "2nd Year" },
  { value: 3, label: "3rd Year" },
  { value: 4, label: "4th Year" },
];
const SEMESTERS = [
  { value: 1, label: "1st Semester" },
  { value: 2, label: "2nd Semester" },
  { value: 3, label: "Summer" },
];
function getUsername() {
  return JSON.parse(localStorage.getItem("user") || "{}").username || "unknown";
}
export default function CurriculumsTab() {
  const [activeSubTab, setActiveSubTab] = useState("curricula");
  const [programs, setPrograms] = useState([]);
  const [curricula, setCurricula] = useState([]);
  const [courses, setCourses] = useState([]);
  const [curriculumCourses, setCurriculumCourses] = useState([]);

  const [selectedCurriculum, setSelectedCurriculum] = useState(null);
  const [selectedCurriculaIds, setSelectedCurriculaIds] = useState([]);
  const [bulkCurriculaConfirm, setBulkCurriculaConfirm] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState(null);
  const [curriculumSearch, setCurriculumSearch] = useState("");
  const [curriculumFilter, setCurriculumFilter] = useState("active");
  const [archiveConfirm, setArchiveConfirm] = useState(null);

  const [courseSearch, setCourseSearch] = useState("");
  const [courseLabFilter, setCourseLabFilter] = useState("");
  const [courseCurriculumFilter, setCourseCurriculumFilter] = useState("");
  const [courseRequiredFilter, setCourseRequiredFilter] = useState("");

  const [deleteBlockedMessage, setDeleteBlockedMessage] = useState("");

  const [currUploadStatus, setCurrUploadStatus] = useState(null);
  const [currUploadError, setCurrUploadError] = useState("");
  const currFileRef = useRef(null);

  async function fetchPrograms() {
    const { data, error } = await supabase
      .from("programs")
      .select("*")
      .order("program_code");
    if (error) {
      console.error(error);
      return;
    }
    setPrograms(data || []);
  }

  async function fetchCurricula() {
    const { data, error } = await supabase
      .from("curricula")
      .select("*")
      .order("curriculum_year");
    if (error) {
      console.error(error);
      return [];
    }
    setCurricula(data || []);
    return data || [];
  }

  async function fetchCourses() {
    const { data, error } = await supabase
      .from("courses")
      .select("*")
      .order("course_code");
    if (error) {
      console.error(error);
      return;
    }
    setCourses(data || []);
  }

  async function fetchCurriculumCourses() {
    const { data, error } = await supabase
      .from("curriculum_courses")
      .select(
        `*, courses ( course_id, course_code, course_name, units, lec_hours, lab_hours, lab_cat )`,
      );
    if (error) {
      console.error(error);
      return;
    }
    setCurriculumCourses(data || []);
  }

  useEffect(() => {
    async function loadAll() {
      await Promise.all([
        fetchPrograms(),
        fetchCurricula(),
        fetchCourses(),
        fetchCurriculumCourses(),
      ]);
    }
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getProgram(programId) {
    return programs.find((p) => p.program_id === programId);
  }

  const filteredCurricula = curricula.filter((c) => {
    const prog = getProgram(c.program_id);
    const label = `${prog?.program_code} ${c.curriculum_year}`.toLowerCase();
    const matchSearch =
      !curriculumSearch || label.includes(curriculumSearch.toLowerCase());
    const matchFilter =
      curriculumFilter === "all" ||
      (curriculumFilter === "active" && c.is_active) ||
      (curriculumFilter === "archived" && !c.is_active);
    return matchSearch && matchFilter;
  });

  async function handleArchive(curriculum) {
    const { error } = await supabase
      .from("curricula")
      .update({ is_active: false })
      .eq("curriculum_id", curriculum.curriculum_id);
    if (error) {
      console.error(error);
      return;
    }
    setCurricula((prev) =>
      prev.map((c) =>
        c.curriculum_id === curriculum.curriculum_id
          ? { ...c, is_active: false }
          : c,
      ),
    );
    if (selectedCurriculum?.curriculum_id === curriculum.curriculum_id) {
      setSelectedCurriculum((prev) => ({ ...prev, is_active: false }));
    }
    setArchiveConfirm(null);
  }

  async function handleBulkDeleteCurricula() {
    // Check selected curricula for existing sections
    const { data: sections, error: sectionCheckErr } = await supabase
      .from("section")
      .select("section_id, curriculum_id")
      .in("curriculum_id", selectedCurriculaIds);

    if (sectionCheckErr) {
      console.error("Failed to check curriculum usage:", sectionCheckErr);
      setDeleteStatus("error");
      return;
    }

    const sectionIds = (sections || []).map((s) => s.section_id);

    let offeringIds = [];

    // Check class offerings under those sections
    if (sectionIds.length > 0) {
      const { data: offerings, error: offeringCheckErr } = await supabase
        .from("class_offerings")
        .select("offering_id, section_id")
        .in("section_id", sectionIds);

      if (offeringCheckErr) {
        console.error(
          "Failed to check curriculum offerings:",
          offeringCheckErr,
        );
        setDeleteStatus("error");
        return;
      }

      offeringIds = (offerings || []).map((o) => o.offering_id);
    }

    // Only block deletion if actual schedules still exist
    if (offeringIds.length > 0) {
      const { data: existingSchedules, error: scheduleCheckErr } =
        await supabase
          .from("schedules")
          .select("schedule_id")
          .in("offering_id", offeringIds)
          .limit(1);

      if (scheduleCheckErr) {
        console.error(
          "Failed to check curriculum schedules:",
          scheduleCheckErr,
        );
        setDeleteStatus("error");
        return;
      }

      if (existingSchedules && existingSchedules.length > 0) {
        setBulkCurriculaConfirm(false);

        setDeleteBlockedMessage(
          "Cannot delete this curriculum because it is still used by an existing schedule. Archive it instead.",
        );

        return;
      }
    }

    // No schedules remain, so clean up leftover class offerings
    if (offeringIds.length > 0) {
      const { error: offeringDeleteErr } = await supabase
        .from("class_offerings")
        .delete()
        .in("offering_id", offeringIds);

      if (offeringDeleteErr) {
        console.error(
          "Failed to delete unused class offerings:",
          offeringDeleteErr,
        );
        setDeleteStatus("error");
        return;
      }
    }

    // Clean up leftover sections
    if (sectionIds.length > 0) {
      const { error: sectionDeleteErr } = await supabase
        .from("section")
        .delete()
        .in("section_id", sectionIds);

      if (sectionDeleteErr) {
        console.error("Failed to delete unused sections:", sectionDeleteErr);
        setDeleteStatus("error");
        return;
      }
    }

    // Find courses linked to the curricula being deleted
    const linkedCourseIds = curriculumCourses
      .filter((cc) => selectedCurriculaIds.includes(cc.curriculum_id))
      .map((cc) => cc.course_id);

    // Delete curriculum_courses links first
    for (const id of selectedCurriculaIds) {
      const { error: linkDeleteErr } = await supabase
        .from("curriculum_courses")
        .delete()
        .eq("curriculum_id", id);

      if (linkDeleteErr) {
        console.error(
          "Failed to delete curriculum-course links:",
          linkDeleteErr,
        );
        setDeleteStatus("error");
        return;
      }
    }

    // Find courses still linked to other curricula
    const stillLinked = curriculumCourses
      .filter((cc) => !selectedCurriculaIds.includes(cc.curriculum_id))
      .map((cc) => cc.course_id);

    // Only delete courses no longer used by another curriculum
    const orphanedCourseIds = linkedCourseIds.filter(
      (id) => !stillLinked.includes(id),
    );

    if (orphanedCourseIds.length > 0) {
      const { error: courseDeleteErr } = await supabase
        .from("courses")
        .delete()
        .in("course_id", orphanedCourseIds);

      if (courseDeleteErr) {
        console.error("Failed to delete orphaned courses:", courseDeleteErr);
        setDeleteStatus("error");
        return;
      }
    }

    // Delete curricula
    for (const id of selectedCurriculaIds) {
      const { error: deleteCurrErr } = await supabase
        .from("curricula")
        .delete()
        .eq("curriculum_id", id);

      if (deleteCurrErr) {
        console.error("Failed to delete curriculum:", deleteCurrErr);

        setDeleteBlockedMessage(
          "Cannot delete this curriculum because it is still referenced by existing records. Archive it instead.",
        );

        setDeleteStatus("error");
        setBulkCurriculaConfirm(false);

        return;
      }
    }

    // Update UI
    setCurricula((prev) =>
      prev.filter((c) => !selectedCurriculaIds.includes(c.curriculum_id)),
    );

    setCurriculumCourses((prev) =>
      prev.filter((cc) => !selectedCurriculaIds.includes(cc.curriculum_id)),
    );

    setCourses((prev) =>
      prev.filter((c) => !orphanedCourseIds.includes(c.course_id)),
    );

    if (selectedCurriculaIds.includes(selectedCurriculum?.curriculum_id)) {
      setSelectedCurriculum(null);
    }

    await supabase.from("change_log").insert({
      action: "Deleted curricula",
      entity: `${selectedCurriculaIds.length} curriculum/curricula`,
      details: `${orphanedCourseIds.length} orphaned course(s) also removed`,
      performed_by: getUsername(),
    });

    setSelectedCurriculaIds([]);
    setBulkCurriculaConfirm(false);
    setDeleteStatus("success");

    setTimeout(() => setDeleteStatus(null), 3000);
  }

  function toggleCurriculumSelect(e, currId) {
    e.stopPropagation();
    setSelectedCurriculaIds((prev) =>
      prev.includes(currId)
        ? prev.filter((id) => id !== currId)
        : [...prev, currId],
    );
  }

  function toggleSelectAllCurricula() {
    const allIds = filteredCurricula.map((c) => c.curriculum_id);
    const allSelected = allIds.every((id) => selectedCurriculaIds.includes(id));
    setSelectedCurriculaIds(allSelected ? [] : allIds);
  }

  // Split into year/sem courses and elective pool (year_lvl === 0)
  const selectedCurriculumCourses = selectedCurriculum
    ? curriculumCourses
        .filter((cc) => cc.curriculum_id === selectedCurriculum.curriculum_id)
        .map((cc) => ({
          ...cc,
          course:
            cc.courses || courses.find((c) => c.course_id === cc.course_id),
        }))
        .filter((cc) => cc.course)
    : [];

  const yearSemCourses = selectedCurriculumCourses.filter(
    (cc) => cc.year_lvl !== 0,
  );
  const electivePool = selectedCurriculumCourses.filter(
    (cc) => cc.year_lvl === 0,
  );

  const groupedCurriculumCourses = yearSemCourses.reduce((acc, cc) => {
    const key = `${cc.year_lvl}-${cc.semester}`;
    if (!acc[key])
      acc[key] = { year_lvl: cc.year_lvl, semester: cc.semester, items: [] };
    acc[key].items.push(cc);
    return acc;
  }, {});

  const sortedGroups = Object.values(groupedCurriculumCourses).sort((a, b) => {
    if (a.year_lvl !== b.year_lvl) return a.year_lvl - b.year_lvl;
    return a.semester - b.semester;
  });

  function getCourseAppearances(courseId) {
    return curriculumCourses
      .filter((cc) => cc.course_id === courseId)
      .map((cc) => {
        const curr = curricula.find(
          (c) => c.curriculum_id === cc.curriculum_id,
        );
        const prog = programs.find((p) => p.program_id === curr?.program_id);
        const yl =
          cc.year_lvl === 0
            ? "Elective Pool"
            : YEAR_LEVELS.find((y) => y.value === cc.year_lvl)?.label ||
              `Year ${cc.year_lvl}`;
        const sem =
          cc.semester === 0
            ? ""
            : SEMESTERS.find((s) => s.value === cc.semester)?.label || "";
        return {
          label: `${prog?.program_code || "?"} ${curr?.curriculum_year || ""}`,
          year: yl,
          semester: sem,
          is_required: cc.is_required,
        };
      });
  }

  const filteredCourses = courses.filter((c) => {
    const matchSearch =
      !courseSearch ||
      c.course_code.toLowerCase().includes(courseSearch.toLowerCase()) ||
      c.course_name.toLowerCase().includes(courseSearch.toLowerCase());
    const matchLab = !courseLabFilter || c.lab_cat === courseLabFilter;
    const matchCurriculum =
      !courseCurriculumFilter ||
      curriculumCourses.some(
        (cc) =>
          cc.course_id === c.course_id &&
          cc.curriculum_id === Number(courseCurriculumFilter),
      );
    const matchRequired =
      !courseCurriculumFilter ||
      !courseRequiredFilter ||
      curriculumCourses.some(
        (cc) =>
          cc.course_id === c.course_id &&
          cc.curriculum_id === Number(courseCurriculumFilter) &&
          (courseRequiredFilter === "required"
            ? cc.is_required
            : !cc.is_required),
      );
    return matchSearch && matchLab && matchCurriculum && matchRequired;
  });

  function handleDownloadCurriculumTemplate() {
    const templateData = [
      {
        program_code: "BSCS",
        curriculum_year: 2022,
        course_code: "6CFUN",
        course_name: "Computer Fundamentals",
        units: 3,
        lec_hours: 3,
        lab_hours: 0,
        lab_cat: "NONE",
        year_lvl: 1,
        semester: 1,
        is_required: "TRUE",
      },
    ];

    const instructions = [
      {
        Field: "program_code",
        Instruction:
          "Choose ONE valid program code: BSCS, BSIT-NETAD, BSIT-WEBDEV, BSEMC, or BSCYBERSEC.",
      },
      {
        Field: "curriculum_year",
        Instruction: "Enter the curriculum year (e.g., 2022).",
      },
      {
        Field: "year_lvl",
        Instruction:
          "Use 1–4 for required courses. Use 0 for elective courses.",
      },
      {
        Field: "semester",
        Instruction:
          "Use 1 or 2 for required courses. Use 0 for elective courses.",
      },
      {
        Field: "is_required",
        Instruction:
          "Use TRUE for required courses and FALSE for elective courses.",
      },
    ];

    // 1. Create workbook FIRST
    const wb = XLSX.utils.book_new();

    // 2. Create curriculum sheet
    const ws = XLSX.utils.json_to_sheet(templateData);

    ws["!cols"] = [
      { wch: 16 },
      { wch: 18 },
      { wch: 16 },
      { wch: 30 },
      { wch: 10 },
      { wch: 12 },
      { wch: 12 },
      { wch: 16 },
      { wch: 12 },
      { wch: 12 },
      { wch: 14 },
    ];

    // 3. Create instructions sheet
    const instructionWs = XLSX.utils.json_to_sheet(instructions);

    instructionWs["!cols"] = [{ wch: 18 }, { wch: 65 }];

    // 4. Add BOTH sheets to the SAME workbook
    XLSX.utils.book_append_sheet(wb, ws, "Curriculum Template");

    XLSX.utils.book_append_sheet(wb, instructionWs, "Instructions");

    // Optional debug — should print both sheet names
    console.log(wb.SheetNames);

    // 5. Download
    XLSX.writeFile(wb, "curriculum_upload_template.xlsx");
  }

  async function handleCurriculumImport(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const normalizeKey = (key) =>
      String(key)
        .toLowerCase()
        .replace(/[\s_]+/g, "");

    const getValue = (row, ...keys) => {
      const normalizedRow = Object.fromEntries(
        Object.entries(row).map(([key, value]) => [normalizeKey(key), value]),
      );

      for (const key of keys) {
        const value = normalizedRow[normalizeKey(key)];

        if (value !== undefined && value !== null && value !== "") {
          return value;
        }
      }

      return "";
    };

    e.target.value = "";
    setCurrUploadStatus("uploading");
    setCurrUploadError("");

    try {
      let totalCurricula = 0;
      let totalCourses = 0;
      const errors = [];

      for (const file of files) {
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

        const curriculaMap = {};

        // Validate required columns exist
        if (rows.length === 0) {
          errors.push(`${file.name}: File is empty.`);
          continue;
        }

        const firstRow = rows[0];
        const normalizedKeys = Object.keys(firstRow).map(normalizeKey);

        const hasProgCode = normalizedKeys.includes("programcode");
        const hasCurrYear = normalizedKeys.includes("curriculumyear");

        if (!hasProgCode || !hasCurrYear) {
          errors.push(
            `${file.name}: Missing required columns. Need: program_code, curriculum_year, course_code, course_name, units, lec_hours, lab_hours, lab_cat, year_lvl, semester, is_required.`,
          );
          continue;
        }

        for (const r of rows) {
          const progCode = String(getValue(r, "program_code"))
            .trim()
            .toUpperCase();

          const currYear = Number(getValue(r, "curriculum_year") || 0);

          const key = `${progCode}__${currYear}`;

          if (!progCode || !currYear) continue;

          if (!curriculaMap[key]) {
            const prog = programs.find((p) => p.program_code === progCode);

            if (!prog) {
              errors.push(`Program not found: ${progCode}`);
              continue;
            }

            curriculaMap[key] = {
              program_id: prog.program_id,
              program_code: progCode,
              curriculum_year: currYear,
              courses: [],
            };
          }

          const courseCode = String(getValue(r, "course_code"))
            .trim()
            .toUpperCase();

          const courseName = String(getValue(r, "course_name")).trim();

          if (courseCode && courseName) {
            const yearLvl = Number(getValue(r, "year_lvl", "year_level") || 0);

            const semester = Number(getValue(r, "semester") || 0);

            const isRequired =
              String(getValue(r, "is_required") || "TRUE").toUpperCase() !==
              "FALSE";

            curriculaMap[key].courses.push({
              course_code: courseCode,
              course_name: courseName,

              units: Number(getValue(r, "units") || 0),

              lec_hours: Number(getValue(r, "lec_hours") || 0),

              lab_hours: Number(getValue(r, "lab_hours") || 0),

              lab_cat: String(
                getValue(r, "lab_cat", "lab_category") || "None",
              ).trim(),

              year_lvl: yearLvl,
              semester,
              is_required: isRequired,
            });
          }
        }

        if (errors.length) break;

        for (const [, curr] of Object.entries(curriculaMap)) {
          let curriculumId;

          const { data: existingCurr } = await supabase
            .from("curricula")
            .select("curriculum_id")
            .eq("program_id", curr.program_id)
            .eq("curriculum_year", curr.curriculum_year)
            .limit(1);

          if (existingCurr && existingCurr.length > 0) {
            curriculumId = existingCurr[0].curriculum_id;
          } else {
            const { data: newCurr, error: currErr } = await supabase
              .from("curricula")
              .insert({
                program_id: curr.program_id,
                curriculum_year: curr.curriculum_year,
                is_active: true,
              })
              .select()
              .single();

            if (currErr) throw currErr;

            curriculumId = newCurr.curriculum_id;
            totalCurricula++;
          }

          for (const course of curr.courses) {
            let courseId;

            const { data: existingCourses } = await supabase
              .from("courses")
              .select("course_id")
              .eq("course_code", course.course_code)
              .limit(1);

            if (existingCourses && existingCourses.length > 0) {
              courseId = existingCourses[0].course_id;
            } else {
              const { data: newCourse, error: courseErr } = await supabase
                .from("courses")
                .insert({
                  course_code: course.course_code,
                  course_name: course.course_name,
                  units: course.units,
                  lec_hours: course.lec_hours,
                  lab_hours: course.lab_hours,
                  lab_cat: course.lab_cat,
                })
                .select()
                .single();

              if (courseErr) throw courseErr;

              courseId = newCourse.course_id;
              totalCourses++;
            }

            const { data: existingLink, error: existingLinkError } =
              await supabase
                .from("curriculum_courses")
                .select("curriculum_id, course_id")
                .eq("curriculum_id", curriculumId)
                .eq("course_id", courseId)
                .limit(1);

            if (existingLinkError) {
              throw existingLinkError;
            }

            if (!existingLink || existingLink.length === 0) {
              const { error: linkErr } = await supabase
                .from("curriculum_courses")
                .insert({
                  curriculum_id: curriculumId,
                  course_id: courseId,
                  year_lvl: course.year_lvl,
                  semester: course.semester,
                  is_required: course.is_required,
                });

              if (linkErr) throw linkErr;
            }
          }
        }
      }

      if (errors.length) {
        setCurrUploadError(errors.join(" | "));
        setCurrUploadStatus("error");

        setTimeout(() => {
          setCurrUploadStatus(null);
        }, 6000);

        return;
      }

      // Fetch fresh data
      const { data: freshCurricula } = await supabase
        .from("curricula")
        .select("*")
        .order("curriculum_year");

      const { data: freshCourses } = await supabase
        .from("courses")
        .select("*")
        .order("course_code");

      const { data: freshCC } = await supabase
        .from("curriculum_courses")
        .select(
          `*, courses (
          course_id,
          course_code,
          course_name,
          units,
          lec_hours,
          lab_hours,
          lab_cat
        )`,
        );

      setCurricula(freshCurricula || []);
      setCourses(freshCourses || []);
      setCurriculumCourses(freshCC || []);

      // Refresh selected curriculum
      if (selectedCurriculum) {
        const refreshed = (freshCurricula || []).find(
          (c) => c.curriculum_id === selectedCurriculum.curriculum_id,
        );

        if (refreshed) {
          setSelectedCurriculum(refreshed);
        }
      }

      await supabase.from("change_log").insert({
        action: "Uploaded curricula",
        entity: `${files.length} file(s)`,
        details: `${totalCurricula} curricula, ${totalCourses} new courses added`,
        performed_by: getUsername(),
      });

      setCurrUploadStatus("success");

      setTimeout(() => {
        setCurrUploadStatus(null);
      }, 3000);
    } catch (err) {
      console.error(err);

      setCurrUploadError(
        err.message || "Upload failed. Check your file format.",
      );

      setCurrUploadStatus("error");

      setTimeout(() => {
        setCurrUploadStatus(null);
      }, 5000);
    }
  }

  return (
    <div className="curr-wrapper">
      <div className="curr-subtabs">
        <button
          className={`curr-subtab ${activeSubTab === "curricula" ? "curr-subtab-active" : ""}`}
          onClick={() => setActiveSubTab("curricula")}
        >
          <i className="ti ti-books" aria-hidden="true" /> Curricula
        </button>
        <button
          className={`curr-subtab ${activeSubTab === "courses" ? "curr-subtab-active" : ""}`}
          onClick={() => setActiveSubTab("courses")}
        >
          <i className="ti ti-book" aria-hidden="true" /> Courses
        </button>
      </div>

      {activeSubTab === "curricula" && (
        <>
          <input
            ref={currFileRef}
            type="file"
            accept=".xlsx,.xls"
            multiple
            style={{ display: "none" }}
            onChange={handleCurriculumImport}
          />

          <input
            ref={currFileRef}
            type="file"
            accept=".xlsx,.xls"
            multiple
            style={{ display: "none" }}
            onChange={handleCurriculumImport}
          />

          <div
            className="curr-upload-zone"
            onClick={() => currFileRef.current?.click()}
          >
            {currUploadStatus === "uploading" ? (
              <>
                <i className="ti ti-loader profs-spin" />
                <span>Uploading…</span>
              </>
            ) : currUploadStatus === "success" ? (
              <>
                <i
                  className="ti ti-circle-check"
                  style={{ color: "var(--green)" }}
                />
                <span style={{ color: "var(--green)" }}>
                  Uploaded successfully
                </span>
              </>
            ) : currUploadStatus === "error" ? (
              <>
                <i
                  className="ti ti-alert-circle"
                  style={{ color: "var(--red)" }}
                />
                <span style={{ color: "var(--red)" }}>
                  {currUploadError || "Upload failed"}
                </span>
              </>
            ) : (
              <>
                <i className="ti ti-file-upload" aria-hidden="true" />
                <span>Upload Excel (.xlsx) to import curriculum</span>
              </>
            )}
            <button
              type="button"
              className="curr-template-link"
              onClick={(e) => {
                e.stopPropagation();
                handleDownloadCurriculumTemplate();
              }}
            >
              <i className="ti ti-download" />
              Download Template
            </button>
          </div>

          <div className="curr-split">
            <div className="curr-left">
              <div className="curr-list-header">
                <div className="curr-list-header-top">
                  <div className="curr-list-header-left">
                    <input
                      type="checkbox"
                      className="curr-bulk-chk"
                      checked={
                        filteredCurricula.length > 0 &&
                        filteredCurricula.every((c) =>
                          selectedCurriculaIds.includes(c.curriculum_id),
                        )
                      }
                      onChange={toggleSelectAllCurricula}
                      title="Select all"
                    />
                    <span className="curr-list-title">Curricula</span>
                  </div>
                  <div className="curr-list-header-right">
                    {deleteStatus === "success" && (
                      <span className="curr-delete-success">
                        <i className="ti ti-circle-check" /> Deleted Sucessfully
                      </span>
                    )}
                    {selectedCurriculaIds.length > 0 && (
                      <button
                        className="curr-bulk-delete-btn"
                        onClick={() => setBulkCurriculaConfirm(true)}
                      >
                        <i className="ti ti-trash" /> Delete (
                        {selectedCurriculaIds.length})
                      </button>
                    )}
                  </div>
                </div>
                <div className="curr-search-wrap">
                  <i className="ti ti-search" aria-hidden="true" />
                  <input
                    className="curr-search-input"
                    placeholder="Search curricula…"
                    value={curriculumSearch}
                    onChange={(e) => setCurriculumSearch(e.target.value)}
                  />
                </div>
                <div className="curr-filter-tabs">
                  {["active", "archived", "all"].map((f) => (
                    <button
                      key={f}
                      className={`curr-filter-tab ${curriculumFilter === f ? "curr-filter-tab-active" : ""}`}
                      onClick={() => setCurriculumFilter(f)}
                    >
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="curr-list">
                {filteredCurricula.length === 0 ? (
                  <div className="curr-empty">
                    <i className="ti ti-books" aria-hidden="true" />
                    <p>No curricula found.</p>
                  </div>
                ) : (
                  filteredCurricula.map((c) => {
                    const prog = getProgram(c.program_id);
                    const courseCount = curriculumCourses.filter(
                      (cc) => cc.curriculum_id === c.curriculum_id,
                    ).length;
                    return (
                      <div
                        key={c.curriculum_id}
                        className={`curr-row ${selectedCurriculum?.curriculum_id === c.curriculum_id ? "curr-row-selected" : ""} ${selectedCurriculaIds.includes(c.curriculum_id) ? "curr-row-checked" : ""}`}
                        onClick={() => setSelectedCurriculum(c)}
                      >
                        <input
                          type="checkbox"
                          className="curr-bulk-chk"
                          checked={selectedCurriculaIds.includes(
                            c.curriculum_id,
                          )}
                          onChange={(e) =>
                            toggleCurriculumSelect(e, c.curriculum_id)
                          }
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="curr-row-info">
                          <div className="curr-row-title">
                            {prog?.program_code} {c.curriculum_year}
                          </div>
                          <div className="curr-row-meta">
                            {prog?.program_name}
                          </div>
                          <div className="curr-row-meta">
                            {courseCount} course{courseCount !== 1 ? "s" : ""}
                          </div>
                        </div>
                        <div className="curr-row-right">
                          <span
                            className={`curr-status-badge ${c.is_active ? "curr-status-active" : "curr-status-archived"}`}
                          >
                            {c.is_active ? "Active" : "Archived"}
                          </span>
                          <i className="ti ti-chevron-right curr-row-arrow" />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="curr-right">
              {!selectedCurriculum ? (
                <div className="curr-detail-empty">
                  <i className="ti ti-books" aria-hidden="true" />
                  <p>Select a curriculum to view its courses.</p>
                </div>
              ) : (
                <div className="curr-detail">
                  <div className="curr-detail-header">
                    <div>
                      <div className="curr-detail-title">
                        {
                          getProgram(selectedCurriculum.program_id)
                            ?.program_code
                        }{" "}
                        {selectedCurriculum.curriculum_year}
                      </div>
                      <div className="curr-detail-sub">
                        {
                          getProgram(selectedCurriculum.program_id)
                            ?.program_name
                        }
                      </div>
                    </div>
                    <div className="curr-detail-actions">
                      {selectedCurriculum.is_active && (
                        <button
                          className="curr-detail-archive-btn"
                          onClick={() => setArchiveConfirm(selectedCurriculum)}
                        >
                          <i className="ti ti-archive" /> Archive
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="curr-detail-body">
                    <div className="curr-detail-courses-header">
                      <span className="curr-detail-section-label">
                        Courses ({selectedCurriculumCourses.length})
                      </span>
                    </div>

                    {selectedCurriculumCourses.length === 0 ? (
                      <div className="curr-courses-empty">
                        <p>No courses in this curriculum yet.</p>
                        <p>Upload a curriculum Excel file to add courses.</p>
                      </div>
                    ) : (
                      <div className="curr-courses-groups">
                        {sortedGroups.map((group) => (
                          <div
                            key={`${group.year_lvl}-${group.semester}`}
                            className="curr-group"
                          >
                            <div className="curr-group-label">
                              {
                                YEAR_LEVELS.find(
                                  (y) => y.value === group.year_lvl,
                                )?.label
                              }{" "}
                              ·{" "}
                              {
                                SEMESTERS.find(
                                  (s) => s.value === group.semester,
                                )?.label
                              }
                            </div>
                            <table className="curr-courses-table">
                              <thead>
                                <tr>
                                  <th>Code</th>
                                  <th>Course Name</th>
                                  <th>Units</th>
                                  <th>Lec</th>
                                  <th>Lab</th>
                                  <th>Lab Cat</th>
                                  <th>Type</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.items.map((cc) => (
                                  <tr
                                    key={`${cc.curriculum_id}-${cc.course_id}-${cc.year_lvl}-${cc.semester}`}
                                    className={`curr-course-row ${!cc.is_required ? "curr-course-row-elective-slot" : ""}`}
                                  >
                                    <td className="curr-td-code">
                                      {cc.course?.course_code}
                                    </td>
                                    <td>{cc.course?.course_name}</td>
                                    <td className="curr-td-num">
                                      {cc.course?.units}
                                    </td>
                                    <td className="curr-td-num">
                                      {cc.course?.lec_hours}
                                    </td>
                                    <td className="curr-td-num">
                                      {cc.course?.lab_hours}
                                    </td>
                                    <td>
                                      <span className="curr-lab-badge">
                                        {cc.course?.lab_cat}
                                      </span>
                                    </td>
                                    <td className="curr-td-center">
                                      {cc.is_required ? (
                                        <i className="ti ti-circle-check curr-required-yes" />
                                      ) : (
                                        <span className="curr-elective-slot-badge">
                                          Elective
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}

                        {electivePool.length > 0 && (
                          <div className="curr-group curr-group-electives">
                            <div className="curr-group-label curr-group-label-electives">
                              <i
                                className="ti ti-list-check"
                                aria-hidden="true"
                              />
                              {
                                getProgram(selectedCurriculum.program_id)
                                  ?.program_code
                              }{" "}
                              Electives
                            </div>
                            <table className="curr-courses-table">
                              <thead>
                                <tr>
                                  <th>Code</th>
                                  <th>Course Name</th>
                                  <th>Units</th>
                                  <th>Lec</th>
                                  <th>Lab</th>
                                  <th>Lab Cat</th>
                                </tr>
                              </thead>
                              <tbody>
                                {electivePool.map((cc) => (
                                  <tr
                                    key={`${cc.curriculum_id}-${cc.course_id}-pool`}
                                    className="curr-course-row curr-course-row-elective"
                                  >
                                    <td className="curr-td-code">
                                      {cc.course?.course_code}
                                    </td>
                                    <td>{cc.course?.course_name}</td>
                                    <td className="curr-td-num">
                                      {cc.course?.units}
                                    </td>
                                    <td className="curr-td-num">
                                      {cc.course?.lec_hours}
                                    </td>
                                    <td className="curr-td-num">
                                      {cc.course?.lab_hours}
                                    </td>
                                    <td>
                                      <span className="curr-lab-badge">
                                        {cc.course?.lab_cat}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {activeSubTab === "courses" && (
        <div className="curr-courses-tab">
          <div className="curr-courses-controls">
            <div className="curr-courses-filters">
              <div className="curr-search-wrap">
                <i className="ti ti-search" aria-hidden="true" />
                <input
                  className="curr-search-input"
                  placeholder="Search by code or name…"
                  value={courseSearch}
                  onChange={(e) => setCourseSearch(e.target.value)}
                />
              </div>
              <select
                className="curr-filter-sel"
                value={courseCurriculumFilter}
                onChange={(e) => {
                  setCourseCurriculumFilter(e.target.value);
                  setCourseRequiredFilter("");
                }}
              >
                <option value="">All curricula</option>
                {curricula.map((c) => {
                  const prog = programs.find(
                    (p) => p.program_id === c.program_id,
                  );
                  return (
                    <option key={c.curriculum_id} value={c.curriculum_id}>
                      {prog?.program_code} {c.curriculum_year}
                    </option>
                  );
                })}
              </select>
              {courseCurriculumFilter && (
                <select
                  className="curr-filter-sel"
                  value={courseRequiredFilter}
                  onChange={(e) => setCourseRequiredFilter(e.target.value)}
                >
                  <option value="">All</option>
                  <option value="required">Required only</option>
                  <option value="elective">Elective only</option>
                </select>
              )}
              <select
                className="curr-filter-sel"
                value={courseLabFilter}
                onChange={(e) => setCourseLabFilter(e.target.value)}
              >
                <option value="">ALL CATEGORIES</option>
                {LAB_CATEGORIES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="curr-courses-table-wrap">
            {filteredCourses.length === 0 ? (
              <div className="curr-empty curr-empty-full">
                <i className="ti ti-book" aria-hidden="true" />
                <p>No courses found.</p>
              </div>
            ) : (
              <table className="curr-courses-table curr-courses-table-full">
                <thead>
                  <tr>
                    <th>Course Code</th>
                    <th>Course Name</th>
                    <th>Units</th>
                    <th>Lec</th>
                    <th>Lab</th>
                    <th>Lab Category</th>
                    <th>Appears in</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCourses.map((course) => {
                    const appearances = getCourseAppearances(course.course_id);
                    const visible = appearances.slice(0, 3);
                    const extra = appearances.length - 3;
                    return (
                      <tr key={course.course_id} className="curr-course-row">
                        <td className="curr-td-code">{course.course_code}</td>
                        <td>{course.course_name}</td>
                        <td className="curr-td-num">{course.units}</td>
                        <td className="curr-td-num">{course.lec_hours}</td>
                        <td className="curr-td-num">{course.lab_hours}</td>
                        <td>
                          <span className="curr-lab-badge">
                            {course.lab_cat}
                          </span>
                        </td>
                        <td>
                          <div className="curr-appears-in">
                            {appearances.length === 0 ? (
                              <span className="curr-appears-none">—</span>
                            ) : (
                              <>
                                {visible.map((a, i) => (
                                  <span
                                    key={i}
                                    className={`curr-appears-chip ${a.is_required ? "curr-chip-required" : "curr-chip-elective"}`}
                                    title={`${a.label} · ${a.year}${a.semester ? ` · ${a.semester}` : ""} · ${a.is_required ? "Required" : "Elective"}`}
                                  >
                                    {a.label} · {a.is_required ? "Req" : "Elec"}
                                  </span>
                                ))}
                                {extra > 0 && (
                                  <span className="curr-appears-more">
                                    +{extra} more
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {bulkCurriculaConfirm && (
        <div
          className="curr-overlay"
          onClick={() => setBulkCurriculaConfirm(false)}
        >
          <div
            className="curr-confirm-box"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="curr-confirm-icon curr-confirm-icon-red">
              <i className="ti ti-alert-triangle" />
            </div>
            <div className="curr-confirm-title">
              Delete {selectedCurriculaIds.length}{" "}
              {selectedCurriculaIds.length !== 1 ? "curricula" : "curriculum"}?
            </div>
            <p className="curr-confirm-msg">
              <strong>
                {selectedCurriculaIds.length}{" "}
                {selectedCurriculaIds.length !== 1 ? "curricula" : "curriculum"}
              </strong>{" "}
              and all their linked courses will be permanently removed.
            </p>
            <div className="curr-confirm-btns">
              <button
                className="curr-confirm-cancel"
                onClick={() => setBulkCurriculaConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="curr-confirm-delete"
                onClick={handleBulkDeleteCurricula}
              >
                <i className="ti ti-trash" /> Delete all
              </button>
            </div>
          </div>
        </div>
      )}

      {archiveConfirm && (
        <div className="curr-overlay" onClick={() => setArchiveConfirm(null)}>
          <div
            className="curr-confirm-box"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="curr-confirm-icon">
              <i className="ti ti-archive" />
            </div>
            <div className="curr-confirm-title">Archive this curriculum?</div>
            <p className="curr-confirm-msg">
              <strong>
                {getProgram(archiveConfirm.program_id)?.program_code}{" "}
                {archiveConfirm.curriculum_year}
              </strong>{" "}
              will be archived and no longer appear in Generate Schedule.
              Existing schedules are preserved.
            </p>
            <div className="curr-confirm-btns">
              <button
                className="curr-confirm-cancel"
                onClick={() => setArchiveConfirm(null)}
              >
                Cancel
              </button>
              <button
                className="curr-confirm-archive"
                onClick={() => handleArchive(archiveConfirm)}
              >
                <i className="ti ti-archive" /> Archive
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteBlockedMessage && (
        <div
          className="curr-overlay"
          onClick={() => setDeleteBlockedMessage("")}
        >
          <div
            className="curr-blocked-box"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="curr-blocked-icon">
              <i className="ti ti-alert-circle" />
            </div>

            <div className="curr-blocked-title">Cannot Delete Curriculum</div>

            <p className="curr-blocked-msg">{deleteBlockedMessage}</p>

            <button
              className="curr-blocked-btn"
              onClick={() => setDeleteBlockedMessage("")}
            >
              Okay
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
