import { useState, useEffect } from "react";
import { supabase } from "../../../../lib/supabaseClient";
import "./preferences_panel.css";

export default function PreferencesPanel({ professor, courses, onSave }) {
  const [subjects, setSubjects] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [checked, setChecked] = useState([]);
  const [dragSrc, setDragSrc] = useState(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Load existing qualified subjects from DB when professor changes
  useEffect(() => {
    if (!professor?.professor_id) return;
    async function load() {
      const { data } = await supabase
        .from("professor_qualified_subjects")
        .select("course_id, priority_order")
        .eq("professor_id", professor.professor_id)
        .order("priority_order");
      if (!data) return;
      const enriched = data.map((row) => {
        const course = courses.find((c) => c.course_id === row.course_id);
        return {
          course_id: row.course_id,
          course_code: course?.course_code || "",
          course_name: course?.course_name || "",
          priority_order: row.priority_order,
        };
      });
      setSubjects(enriched);
    }
    load();
  }, [professor?.professor_id, courses]);

  if (!professor) return null;

  // Only major subjects (course_code starts with "6")
  const majorCourses = courses.filter((c) =>
    (c.course_code || "").startsWith("6"),
  );
  const alreadyAdded = subjects.map((s) => s.course_id);
  const available = majorCourses.filter(
    (c) => !alreadyAdded.includes(c.course_id),
  );

  // Search filter
  const searchLower = search.toLowerCase();
  const filtered = search
    ? available.filter(
        (c) =>
          c.course_code.toLowerCase().includes(searchLower) ||
          c.course_name.toLowerCase().includes(searchLower),
      )
    : available;

  // Group into specialization-match vs others
  const profSpecIds = (professor.specializations || []).map(
    (s) => s.specialization_id,
  );
  const matchingCourses = filtered.filter((c) =>
    (c.specializations || []).some((s) =>
      profSpecIds.includes(s.specialization_id),
    ),
  );
  const otherCourses = filtered.filter(
    (c) =>
      !(c.specializations || []).some((s) =>
        profSpecIds.includes(s.specialization_id),
      ),
  );

  function toggleCheck(courseId) {
    setChecked((prev) =>
      prev.includes(courseId)
        ? prev.filter((id) => id !== courseId)
        : [...prev, courseId],
    );
  }

  function toggleAll() {
    setChecked(
      checked.length === filtered.length
        ? []
        : filtered.map((c) => c.course_id),
    );
  }

  function handleAddSelected() {
    const toAdd = courses
      .filter((c) => checked.includes(c.course_id))
      .map((c, idx) => ({
        course_id: c.course_id,
        course_code: c.course_code,
        course_name: c.course_name,
        priority_order: subjects.length + idx + 1,
      }));
    setSubjects((prev) => [...prev, ...toAdd]);
    setChecked([]);
    setAddOpen(false);
    setSearch("");
  }

  function handleRemove(courseId) {
    setSubjects((prev) =>
      prev
        .filter((s) => s.course_id !== courseId)
        .map((s, idx) => ({ ...s, priority_order: idx + 1 })),
    );
  }

  function onDragStart(e, idx) {
    setDragSrc(idx);
    e.dataTransfer.effectAllowed = "move";
  }
  function onDragOver(e, idx) {
    e.preventDefault();
    if (dragSrc === null || dragSrc === idx) return;
    const next = [...subjects];
    const [moved] = next.splice(dragSrc, 1);
    next.splice(idx, 0, moved);
    setSubjects(next.map((s, i) => ({ ...s, priority_order: i + 1 })));
    setDragSrc(idx);
  }
  function onDragEnd() {
    setDragSrc(null);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError("");
    try {
      const profId = professor.professor_id;
      // Delete existing rows for this professor
      const { error: delErr } = await supabase
        .from("professor_qualified_subjects")
        .delete()
        .eq("professor_id", profId);
      if (delErr) throw delErr;

      // Insert new rows
      if (subjects.length > 0) {
        const { error: insErr } = await supabase
          .from("professor_qualified_subjects")
          .insert(
            subjects.map((s, idx) => ({
              professor_id: profId,
              course_id: s.course_id,
              priority_order: idx + 1,
            })),
          );
        if (insErr) throw insErr;
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      if (onSave) onSave({ ...professor, qualified_subjects: subjects });
    } catch (err) {
      console.error(err);
      setSaveSuccess(false);
      setSaveError("Save failed. Please try again.");
    }
    setSaving(false);
  }

  const allChecked = filtered.length > 0 && checked.length === filtered.length;

  return (
    <div className="prefs-panel">
      <div className="prefs-header">
        <div>
          <div className="prefs-title">Qualified Subjects to Teach</div>
          <div className="prefs-hint">
            Major subjects only · Drag to reorder · Top = highest priority
          </div>
        </div>
        <button
          className="prefs-save-btn"
          onClick={handleSave}
          disabled={saving}
        >
          <i className="ti ti-device-floppy" /> {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {saveError && (
        <div className="prefs-error">
          <i className="ti ti-alert-circle" /> {saveError}
        </div>
      )}
      {saveSuccess && (
        <div className="prefs-success">
          <i className="ti ti-circle-check" /> Saved successfully.
        </div>
      )}

      {/* Add subjects */}
      <div className="prefs-add-section">
        {!addOpen ? (
          <button
            className="prefs-add-trigger"
            onClick={() => {
              setAddOpen(true);
              setChecked([]);
              setSearch("");
            }}
            disabled={available.length === 0 && majorCourses.length === 0}
          >
            <i className="ti ti-plus" /> Add qualified subjects
          </button>
        ) : (
          <div className="prefs-add-panel">
            <div className="prefs-add-panel-header">
              <span className="prefs-add-panel-title">
                Select qualified subjects
              </span>
              <button
                className="prefs-add-cancel"
                onClick={() => {
                  setAddOpen(false);
                  setChecked([]);
                  setSearch("");
                }}
              >
                <i className="ti ti-x" /> Cancel
              </button>
            </div>

            {/* Search */}
            <div className="prefs-search-wrap">
              <i className="ti ti-search prefs-search-icon" />
              <input
                className="prefs-search-input"
                placeholder="Search by code or name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
              {search && (
                <button
                  className="prefs-search-clear"
                  onClick={() => setSearch("")}
                >
                  <i className="ti ti-x" />
                </button>
              )}
            </div>

            {/* Select all */}
            {filtered.length > 0 && (
              <label className="prefs-select-all">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  className="prefs-chk"
                />
                <span>Select all ({filtered.length})</span>
              </label>
            )}

            {/* Course list */}
            <div className="prefs-course-list">
              {filtered.length === 0 ? (
                <div className="prefs-no-courses">
                  {search
                    ? "No courses match your search."
                    : available.length === 0
                      ? "All major courses already added."
                      : "No major courses available."}
                </div>
              ) : (
                <>
                  {matchingCourses.length > 0 && (
                    <div className="prefs-course-group">
                      <div className="prefs-group-label">
                        <i className="ti ti-star-filled" /> Matches
                        specialization
                      </div>
                      {matchingCourses.map((c) => (
                        <label
                          key={c.course_id}
                          className={`prefs-course-row ${checked.includes(c.course_id) ? "prefs-course-row-checked" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked.includes(c.course_id)}
                            onChange={() => toggleCheck(c.course_id)}
                            className="prefs-chk"
                          />
                          <div className="prefs-course-info">
                            <span className="prefs-course-code">
                              {c.course_code}
                            </span>
                            <span className="prefs-course-title">
                              {c.course_name}
                            </span>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                  {otherCourses.length > 0 && (
                    <div className="prefs-course-group">
                      {matchingCourses.length > 0 && (
                        <div className="prefs-group-label">Other courses</div>
                      )}
                      {otherCourses.map((c) => (
                        <label
                          key={c.course_id}
                          className={`prefs-course-row ${checked.includes(c.course_id) ? "prefs-course-row-checked" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked.includes(c.course_id)}
                            onChange={() => toggleCheck(c.course_id)}
                            className="prefs-chk"
                          />
                          <div className="prefs-course-info">
                            <span className="prefs-course-code">
                              {c.course_code}
                            </span>
                            <span className="prefs-course-title">
                              {c.course_name}
                            </span>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {filtered.length > 0 && (
              <button
                className="prefs-add-confirm"
                onClick={handleAddSelected}
                disabled={checked.length === 0}
              >
                <i className="ti ti-plus" />
                {checked.length > 0
                  ? `Add ${checked.length} subject${checked.length > 1 ? "s" : ""}`
                  : "Add selected"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Drag list */}
      {subjects.length === 0 ? (
        <div className="prefs-no-subj">
          No qualified subjects added yet. Click{" "}
          <strong>Add qualified subjects</strong> to get started.
        </div>
      ) : (
        <div className="prefs-drag-list">
          {subjects.map((subj, idx) => (
            <div
              key={subj.course_id}
              className={`prefs-drag-item ${dragSrc === idx ? "prefs-dragging" : ""}`}
              draggable
              onDragStart={(e) => onDragStart(e, idx)}
              onDragOver={(e) => onDragOver(e, idx)}
              onDragEnd={onDragEnd}
            >
              <span className="prefs-handle">⠿</span>
              <span className="prefs-rank">{idx + 1}</span>
              <div className="prefs-subj-info">
                <span className="prefs-subj-code">{subj.course_code}</span>
                <span className="prefs-subj-title">{subj.course_name}</span>
              </div>
              <span
                className={`prefs-badge ${idx === 0 ? "prefs-badge-top" : idx === subjects.length - 1 ? "prefs-badge-low" : "prefs-badge-mid"}`}
              >
                {idx === 0
                  ? "Highest priority"
                  : idx === subjects.length - 1
                    ? "Lowest priority"
                    : "Priority"}
              </span>
              <button
                className="prefs-remove-btn"
                onClick={() => handleRemove(subj.course_id)}
                title="Remove"
              >
                <i className="ti ti-x" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
