import { useState } from "react";
import { YEAR_LEVELS, groupSectionsByCurriculum } from "../generate_utils";
import "./approve_session_modal.css";

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
  // Match full name ("monday") or abbreviation ("mon")
  return (
    DAY_ORDER.find(
      (day) => day.toLowerCase() === val || day.toLowerCase().startsWith(val),
    ) || d
  );
}

function timeToMinutes(t) {
  // Handles "HH:MM", "H:MM", "HH:MM:SS" from postgres
  if (!t) return 9999;
  const p = t.split(":");
  return parseInt(p[0], 10) * 60 + parseInt(p[1] || "0", 10);
}

function sortSchedules(schedules) {
  // Debug — remove after confirming fix
  if (schedules?.length) {
    console.log(
      "[APM] raw days:",
      schedules.map((s) => s.day),
    );
    console.log(
      "[APM] raw times:",
      schedules.map((s) => s.start_time),
    );
  }
  return [...(schedules || [])].sort((a, b) => {
    const ad = normalizeDay(a.day);
    const bd = normalizeDay(b.day);
    const ai = DAY_ORDER.includes(ad) ? DAY_ORDER.indexOf(ad) : 99;
    const bi = DAY_ORDER.includes(bd) ? DAY_ORDER.indexOf(bd) : 99;
    if (ai !== bi) return ai - bi;
    return timeToMinutes(a.start_time) - timeToMinutes(b.start_time);
  });
}

export default function ApproveSessionModal({
  previewOpen,
  confirmOpen,
  onClosePreview,
  onCloseConfirm,
  selectedSession,
  getSemesterLabel,
  onApprove,
}) {
  const [selectedSection, setSelectedSection] = useState(null);

  // Auto-select first section when modal opens
  const sections = selectedSession?.sections || [];
  const firstSection = sections[0] || null;
  const activeSection = selectedSection || firstSection;

  const curriculumGroups = groupSectionsByCurriculum(sections);

  return (
    <>
      {/* ── Preview modal ── */}
      {previewOpen && selectedSession && (
        <div className="apm-overlay" onClick={onClosePreview}>
          <div
            className="apm-preview-modal"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="apm-header">
              <div>
                <div className="apm-title">
                  Preview — {selectedSession.school_year} ·{" "}
                  {getSemesterLabel(selectedSession.semester)}
                </div>
                <div className="apm-sub">
                  Review all schedules before approving.
                </div>
              </div>
              <div className="apm-header-actions">
                <button className="apm-cancel-btn" onClick={onClosePreview}>
                  Cancel
                </button>
                <button
                  className="apm-approve-btn"
                  onClick={() => {
                    onClosePreview();
                    onApprove("open_confirm");
                  }}
                >
                  <i className="ti ti-circle-check" /> Looks good, approve
                </button>
              </div>
            </div>

            {/* Split body */}
            <div className="apm-split">
              {/* Left — section list */}
              <div className="apm-section-list">
                {Object.entries(curriculumGroups).map(
                  ([currLabel, yearGroups]) => (
                    <div key={currLabel} className="apm-list-curriculum">
                      <div className="apm-list-curr-label">
                        <i className="ti ti-books" aria-hidden="true" />{" "}
                        {currLabel}
                      </div>
                      {Object.entries(yearGroups).map(([yl, sectionList]) => (
                        <div key={yl} className="apm-list-yr-group">
                          <div className="apm-list-yr-label">
                            {yl === "summer"
                              ? "Summer"
                              : YEAR_LEVELS.find((y) => y.value === +yl)
                                  ?.label || `Year ${yl}`}
                          </div>
                          {sectionList.map((sec) => (
                            <button
                              key={sec.section_id}
                              className={`apm-list-item ${activeSection?.section_id === sec.section_id ? "apm-list-item-active" : ""}`}
                              onClick={() => setSelectedSection(sec)}
                            >
                              <span className="apm-list-item-name">
                                {sec.section_name}
                              </span>
                              <span className="apm-list-item-count">
                                {(sec.schedules || []).length}
                              </span>
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  ),
                )}
              </div>

              {/* Right — schedule table */}
              <div className="apm-table-panel">
                {activeSection ? (
                  <>
                    <div className="apm-table-header">
                      <div className="apm-table-header-name">
                        {activeSection.section_name}
                      </div>
                      <div className="apm-table-header-count">
                        {(activeSection.schedules || []).length} schedule
                        {(activeSection.schedules || []).length !== 1
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
                          {sortSchedules(activeSection.schedules).map(
                            (sched, idx) => (
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
                                <td>
                                  {sched.room_name || (
                                    <span className="apm-tba">TBA</span>
                                  )}
                                </td>
                                <td>
                                  {sched.day ? (
                                    <span className="apm-day-badge">
                                      {normalizeDay(sched.day).slice(0, 3)}
                                    </span>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                                <td className="apm-time">
                                  {sched.start_time} – {sched.end_time}
                                </td>
                              </tr>
                            ),
                          )}
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
      )}

      {/* ── Confirm modal ── */}
      {confirmOpen && (
        <div className="apm-overlay" onClick={onCloseConfirm}>
          <div className="apm-confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="apm-confirm-icon">
              <i className="ti ti-circle-check" />
            </div>
            <div className="apm-confirm-title">Approve this session?</div>
            <p className="apm-confirm-msg">
              This will mark all schedules as approved. Individual schedules can
              still be edited after approval.
            </p>
            <div className="apm-confirm-btns">
              <button className="apm-cancel-btn" onClick={onCloseConfirm}>
                Cancel
              </button>
              <button
                className="apm-approve-btn"
                onClick={() => onApprove("confirm")}
              >
                <i className="ti ti-circle-check" /> Approve
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
