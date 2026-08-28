import { SEMESTERS, YEAR_LEVELS } from "./generate_utils";
import "./generate_dialog.css";

export default function GenerateDialog({
  open,
  onClose,
  schoolYearStart,
  setSchoolYearStart,
  schoolYearEnd,
  setSchoolYearEnd,
  semester,
  setSemester,
  curricula,
  curriculumSelections,
  onToggleCurriculum,
  onToggleYearLevel,
  onStepSections,
  getCurriculumLabel,
  isDialogValid,
  onGenerate,
  onCreateSummer,
}) {
  if (!open) return null;

  return (
    <div className="gd-overlay" onClick={onClose}>
      <div className="gd-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="gd-header">
          <h2>Generate Schedule</h2>
          <button className="gd-close" onClick={onClose}>
            <i className="ti ti-x" />
          </button>
        </div>

        <div className="gd-body">
          {/* School year & semester */}
          <div className="gd-section">
            <div className="gd-section-label">School year & semester</div>
            <div className="gd-year-row">
              <div className="gd-field">
                <label>Start year</label>
                <input
                  type="number"
                  value={schoolYearStart}
                  className="gd-year-input"
                  min={2000}
                  placeholder="2025"
                  onChange={(e) => {
                    const val = +e.target.value;
                    setSchoolYearStart(val);
                    if (schoolYearEnd <= val) setSchoolYearEnd(val + 1);
                  }}
                />
              </div>
              <span className="gd-dash">—</span>
              <div className="gd-field">
                <label>End year</label>
                <input
                  type="number"
                  value={schoolYearEnd}
                  className="gd-year-input"
                  min={schoolYearStart + 1}
                  placeholder="2026"
                  onChange={(e) => setSchoolYearEnd(+e.target.value)}
                />
              </div>
            </div>
            <div className="gd-field" style={{ marginTop: 12 }}>
              <label>Semester</label>
              <div className="gd-sem-btns">
                {SEMESTERS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    className={`gd-sem-btn ${semester === s.value ? "gd-sem-btn-active" : ""}`}
                    onClick={() => setSemester(s.value)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {semester === 3 && (
                <div className="gd-summer-note">
                  <i className="ti ti-info-circle" />
                  Summer schedules are added manually.
                  <button className="gd-summer-btn" onClick={onCreateSummer}>
                    <i className="ti ti-plus" /> Create Schedule
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Curricula */}
          {semester !== 3 && (
            <div className="gd-section">
              <div className="gd-section-label">Curricula & year levels</div>
              {curricula.length === 0 ? (
                <div className="gd-no-curr">
                  <i className="ti ti-info-circle" />
                  No active curricula found. Add curricula in Upload Data first.
                </div>
              ) : (
                <div className="gd-curr-list">
                  {curricula.map((c) => {
                    const sel = curriculumSelections[c.curriculum_id];
                    if (!sel) return null;
                    return (
                      <div
                        key={c.curriculum_id}
                        className={`gd-curr-row ${sel.checked ? "gd-curr-row-active" : ""}`}
                      >
                        <label className="gd-curr-label">
                          <input
                            type="checkbox"
                            checked={sel.checked}
                            onChange={() => onToggleCurriculum(c.curriculum_id)}
                            className="gd-chk"
                          />
                          <span className="gd-curr-name">
                            {getCurriculumLabel(c)}
                          </span>
                        </label>
                        {sel.checked && (
                          <div className="gd-yl-grid">
                            {YEAR_LEVELS.map((yl) => {
                              const ylSel = sel.yearLevels[yl.value];
                              return (
                                <div
                                  key={yl.value}
                                  className={`gd-yl-box ${ylSel.checked ? "gd-yl-box-active" : ""}`}
                                >
                                  <label className="gd-yl-label">
                                    <input
                                      type="checkbox"
                                      checked={ylSel.checked}
                                      onChange={() =>
                                        onToggleYearLevel(
                                          c.curriculum_id,
                                          yl.value,
                                        )
                                      }
                                      className="gd-chk"
                                    />
                                    <span>{yl.label}</span>
                                  </label>
                                  {ylSel.checked && (
                                    <div className="gd-stepper">
                                      <button
                                        type="button"
                                        className="gd-step-btn"
                                        onClick={() =>
                                          onStepSections(
                                            c.curriculum_id,
                                            yl.value,
                                            -1,
                                          )
                                        }
                                        disabled={ylSel.sections <= 1}
                                      >
                                        <i className="ti ti-minus" />
                                      </button>
                                      <span className="gd-step-val">
                                        {ylSel.sections}
                                      </span>
                                      <button
                                        type="button"
                                        className="gd-step-btn"
                                        onClick={() =>
                                          onStepSections(
                                            c.curriculum_id,
                                            yl.value,
                                            1,
                                          )
                                        }
                                        disabled={false}
                                      >
                                        <i className="ti ti-plus" />
                                      </button>
                                      <span className="gd-step-label">sec</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="gd-footer">
          <button className="gd-cancel-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="gd-generate-btn"
            onClick={onGenerate}
            disabled={!isDialogValid()}
          >
            <i className="ti ti-player-play" /> Generate
          </button>
        </div>
      </div>
    </div>
  );
}
