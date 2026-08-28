import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../../../../lib/supabaseClient";
import {
  EMPLOYMENT_STATUSES,
  HIGHEST_DEGREES,
  DAYS_OF_WEEK,
} from "../../../../constants";
import ProfessorModal from "./professor_modal";
import PreferencesPanel from "./preferences_panel";
import "./professors_tab.css";
import TimeWheel from "../../../generate/time/time_wheel";

function normalizeDay(day) {
  if (!day) return "";

  const value = String(day).trim().toLowerCase();

  const dayMap = {
    mon: "Monday",
    monday: "Monday",

    tue: "Tuesday",
    tues: "Tuesday",
    tuesday: "Tuesday",

    wed: "Wednesday",
    weds: "Wednesday",
    wednesday: "Wednesday",

    thu: "Thursday",
    thur: "Thursday",
    thurs: "Thursday",
    thursday: "Thursday",

    fri: "Friday",
    friday: "Friday",

    sat: "Saturday",
    saturday: "Saturday",
  };

  return dayMap[value] || day;
}

function parseAvailability(availableDays, availableTime) {
  if (!availableDays || !availableTime) return [];

  const days = availableDays
    .split(",")
    .map((day) => day.trim())
    .filter(Boolean);

  const times = availableTime
    .split(",")
    .map((time) => time.trim())
    .filter(Boolean);

  if (days.length !== times.length) {
    throw new Error(
      "The number of available days must match the number of available times.",
    );
  }

  return days.map((day, index) => {
    const [startTime, endTime] = times[index]
      .split("-")
      .map((time) => time.trim());

    if (!startTime || !endTime) {
      throw new Error(`Invalid availability time for ${day}.`);
    }

    return {
      day_of_week: day,
      start_time: startTime,
      end_time: endTime,
    };
  });
}
function getUsername() {
  return JSON.parse(localStorage.getItem("user") || "{}").username || "unknown";
}
function normTime(t) {
  if (!t) return "00:00";
  // Convert 12-hour to 24-hour if needed
  const match = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match) {
    let h = parseInt(match[1], 10);
    const m = match[2];
    const period = match[3].toUpperCase();
    if (period === "AM" && h === 12) h = 0;
    if (period === "PM" && h !== 12) h += 12;
    return `${String(h).padStart(2, "0")}:${m}`;
  }
  // Strip seconds if HH:MM:SS
  return t.split(":").slice(0, 2).join(":");
}

function calcAge(birthDate) {
  if (!birthDate) return "";
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function flattenProfessor(row) {
  return {
    ...row,
    etu: row.ETU ?? row.etu ?? 0,
    specializations: (row.professor_specialization || [])
      .map((ps) => ps.specializations)
      .filter(Boolean),
    availability: (row.professor_availability || []).map((a) => ({
      ...a,
      start_time: normTime(a.start_time) || "00:00",
      end_time: normTime(a.end_time) || "00:00",
    })),
  };
}

export default function ProfessorsTab() {
  const [professors, setProfessors] = useState([]);
  const [specializations, setSpecializations] = useState([]);
  const [courses, setCourses] = useState([]);
  const [selectedProf, setSelectedProf] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [professorError, setProfessorError] = useState("");
  const [selectedProfessorIds, setSelectedProfessorIds] = useState([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [search, setSearch] = useState("");
  const [filterSpec, setFilterSpec] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [specOpen, setSpecOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null); // null | "uploading" | "success" | "error"
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef(null);

  async function fetchProfessors() {
    const { data, error } = await supabase
      .from("professor")
      .select(
        `
        *,
        professor_specialization ( specializations ( specialization_id, specialization_name ) ),
        professor_availability ( availability_id, day_of_week, start_time, end_time )
      `,
      )
      .order("last_name");
    if (error) {
      console.error("Failed to fetch professors:", error);
      return;
    }
    setProfessors((data || []).map(flattenProfessor));
  }

  async function fetchSpecializations() {
    const { data, error } = await supabase
      .from("specializations")
      .select("*")
      .order("specialization_name");
    if (error) {
      console.error("Failed to fetch specializations:", error);
      return;
    }
    setSpecializations(data || []);
  }

  async function fetchCourses() {
    const { data, error } = await supabase
      .from("courses")
      .select("*")
      .order("course_code");
    if (error) {
      console.error("Failed to fetch courses:", error);
      return;
    }
    setCourses(data || []);
  }

  useEffect(() => {
    async function loadAll() {
      await Promise.all([
        fetchProfessors(),
        fetchSpecializations(),
        fetchCourses(),
      ]);
    }
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = professors.filter((p) => {
    const fullName =
      `${p.first_name} ${p.middle_name} ${p.last_name}`.toLowerCase();
    const matchSearch = !search || fullName.includes(search.toLowerCase());
    const matchSpec =
      !filterSpec ||
      (p.specializations || []).some(
        (s) => s.specialization_name === filterSpec,
      );
    const matchStatus = !filterStatus || p.employment_status === filterStatus;
    return matchSearch && matchSpec && matchStatus;
  });

  function handleSelectProf(prof) {
    setSelectedProf(prof);
    setEditForm({ ...prof });
    setSpecOpen(false);
    setDeleteConfirm(false);
    setSaveStatus(null);
  }

  function handleEditChange(field, value) {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  }

  function stepEtu(dir) {
    setEditForm((prev) => ({
      ...prev,
      etu: Math.max(0, Math.min(24, prev.etu + dir)),
    }));
  }

  function toggleSpec(spec) {
    setEditForm((prev) => {
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
    setEditForm((prev) => {
      const normalizedDay = normalizeDay(day);

      const exists = prev.availability.some(
        (a) => normalizeDay(a.day_of_week) === normalizedDay,
      );

      if (!exists && prev.availability.length >= 5) return prev;

      return {
        ...prev,

        availability: exists
          ? prev.availability.filter(
              (a) => normalizeDay(a.day_of_week) !== normalizedDay,
            )
          : [
              ...prev.availability,
              {
                day_of_week: normalizedDay,
                start_time: "00:00",
                end_time: "00:00",
              },
            ],
      };
    });
  }

  function setAvailTime(day, field, value) {
    const normalizedDay = normalizeDay(day);

    setEditForm((prev) => ({
      ...prev,

      availability: prev.availability.map((a) =>
        normalizeDay(a.day_of_week) === normalizedDay
          ? { ...a, [field]: value }
          : a,
      ),
    }));
  }

  function getAvailField(day, field) {
    const normalizedDay = normalizeDay(day);

    const found = editForm.availability.find(
      (a) => normalizeDay(a.day_of_week) === normalizedDay,
    );

    if (!found) {
      return field === "start_time" ? "08:00" : "17:00";
    }

    return found[field];
  }

  async function syncSpecializations(professorId, specs) {
    await supabase
      .from("professor_specialization")
      .delete()
      .eq("professor_id", professorId);
    if (specs.length > 0) {
      const rows = specs.map((s) => ({
        professor_id: professorId,
        specialization_id: s.specialization_id,
      }));
      const { error } = await supabase
        .from("professor_specialization")
        .insert(rows);
      if (error) console.error("Failed to sync specializations:", error);
    }
  }

  async function syncAvailability(professorId, availability) {
    await supabase
      .from("professor_availability")
      .delete()
      .eq("professor_id", professorId);
    if (availability.length > 0) {
      const rows = availability.map((a) => ({
        professor_id: professorId,
        day_of_week: a.day_of_week,
        start_time: normTime(a.start_time),
        end_time: normTime(a.end_time),
      }));
      const { error } = await supabase
        .from("professor_availability")
        .insert(rows);
      if (error) console.error("Failed to sync availability:", error);
    }
  }

  async function writeLog(action, entity, details = "") {
    await supabase
      .from("change_log")
      .insert({ action, entity, details, performed_by: getUsername() });
  }

  async function handleSaveEdit() {
    setSaveStatus("saving");
    setProfessorError("");

    const {
      professor_id,
      specializations: specs,
      availability,
      // eslint-disable-next-line no-unused-vars
      professor_specialization: _ps,
      // eslint-disable-next-line no-unused-vars
      professor_availability: _pa,
      etu,
      ...basicFields
    } = editForm;

    const employeeNum = String(basicFields.employee_num || "").trim();

    // Check whether ANOTHER professor already uses this employee number
    const { data: existingProf, error: checkError } = await supabase
      .from("professor")
      .select("professor_id, first_name, last_name")
      .eq("employee_num", employeeNum)
      .neq("professor_id", professor_id)
      .limit(1);

    if (checkError) {
      console.error("Failed to check employee number:", checkError);

      setProfessorError("Unable to verify the employee number.");
      setSaveStatus(null);
      return;
    }

    if (existingProf && existingProf.length > 0) {
      const existing = existingProf[0];

      setProfessorError(
        `Employee number ${employeeNum} is already assigned to ${existing.first_name} ${existing.last_name}.`,
      );

      setSaveStatus(null);

      setTimeout(() => {
        setProfessorError("");
      }, 5000);

      return;
    }

    // No duplicate → update professor
    const { error } = await supabase
      .from("professor")
      .update({ ...basicFields, ETU: etu })
      .eq("professor_id", professor_id);

    if (error) {
      console.error("Failed to update professor:", error);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus(null), 3000);
      return;
    }

    await syncSpecializations(professor_id, specs || []);
    await syncAvailability(professor_id, availability || []);

    const updated = { ...editForm };

    setProfessors((prev) =>
      prev.map((p) => (p.professor_id === professor_id ? updated : p)),
    );

    setSelectedProf(updated);

    setSaveStatus("success");
    setTimeout(() => setSaveStatus(null), 3000);

    const name = `${editForm.last_name}, ${editForm.first_name}${
      editForm.middle_name ? ` ${editForm.middle_name[0]}.` : ""
    }`;

    await writeLog(
      "Edited professor",
      name,
      `${editForm.employment_status} · ETU ${etu}`,
    );
  }

  async function handleAdd(formData) {
    const {
      specializations: specs,
      availability,
      etu,
      ...basicFields
    } = formData;

    // Check if employee number already exists
    const employeeNum = String(basicFields.employee_num || "").trim();

    const { data: existingProf, error: checkError } = await supabase
      .from("professor")
      .select("professor_id")
      .eq("employee_num", employeeNum)
      .limit(1);

    if (checkError) {
      console.error("Failed to check employee number:", checkError);
      setProfessorError("Unable to verify the employee number.");
      return;
    }

    if (existingProf && existingProf.length > 0) {
      setProfessorError(`Employee number ${employeeNum} already exists.`);

      setTimeout(() => {
        setProfessorError("");
      }, 5000);

      return;
    }

    // No duplicate → proceed with insert
    const { data: newProf, error } = await supabase
      .from("professor")
      .insert({ ...basicFields, ETU: etu ?? 0 })
      .select()
      .single();

    if (error) {
      console.error("Failed to add professor:", error);
      setProfessorError("Failed to add professor.");
      return;
    }

    if (specs?.length > 0) {
      await syncSpecializations(newProf.professor_id, specs);
    }

    if (availability?.length > 0) {
      await syncAvailability(newProf.professor_id, availability);
    }

    await fetchProfessors();
    setModalOpen(false);

    const name = `${formData.last_name}, ${formData.first_name}${
      formData.middle_name ? ` ${formData.middle_name[0]}.` : ""
    }`;

    await writeLog(
      "Added professor",
      name,
      `${formData.employment_status} · ETU ${etu ?? 0}`,
    );
  }

  function toggleProfessorSelection(professorId) {
    setSelectedProfessorIds((prev) =>
      prev.includes(professorId)
        ? prev.filter((id) => id !== professorId)
        : [...prev, professorId],
    );
  }

  function toggleSelectAll() {
    const visibleIds = filtered.map((p) => p.professor_id);

    const allSelected =
      visibleIds.length > 0 &&
      visibleIds.every((id) => selectedProfessorIds.includes(id));

    if (allSelected) {
      setSelectedProfessorIds((prev) =>
        prev.filter((id) => !visibleIds.includes(id)),
      );
    } else {
      setSelectedProfessorIds((prev) => [...new Set([...prev, ...visibleIds])]);
    }
  }

  async function handleDelete() {
    const professorId = selectedProf.professor_id;

    const name = `${selectedProf.last_name}, ${selectedProf.first_name}${
      selectedProf.middle_name ? ` ${selectedProf.middle_name[0]}.` : ""
    }`;

    // Check first if professor is already used in a schedule
    const { data: existingSchedules, error: scheduleCheckError } =
      await supabase
        .from("schedules")
        .select("schedule_id")
        .eq("professor_id", professorId)
        .limit(1);

    if (scheduleCheckError) {
      console.error("Failed to check professor schedules:", scheduleCheckError);
      alert("Unable to delete professor. Please try again.");
      return;
    }

    // Don't allow deletion if professor is referenced by a schedule
    if (existingSchedules && existingSchedules.length > 0) {
      setDeleteError(
        `${selectedProf.first_name.last_name || getFullName(selectedProf)} has schedules and cannot be deleted.`,
      );

      setDeleteConfirm(false);

      setTimeout(() => {
        setDeleteError("");
      }, 5000);

      return;
    }

    // Safe to delete related professor data
    const { error: qualifiedError } = await supabase
      .from("professor_qualified_subjects")
      .delete()
      .eq("professor_id", professorId);

    if (qualifiedError) {
      console.error(
        "Failed to delete professor qualified subjects:",
        qualifiedError,
      );
      alert("Failed to delete professor.");
      return;
    }

    const { error: specError } = await supabase
      .from("professor_specialization")
      .delete()
      .eq("professor_id", professorId);

    if (specError) {
      console.error("Failed to delete professor specializations:", specError);
      alert("Failed to delete professor.");
      return;
    }

    const { error: availabilityError } = await supabase
      .from("professor_availability")
      .delete()
      .eq("professor_id", professorId);

    if (availabilityError) {
      console.error(
        "Failed to delete professor availability:",
        availabilityError,
      );
      alert("Failed to delete professor.");
      return;
    }

    // Delete professor
    const { error } = await supabase
      .from("professor")
      .delete()
      .eq("professor_id", professorId);

    if (error) {
      console.error("Failed to delete professor:", error);

      if (error.code === "23503") {
        alert(
          "This professor cannot be deleted because they are currently referenced by existing records.",
        );
      } else {
        alert("Failed to delete professor. Please try again.");
      }

      return;
    }

    // Update UI
    setProfessors((prev) => prev.filter((p) => p.professor_id !== professorId));

    setSelectedProf(null);
    setEditForm(null);
    setDeleteConfirm(false);

    // Change log
    await writeLog(
      "Deleted professor",
      name,
      `${selectedProf.employment_status} · ETU ${selectedProf.etu}`,
    );
  }

  async function handleBulkDelete() {
    if (selectedProfessorIds.length === 0) return;

    setBulkDeleting(true);
    setDeleteError("");

    try {
      // Find selected professors that are already used in schedules
      const { data: scheduledProfessors, error: scheduleError } = await supabase
        .from("schedules")
        .select("professor_id")
        .in("professor_id", selectedProfessorIds);

      if (scheduleError) throw scheduleError;

      const blockedIds = [
        ...new Set(
          (scheduledProfessors || [])
            .map((row) => row.professor_id)
            .filter(Boolean),
        ),
      ];

      // Only professors not referenced by schedules can be deleted
      const deletableIds = selectedProfessorIds.filter(
        (id) => !blockedIds.includes(id),
      );

      if (deletableIds.length === 0) {
        setBulkDeleteOpen(false);

        setDeleteError(
          selectedProfessorIds.length === 1
            ? "The selected professor has schedules and cannot be deleted."
            : `${selectedProfessorIds.length} selected professors have schedules and cannot be deleted.`,
        );

        return;
      }

      // Get professor information first for change log
      const professorsToDelete = professors.filter((p) =>
        deletableIds.includes(p.professor_id),
      );

      // Delete related qualified subjects
      const { error: qualifiedError } = await supabase
        .from("professor_qualified_subjects")
        .delete()
        .in("professor_id", deletableIds);

      if (qualifiedError) throw qualifiedError;

      // Delete related specializations
      const { error: specError } = await supabase
        .from("professor_specialization")
        .delete()
        .in("professor_id", deletableIds);

      if (specError) throw specError;

      // Delete related availability
      const { error: availabilityError } = await supabase
        .from("professor_availability")
        .delete()
        .in("professor_id", deletableIds);

      if (availabilityError) throw availabilityError;

      // Delete professors
      const { error: professorError } = await supabase
        .from("professor")
        .delete()
        .in("professor_id", deletableIds);

      if (professorError) throw professorError;

      // Change log
      for (const prof of professorsToDelete) {
        const name = `${prof.last_name}, ${prof.first_name}${
          prof.middle_name ? ` ${prof.middle_name[0]}.` : ""
        }`;

        await writeLog(
          "Deleted professor",
          name,
          `${prof.employment_status} · ETU ${prof.etu ?? 0}`,
        );
      }

      // Remove deleted professors from UI
      setProfessors((prev) =>
        prev.filter((p) => !deletableIds.includes(p.professor_id)),
      );

      if (selectedProf && deletableIds.includes(selectedProf.professor_id)) {
        setSelectedProf(null);
        setEditForm(null);
      }

      setSelectedProfessorIds([]);
      setBulkDeleteOpen(false);

      // Some selected professors couldn't be deleted
      if (blockedIds.length > 0) {
        setDeleteError(
          `${deletableIds.length} professor${
            deletableIds.length !== 1 ? "s were" : " was"
          } deleted. ${blockedIds.length} professor${
            blockedIds.length !== 1 ? "s" : ""
          } could not be deleted because ${
            blockedIds.length !== 1 ? "they have" : "they have"
          } existing schedules.`,
        );
      }
    } catch (error) {
      console.error("Bulk delete failed:", error);

      setDeleteError("Some professors could not be deleted. Please try again.");

      setBulkDeleteOpen(false);
    } finally {
      setBulkDeleting(false);
    }
  }

  function handlePreferencesSave(updatedProf) {
    setProfessors((prev) =>
      prev.map((p) =>
        p.professor_id === updatedProf.professor_id ? updatedProf : p,
      ),
    );
    setSelectedProf(updatedProf);
  }

  function handleDownloadTemplate() {
    const templateData = [
      {
        first_name: "JUAN",
        middle_name: "SANTOS",
        last_name: "DELA CRUZ",
        employee_num: "20901234",
        birth_date: "1990-01-01",
        highest_degree_attained: "Master's Degree",
        employment_status: "Regular",
        date_of_first_appointment: "2020-06-01",
        etu: 0,
        specializations:
          "Computer Science,Cybersecurity,Entertainment and Multimedia Computing,Information Technology",
        qualified_subjects: "6CFUN,6LOGPROG,6OOP,6DSAL",
        available_days: "Monday, Wednesday, Friday",
        available_time: "08:00-17:00, 08:00-17:00, 08:00-17:00",
      },
    ];

    const instructions = [
      {
        Field: "first_name",
        Instruction: "Enter the professor's first name.",
      },
      {
        Field: "middle_name",
        Instruction:
          "Enter the professor's middle name. Leave blank if not applicable.",
      },
      {
        Field: "last_name",
        Instruction: "Enter the professor's last name.",
      },
      {
        Field: "employee_num",
        Instruction: "Enter the professor's employee number.",
      },
      {
        Field: "birth_date",
        Instruction: "Enter the birth date using YYYY-MM-DD format.",
      },
      {
        Field: "highest_degree_attained",
        Instruction:
          "Choose ONE only: Bachelor's Degree, Master's Degree, or Doctorate (PhD).",
      },
      {
        Field: "employment_status",
        Instruction:
          "Choose ONE only: Regular, Probationary, Fixed, or Part-Time.",
      },
      {
        Field: "date_of_first_appointment",
        Instruction:
          "Enter the date of first appointment using YYYY-MM-DD format.",
      },
      {
        Field: "etu",
        Instruction: "Enter the professor's ETU value.",
      },
      {
        Field: "specializations",
        Instruction:
          "Enter one or more specializations separated by commas: Computer Science, Cybersecurity, Entertainment and Multimedia Computing, Information Technology.",
      },
      {
        Field: "qualified_subjects",
        Instruction:
          "Enter qualified course codes separated by commas (e.g., 6CFUN, 6LOGPROG, 6OOP).",
      },
      {
        Field: "available_days",
        Instruction:
          "Enter available days separated by commas (e.g., Monday, Wednesday, Friday).",
      },
      {
        Field: "available_time",
        Instruction:
          "Required only for Probationary, Fixed, and Part-Time professors. Regular professors may leave this blank. Use 24-hour HH:MM-HH:MM format, with one time range for each available day (e.g., 08:00-17:00, 13:00-18:00).",
      },
    ];

    // Create workbook
    const wb = XLSX.utils.book_new();

    // Professor template sheet
    const ws = XLSX.utils.json_to_sheet(templateData);

    ws["!cols"] = [
      { wch: 16 },
      { wch: 16 },
      { wch: 20 },
      { wch: 16 },
      { wch: 14 },
      { wch: 26 },
      { wch: 20 },
      { wch: 24 },
      { wch: 10 },
      { wch: 50 },
      { wch: 35 },
      { wch: 35 },
      { wch: 50 },
    ];

    // Instructions sheet
    const instructionWs = XLSX.utils.json_to_sheet(instructions);

    instructionWs["!cols"] = [{ wch: 30 }, { wch: 100 }];

    // Add BOTH sheets
    XLSX.utils.book_append_sheet(wb, ws, "Professors");
    XLSX.utils.book_append_sheet(wb, instructionWs, "Instructions");

    // Download
    XLSX.writeFile(wb, "professors_template.xlsx");
  }

  async function handleProfessorImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setUploadStatus("uploading");
    setUploadError("");

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

      const normalizeKey = (key) =>
        String(key)
          .toLowerCase()
          .replace(/[\s_]+/g, "");

      const getValue = (row, ...possibleKeys) => {
        const normalizedRow = Object.fromEntries(
          Object.entries(row).map(([key, value]) => [normalizeKey(key), value]),
        );

        for (const key of possibleKeys) {
          const value = normalizedRow[normalizeKey(key)];

          if (value !== undefined && value !== null && value !== "") {
            return value;
          }
        }

        return "";
      };

      const toInsert = rows
        .map((r) => ({
          first_name: String(getValue(r, "first_name")).toUpperCase().trim(),

          last_name: String(getValue(r, "last_name")).toUpperCase().trim(),

          middle_name: String(getValue(r, "middle_name")).toUpperCase().trim(),

          employee_num: String(
            getValue(r, "employee_num", "employee_number"),
          ).trim(),

          birth_date: getValue(r, "birth_date") || null,

          date_of_first_appointment:
            getValue(r, "date_of_first_appointment") || null,

          degree: String(
            getValue(r, "highest_degree_attained", "degree") || "",
          ).trim(),

          employment_status: String(
            getValue(r, "employment_status") || "Regular",
          ).trim(),

          ETU: Number(getValue(r, "etu") || 0),

          is_active: true,

          _specializations: String(getValue(r, "specializations")).trim(),

          _qualified_subjects: String(getValue(r, "qualified_subjects")).trim(),

          _availability: parseAvailability(
            String(getValue(r, "available_days") || "").trim(),
            String(getValue(r, "available_time") || "").trim(),
          ),
        }))
        .filter((r) => r.first_name && r.last_name);

      if (toInsert.length === 0) {
        setUploadError(
          "No valid rows found. Make sure columns include first_name and last_name.",
        );
        setUploadStatus("error");
        setTimeout(() => setUploadStatus(null), 4000);
        return;
      }

      // Fetch specializations and courses for lookup
      const { data: allSpecs } = await supabase
        .from("specializations")
        .select("specialization_id, specialization_name");
      const { data: allCourses } = await supabase
        .from("courses")
        .select("course_id, course_code");
      const specMap = {};
      (allSpecs || []).forEach((s) => {
        specMap[s.specialization_name.toLowerCase().trim()] =
          s.specialization_id;
      });
      const courseMap = {};
      (allCourses || []).forEach((c) => {
        courseMap[c.course_code.trim().toUpperCase()] = c.course_id;
      });

      const skippedDuplicates = [];

      for (const row of toInsert) {
        const {
          _specializations,
          _qualified_subjects,
          _availability,
          ...professorData
        } = row;

        const employeeNum = String(professorData.employee_num || "").trim();

        // Check database before importing
        const { data: existingProf, error: duplicateCheckError } =
          await supabase
            .from("professor")
            .select("professor_id")
            .eq("employee_num", employeeNum)
            .limit(1);

        if (duplicateCheckError) {
          throw duplicateCheckError;
        }

        // Skip duplicate employee number
        if (existingProf && existingProf.length > 0) {
          skippedDuplicates.push(employeeNum);
          continue;
        }

        const { data: newProf, error: profErr } = await supabase
          .from("professor")
          .insert(professorData)
          .select("professor_id")
          .single();

        if (profErr) throw profErr;

        const profId = newProf.professor_id;

        if (_availability?.length > 0) {
          const availabilityRows = _availability.map((a) => ({
            professor_id: profId,
            day_of_week: a.day_of_week,
            start_time: normTime(a.start_time),
            end_time: normTime(a.end_time),
          }));

          const { error: availabilityError } = await supabase
            .from("professor_availability")
            .insert(availabilityRows);

          if (availabilityError) throw availabilityError;
        }

        // Insert specializations
        if (_specializations) {
          const specNames = _specializations
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          const specRows = specNames
            .map((name) => specMap[name.toLowerCase()])
            .filter(Boolean)
            .map((specId) => ({
              professor_id: profId,
              specialization_id: specId,
            }));
          if (specRows.length > 0) {
            await supabase.from("professor_specialization").insert(specRows);
          }
        }

        // Insert qualified subjects
        if (_qualified_subjects) {
          const codes = _qualified_subjects
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean);
          const subjectRows = codes
            .map((code, idx) => ({
              professor_id: profId,
              course_id: courseMap[code],
              priority_order: idx + 1,
            }))
            .filter((r) => r.course_id);
          if (subjectRows.length > 0) {
            await supabase
              .from("professor_qualified_subjects")
              .insert(subjectRows);
          }
        }
      }

      await fetchProfessors();

      if (skippedDuplicates.length > 0) {
        setUploadStatus("error");

        setUploadError(
          `Import completed, but ${skippedDuplicates.length} duplicate employee number${
            skippedDuplicates.length !== 1 ? "s were" : " was"
          } skipped: ${skippedDuplicates.join(", ")}`,
        );

        setTimeout(() => {
          setUploadStatus(null);
          setUploadError("");
        }, 6000);
      } else {
        setUploadStatus("success");
        setTimeout(() => setUploadStatus(null), 3000);
      }
    } catch (err) {
      console.error("Upload failed:", err);
      setUploadError(err.message || "Upload failed. Check your file format.");
      setUploadStatus("error");
      setTimeout(() => setUploadStatus(null), 4000);
    }
  }

  function getInitials(prof) {
    return `${prof.first_name?.[0] || ""}${prof.last_name?.[0] || ""}`;
  }

  function getFullName(prof) {
    const mid = prof.middle_name ? ` ${prof.middle_name[0]}.` : "";
    return `${prof.first_name}${mid} ${prof.last_name}`;
  }

  const isPartTime = editForm?.employment_status !== "Regular";

  return (
    <div className="profs-wrapper">
      {/* Upload zone */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: "none" }}
        onChange={handleProfessorImport}
      />
      <div
        className="profs-upload-zone"
        onClick={() => fileInputRef.current?.click()}
      >
        {uploadStatus === "uploading" ? (
          <>
            <i className="ti ti-loader profs-spin" aria-hidden="true" />
            <span>Uploading…</span>
          </>
        ) : uploadStatus === "success" ? (
          <>
            <i
              className="ti ti-circle-check"
              aria-hidden="true"
              style={{ color: "var(--green)" }}
            />
            <span style={{ color: "var(--green)" }}>Uploaded successfully</span>
          </>
        ) : uploadStatus === "error" ? (
          <>
            <i
              className="ti ti-alert-circle"
              aria-hidden="true"
              style={{ color: "var(--red)" }}
            />
            <span style={{ color: "var(--red)" }}>
              {uploadError || "Upload failed"}
            </span>
          </>
        ) : (
          <>
            <i className="ti ti-file-upload" aria-hidden="true" />
            <span>Upload Excel (.xlsx) to import professors</span>

            <button
              type="button"
              className="profs-template-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleDownloadTemplate(e);
              }}
            >
              <i className="ti ti-download" />
              Download Template
            </button>
          </>
        )}
      </div>

      {deleteError && (
        <div className="profs-delete-alert">
          <i className="ti ti-alert-circle" aria-hidden="true" />
          <span>{deleteError}</span>
        </div>
      )}

      <div className="profs-split"></div>
      <div className="profs-split">
        {/* LEFT — List */}
        <div className="profs-left">
          <div className="profs-list-header">
            <div className="profs-list-header-top">
              <span className="profs-list-title">Professors</span>

              <div className="profs-header-actions">
                {selectedProfessorIds.length > 0 && (
                  <button
                    type="button"
                    className="profs-bulk-delete-btn"
                    onClick={() => setBulkDeleteOpen(true)}
                  >
                    <i className="ti ti-trash" />
                    Delete ({selectedProfessorIds.length})
                  </button>
                )}

                <button
                  className="profs-add-btn"
                  onClick={() => {
                    setProfessorError("");
                    setModalOpen(true);
                  }}
                >
                  <i className="ti ti-plus" aria-hidden="true" /> Add
                </button>
              </div>
            </div>

            <div className="profs-search-wrap">
              <i className="ti ti-search" aria-hidden="true" />
              <input
                className="profs-search-input"
                placeholder="Search by name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  className="profs-search-clear"
                  onClick={() => setSearch("")}
                >
                  <i className="ti ti-x" />
                </button>
              )}
            </div>

            <div className="profs-filters">
              <select
                className="profs-filter-select"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
              >
                <option value="">All statuses</option>
                {EMPLOYMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                className="profs-filter-select"
                value={filterSpec}
                onChange={(e) => setFilterSpec(e.target.value)}
              >
                <option value="">All specializations</option>
                {specializations.map((s) => (
                  <option
                    key={s.specialization_id}
                    value={s.specialization_name}
                  >
                    {s.specialization_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {filtered.length > 0 && (
            <div className="profs-select-all">
              <label>
                <input
                  type="checkbox"
                  checked={
                    filtered.length > 0 &&
                    filtered.every((p) =>
                      selectedProfessorIds.includes(p.professor_id),
                    )
                  }
                  onChange={toggleSelectAll}
                />

                <span>
                  {selectedProfessorIds.length > 0
                    ? `${selectedProfessorIds.length} selected`
                    : "Select all"}
                </span>
              </label>
            </div>
          )}
          <div className="profs-list">
            {professors.length === 0 ? (
              <div className="profs-empty">
                <i className="ti ti-users" aria-hidden="true" />
                <p>No professors yet.</p>
                <p>Add one manually or upload an Excel file.</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="profs-empty">
                <p>No professors match your search.</p>
              </div>
            ) : (
              filtered.map((prof) => (
                <div
                  key={prof.professor_id}
                  className={`profs-row ${
                    selectedProf?.professor_id === prof.professor_id
                      ? "profs-row-selected"
                      : ""
                  }`}
                  onClick={() => handleSelectProf(prof)}
                >
                  <input
                    type="checkbox"
                    className="profs-row-checkbox"
                    checked={selectedProfessorIds.includes(prof.professor_id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleProfessorSelection(prof.professor_id)}
                  />

                  <div className="profs-avatar">{getInitials(prof)}</div>
                  <div className="profs-info">
                    <div className="profs-name">{getFullName(prof)}</div>
                    <div className="profs-meta">
                      {prof.employment_status} · ETU {prof.etu ?? 0}
                    </div>
                    <div className="profs-meta">
                      {(prof.specializations || [])
                        .slice(0, 2)
                        .map((s) => s.specialization_name)
                        .join(", ")}
                      {(prof.specializations || []).length > 2 &&
                        ` +${prof.specializations.length - 2}`}
                    </div>
                    <div className="profs-days">
                      {(prof.availability || []).map((a) => (
                        <span key={a.day_of_week} className="profs-day-chip">
                          {a.day_of_week.slice(0, 3)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <i className="ti ti-chevron-right profs-row-arrow" />
                </div>
              ))
            )}
          </div>
        </div>

        {/* RIGHT — Detail / Edit panel */}
        <div className="profs-right">
          {!selectedProf ? (
            <div className="profs-detail-empty">
              <i className="ti ti-user" aria-hidden="true" />
              <p>Select a professor to view and edit their details.</p>
            </div>
          ) : (
            <div className="profs-detail">
              <div className="profs-detail-header">
                <div className="profs-detail-avatar">
                  {getInitials(selectedProf)}
                </div>
                <div>
                  <div className="profs-detail-name">
                    {getFullName(selectedProf)}
                  </div>
                  <div className="profs-detail-meta">
                    {selectedProf.employment_status} · ETU{" "}
                    {selectedProf.etu ?? 0}
                  </div>
                </div>
              </div>

              <div className="profs-detail-divider" />

              <div className="profs-detail-body">
                {/* Personal Information */}
                <div className="profs-detail-section">
                  <div className="profs-detail-section-label">
                    Personal Information
                  </div>
                  <div className="profs-detail-row3">
                    <div className="profs-detail-field">
                      <label>First name</label>
                      <input
                        value={editForm.first_name}
                        onChange={(e) =>
                          handleEditChange(
                            "first_name",
                            e.target.value.toUpperCase(),
                          )
                        }
                      />
                    </div>
                    <div className="profs-detail-field">
                      <label>Middle name</label>
                      <input
                        value={editForm.middle_name || ""}
                        onChange={(e) =>
                          handleEditChange(
                            "middle_name",
                            e.target.value.toUpperCase(),
                          )
                        }
                      />
                    </div>
                    <div className="profs-detail-field">
                      <label>Last name</label>
                      <input
                        value={editForm.last_name}
                        onChange={(e) =>
                          handleEditChange(
                            "last_name",
                            e.target.value.toUpperCase(),
                          )
                        }
                      />
                    </div>
                  </div>

                  <div className="profs-detail-row2">
                    <div className="profs-detail-field">
                      <label>Employee number</label>

                      <input
                        value={editForm.employee_num || ""}
                        placeholder="20901234"
                        className={professorError ? "profs-input-error" : ""}
                        onChange={(e) => {
                          handleEditChange("employee_num", e.target.value);
                          setProfessorError("");
                        }}
                      />

                      {professorError && (
                        <span className="profs-field-error">
                          {professorError}
                        </span>
                      )}
                    </div>

                    <div className="profs-detail-field">
                      <label>Date of birth</label>
                      <input
                        type="date"
                        value={editForm.birth_date || ""}
                        onChange={(e) =>
                          handleEditChange("birth_date", e.target.value)
                        }
                      />
                    </div>
                  </div>
                  <div className="profs-detail-field profs-detail-field-half">
                    <label>
                      Age{" "}
                      <span className="profs-detail-derived">
                        (auto-calculated)
                      </span>
                    </label>
                    <input
                      value={
                        calcAge(editForm.birth_date)
                          ? `${calcAge(editForm.birth_date)} years old`
                          : ""
                      }
                      readOnly
                      placeholder="Fill in date of birth"
                      className="profs-detail-readonly"
                    />
                  </div>
                </div>

                {/* Employment */}
                <div className="profs-detail-section">
                  <div className="profs-detail-section-label">Employment</div>
                  <div className="profs-detail-row2">
                    <div className="profs-detail-field">
                      <label>Employment status</label>
                      <select
                        value={editForm.employment_status}
                        onChange={(e) =>
                          handleEditChange("employment_status", e.target.value)
                        }
                      >
                        {EMPLOYMENT_STATUSES.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                    <div className="profs-detail-field">
                      <label>Highest Degree Attained</label>
                      <select
                        value={editForm.degree || ""}
                        onChange={(e) =>
                          handleEditChange("degree", e.target.value)
                        }
                      >
                        <option value="">— Select degree —</option>
                        {HIGHEST_DEGREES.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="profs-detail-row2">
                    <div className="profs-detail-field">
                      <label>Date of First Appointment</label>
                      <input
                        type="date"
                        value={editForm.date_of_first_appointment || ""}
                        onChange={(e) =>
                          handleEditChange(
                            "date_of_first_appointment",
                            e.target.value,
                          )
                        }
                      />
                    </div>
                    <div className="profs-detail-field">
                      <label>
                        Years of Service{" "}
                        <span className="profs-detail-derived">
                          (auto-calculated)
                        </span>
                      </label>
                      <input
                        value={
                          editForm.date_of_first_appointment
                            ? `${calcAge(editForm.date_of_first_appointment)} year(s)`
                            : ""
                        }
                        readOnly
                        placeholder="Fill in date of first appointment"
                        className="profs-detail-readonly"
                      />
                    </div>
                  </div>

                  <div className="profs-detail-field profs-detail-field-half">
                    <label>ETU (Equivalent Teaching Unit)</label>
                    <div className="profs-detail-stepper">
                      <button
                        type="button"
                        className="profs-detail-step-btn"
                        onClick={() => stepEtu(-1)}
                        disabled={editForm.etu <= 0}
                      >
                        <i className="ti ti-minus" />
                      </button>
                      <input
                        type="number"
                        value={editForm.etu ?? 0}
                        onChange={(e) =>
                          handleEditChange(
                            "etu",
                            Math.max(0, Math.min(24, +e.target.value)),
                          )
                        }
                        className="profs-detail-step-input"
                        min={0}
                        max={24}
                      />
                      <button
                        type="button"
                        className="profs-detail-step-btn"
                        onClick={() => stepEtu(1)}
                        disabled={editForm.etu >= 24}
                      >
                        <i className="ti ti-plus" />
                      </button>
                    </div>
                  </div>

                  <div className="profs-detail-field">
                    <label className="profs-detail-toggle-label">
                      <input
                        type="checkbox"
                        checked={editForm.is_active}
                        onChange={(e) =>
                          handleEditChange("is_active", e.target.checked)
                        }
                        className="profs-detail-toggle-chk"
                      />
                      <span>Active professor</span>
                    </label>
                  </div>
                </div>

                {/* Specializations */}
                <div className="profs-detail-section">
                  <div className="profs-detail-section-label">
                    Areas of specialization
                  </div>
                  <div className="profs-detail-field">
                    <label>Select all that apply</label>
                    <div className="profs-detail-multi-dd">
                      <button
                        type="button"
                        className={`profs-detail-dd-trigger ${specOpen ? "profs-detail-dd-open" : ""}`}
                        onClick={() => setSpecOpen((o) => !o)}
                      >
                        <span>
                          {(editForm.specializations || []).length > 0
                            ? editForm.specializations
                                .map((s) => s.specialization_name)
                                .join(", ")
                            : "Select specializations…"}
                        </span>
                        <i className="ti ti-chevron-down" />
                      </button>
                      {specOpen && (
                        <div className="profs-detail-dd-list">
                          {specializations.length === 0 ? (
                            <div className="profs-detail-dd-empty">
                              No specializations available.
                            </div>
                          ) : (
                            specializations.map((spec) => (
                              <label
                                key={spec.specialization_id}
                                className="profs-detail-dd-item"
                              >
                                <input
                                  type="checkbox"
                                  checked={(
                                    editForm.specializations || []
                                  ).some(
                                    (s) =>
                                      s.specialization_id ===
                                      spec.specialization_id,
                                  )}
                                  onChange={() => toggleSpec(spec)}
                                  className="profs-detail-chk"
                                />
                                {spec.specialization_name}
                              </label>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                    {(editForm.specializations || []).length > 0 && (
                      <div className="profs-detail-chips">
                        {editForm.specializations.map((s) => (
                          <span
                            key={s.specialization_id}
                            className="profs-detail-chip"
                          >
                            {s.specialization_name}
                            <button
                              type="button"
                              className="profs-detail-chip-remove"
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

                {/* Available Days */}
                <div className="profs-detail-section">
                  <div className="profs-detail-section-label">
                    Available days
                    <span className="profs-detail-optional">
                      {" "}
                      — max 5, ideal 4
                    </span>
                  </div>
                  <div className="profs-detail-day-group">
                    {DAYS_OF_WEEK.map((day) => {
                      const checked = (editForm.availability || []).some(
                        (a) =>
                          normalizeDay(a.day_of_week) === normalizeDay(day),
                      );
                      const disabled =
                        !checked && (editForm.availability || []).length >= 5;
                      return (
                        <button
                          key={day}
                          type="button"
                          className={`profs-detail-day-btn ${checked ? "profs-detail-day-checked" : ""} ${disabled ? "profs-detail-day-disabled" : ""}`}
                          onClick={() => !disabled && toggleDay(day)}
                          disabled={disabled}
                        >
                          {day.slice(0, 3)}
                        </button>
                      );
                    })}
                  </div>

                  {isPartTime && (editForm.availability || []).length > 0 && (
                    <div className="profs-detail-time-block">
                      <div className="profs-detail-time-label">
                        Time of availability
                        <span className="profs-detail-optional">
                          {" "}
                          (per day)
                        </span>
                      </div>
                      {editForm.availability.map((a) => {
                        const startVal =
                          getAvailField(a.day_of_week, "start_time") || "00:00";
                        const endVal =
                          getAvailField(a.day_of_week, "end_time") || "00:00";
                        const [startH, startM] = startVal
                          .split(":")
                          .slice(0, 2);
                        const [endH, endM] = endVal.split(":").slice(0, 2);
                        return (
                          <div
                            key={a.day_of_week}
                            className="profs-detail-time-row"
                          >
                            <span className="profs-detail-day-label">
                              {a.day_of_week.slice(0, 3)}
                            </span>
                            <TimeWheel
                              hideDay
                              start_h={startH}
                              start_m={startM}
                              end_h={endH}
                              end_m={endM}
                              onChange={(field, val) => {
                                const newStart =
                                  field === "start_h"
                                    ? `${val}:${startM}`
                                    : field === "start_m"
                                      ? `${startH}:${val}`
                                      : startVal;
                                const newEnd =
                                  field === "end_h"
                                    ? `${val}:${endM}`
                                    : field === "end_m"
                                      ? `${endH}:${val}`
                                      : endVal;
                                setAvailTime(
                                  a.day_of_week,
                                  "start_time",
                                  newStart,
                                );
                                setAvailTime(a.day_of_week, "end_time", newEnd);
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Qualified Subjects */}
                <PreferencesPanel
                  professor={selectedProf}
                  courses={courses}
                  onSave={handlePreferencesSave}
                />
              </div>

              {/* Footer */}
              <div className="profs-detail-footer">
                {deleteConfirm ? (
                  <div className="profs-detail-delete-confirm">
                    <span>Are you sure?</span>
                    <button
                      className="profs-detail-confirm-yes"
                      onClick={handleDelete}
                    >
                      <i className="ti ti-trash" /> Yes, delete
                    </button>
                    <button
                      className="profs-detail-confirm-no"
                      onClick={() => setDeleteConfirm(false)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      className="profs-detail-delete-btn"
                      onClick={() => setDeleteConfirm(true)}
                    >
                      <i className="ti ti-trash" /> Delete
                    </button>
                    <div className="profs-detail-save-group">
                      {saveStatus === "success" && (
                        <span className="profs-save-status profs-save-success">
                          <i className="ti ti-circle-check" /> Saved
                          successfully
                        </span>
                      )}
                      {saveStatus === "error" && (
                        <span className="profs-save-status profs-save-error">
                          <i className="ti ti-alert-circle" /> Save failed
                        </span>
                      )}
                      <button
                        className="profs-detail-save-btn"
                        onClick={handleSaveEdit}
                        disabled={saveStatus === "saving"}
                      >
                        {saveStatus === "saving" ? (
                          <>
                            <i className="ti ti-loader profs-spin" /> Saving…
                          </>
                        ) : (
                          <>
                            <i className="ti ti-device-floppy" /> Save changes
                          </>
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Modal */}
      {modalOpen && (
        <ProfessorModal
          professor={null}
          specializations={specializations}
          onSave={handleAdd}
          error={professorError}
          onClose={() => {
            setModalOpen(false);
            setProfessorError("");
          }}
        />
      )}
      {bulkDeleteOpen && (
        <div
          className="profs-overlay"
          onClick={() => !bulkDeleting && setBulkDeleteOpen(false)}
        >
          <div
            className="profs-confirm-box"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="profs-confirm-icon">
              <i className="ti ti-alert-triangle" />
            </div>

            <div className="profs-confirm-title">
              Delete selected professors?
            </div>

            <div className="profs-confirm-msg">
              You are about to delete{" "}
              <strong>{selectedProfessorIds.length}</strong> professor
              {selectedProfessorIds.length !== 1 ? "s" : ""}.
              <br />
              <br />
              Professors assigned to existing schedules will not be deleted.
              This action cannot be undone.
            </div>

            <div className="profs-confirm-btns">
              <button
                type="button"
                className="profs-confirm-cancel"
                disabled={bulkDeleting}
                onClick={() => setBulkDeleteOpen(false)}
              >
                Cancel
              </button>

              <button
                type="button"
                className="profs-confirm-delete"
                disabled={bulkDeleting}
                onClick={handleBulkDelete}
              >
                {bulkDeleting ? (
                  <>
                    <i className="ti ti-loader profs-spin" />
                    Deleting…
                  </>
                ) : (
                  <>
                    <i className="ti ti-trash" />
                    Delete
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
