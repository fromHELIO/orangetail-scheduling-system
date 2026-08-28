import "./violation_drilldown_dialog.css";

const CATEGORY_LABELS = {
  HC05_room_type: "Room Type Mismatch",
  HC04_qualification: "Qualification Mismatch",
  HC03_section_conflict: "Section Conflict",
  HC01_teacher_conflict: "Teacher Conflict",
  HC02_room_conflict: "Room Conflict",
  daily_span: "Daily Span Over 9 Hours",
  teacher_overload: "Teacher Overload",
  faculty_priority: "Faculty Priority",
  teacher_unavailable: "Teacher Unavailable",
  short_rest: "Short Rest",
  faculty_break: "Faculty Break",
  student_break: "Student Break",
};

// Categories with a drill-down that can actually explain WHICH genes and
// why. Everything else in the breakdown still contributes to the total,
// but doesn't yet have a structured finding to show here -- shown as a
// simple count instead of an empty section.
const DRILLDOWN_CATEGORIES = new Set([
  "HC05_room_type",
  "HC04_qualification",
  "daily_span",
  "teacher_overload",
  "faculty_priority",
  "teacher_unavailable",
]);

export default function ViolationDrilldownDialog({
  open,
  onClose,
  breakdown,
  drilldowns,
}) {
  if (!open) return null;

  const total = Object.values(breakdown || {}).reduce((a, b) => a + b, 0);
  const detailedCategories = Object.keys(drilldowns || {}).filter(
    (k) => (drilldowns[k] || []).length > 0,
  );
  const otherCategories = Object.entries(breakdown || {}).filter(
    ([cat, count]) => count > 0 && !DRILLDOWN_CATEGORIES.has(cat),
  );

  return (
    <div className="vd-overlay" onClick={onClose}>
      <div className="vd-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="vd-header">
          <div>
            <h2>Violation Details</h2>
            {total > 0 && (
              <div className="vd-header-sub">
                {total} hard violation{total === 1 ? "" : "s"} in this
                schedule
              </div>
            )}
          </div>
          <button className="vd-close" onClick={onClose}>
            <i className="ti ti-x" />
          </button>
        </div>

        <div className="vd-body">
          {total === 0 ? (
            <div className="vd-empty">
              <i className="ti ti-circle-check" />
              <p>No hard violations in this schedule.</p>
            </div>
          ) : (
            <>
              {detailedCategories.map((cat) => (
                <div key={cat} className="vd-section">
                  <div className="vd-section-label">
                    {CATEGORY_LABELS[cat] || cat} ({drilldowns[cat].length})
                  </div>
                  <div className="vd-findings-list">
                    {drilldowns[cat].map((finding, i) => (
                      <ViolationCard key={i} category={cat} finding={finding} />
                    ))}
                  </div>
                </div>
              ))}

              {otherCategories.length > 0 && (
                <div className="vd-section">
                  <div className="vd-section-label">Other categories</div>
                  <div className="vd-other-list">
                    {otherCategories.map(([cat, count]) => (
                      <div key={cat} className="vd-other-row">
                        <span>{CATEGORY_LABELS[cat] || cat}</span>
                        <span className="vd-other-count">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="vd-footer">
          <button className="vd-close-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function ViolationCard({ category, finding }) {
  switch (category) {
    case "HC05_room_type":
      return (
        <div className="vd-card">
          <div className="vd-card-title">
            {finding.section} · {finding.subject}
          </div>
          <div className="vd-card-detail">
            Needs <b>{finding.needed_category}</b>, assigned to{" "}
            <b>{finding.assigned_room}</b>
          </div>
          {finding.is_data_gap ? (
            <div className="vd-tag vd-tag-gap">
              <i className="ti ti-alert-triangle" />
              No room carries this category — data gap, not contention
            </div>
          ) : (
            <div className="vd-tag vd-tag-info">
              Available: {finding.matching_rooms.join(", ")}
            </div>
          )}
        </div>
      );

    case "HC04_qualification":
      return (
        <div className="vd-card">
          <div className="vd-card-title">
            {finding.section} · {finding.subject}
          </div>
          <div className="vd-card-detail">
            Assigned to <b>{finding.assigned_teacher}</b>, who isn't in this
            subject's qualified list
          </div>
          {finding.is_data_gap ? (
            <div className="vd-tag vd-tag-gap">
              <i className="ti ti-alert-triangle" />
              Nobody is listed as qualified for this course — data gap
            </div>
          ) : (
            <div className="vd-tag vd-tag-info">
              Qualified: {finding.qualified_teachers.join(", ")}
            </div>
          )}
        </div>
      );

    case "daily_span":
      return (
        <div className="vd-card">
          <div className="vd-card-title">
            {finding.section} · {finding.day}
          </div>
          <div className="vd-card-detail">
            Span {finding.span_minutes} min — over the 9-hour cap by{" "}
            {finding.over_by_minutes} min
          </div>
          <div className="vd-detail-list">
            {finding.classes.map((c, i) => (
              <div key={i} className="vd-detail-row">
                <span className="vd-detail-time">
                  {c.start}–{c.end}
                </span>
                <span>
                  {c.subject} ({c.schedtype}){c.is_gened ? " · GenEd" : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      );

    case "teacher_overload":
      return (
        <div className="vd-card">
          <div className="vd-card-title">{finding.teacher}</div>
          <div className="vd-card-detail">
            {finding.total_units} units assigned, cap {finding.cap} — over by{" "}
            {finding.over_by}
          </div>
          <div className="vd-detail-list">
            {finding.courses.map((c, i) => (
              <div key={i} className="vd-detail-row">
                <span>
                  {c.subject} · {c.section}
                </span>
                <span className="vd-detail-time">{c.units} units</span>
              </div>
            ))}
          </div>
        </div>
      );

    case "faculty_priority":
      return (
        <div className="vd-card">
          <div className="vd-card-title">
            {finding.section} · {finding.subject}
          </div>
          <div className="vd-card-detail">
            Assigned to <b>{finding.assigned_teacher}</b> (priority{" "}
            {finding.assigned_priority.join(", ")})
          </div>
          <div className="vd-tag vd-tag-info">
            {finding.better_candidate} (priority{" "}
            {finding.better_priority.join(", ")}) was qualified, time-free,
            and had room, but wasn't used
          </div>
        </div>
      );

    case "teacher_unavailable":
      return (
        <div className="vd-card">
          <div className="vd-card-title">
            {finding.section} · {finding.subject}
          </div>
          <div className="vd-card-detail">
            Scheduled {finding.day} {finding.scheduled_start}–
            {finding.scheduled_end}, taught by <b>{finding.teacher}</b>
          </div>
          {finding.recorded_windows_this_day.length > 0 ? (
            <div className="vd-tag vd-tag-gap">
              <i className="ti ti-alert-triangle" />
              Recorded availability for {finding.day}:{" "}
              {finding.recorded_windows_this_day
                .map((w) => `${w.start}–${w.end}`)
                .join(", ")}{" "}
              — this class falls outside it
            </div>
          ) : (
            <div className="vd-tag vd-tag-gap">
              <i className="ti ti-alert-triangle" />
              No recorded availability for {finding.day} at all — only
              available:{" "}
              {finding.available_days.length > 0
                ? finding.available_days.join(", ")
                : "nowhere recorded"}
            </div>
          )}
        </div>
      );

    default:
      return null;
  }
}
