import { useState } from "react";
import { ROOM_TYPES, BUILDINGS } from "../../../../constants";
import "./room_modal.css";

const EMPTY_FORM = {
  room_name: "",
  room_type: "Regular Lecture Room",
  capacity: "",
  building: "SJH",
  floor: "",
  is_active: true,
};

export default function RoomModal({ room, onSave, onDelete, onClose }) {
  const [form, setForm] = useState(() => (room ? { ...room } : EMPTY_FORM));

  function handleChange(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit() {
    if (!form.room_name.trim() || !form.capacity || !form.floor) return;
    onSave(form);
  }

  return (
    <div className="rmod-overlay" onClick={onClose}>
      <div className="rmod-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rmod-header">
          <div className="rmod-title">{room ? "Edit Room" : "Add Room"}</div>
          <button className="rmod-close" onClick={onClose}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        <div className="rmod-body">
          <div className="rmod-field">
            <label>
              Room name <span className="rmod-req">*</span>
            </label>
            <input
              value={form.room_name}
              onChange={(e) => handleChange("room_name", e.target.value)}
              placeholder="e.g. SJH-501"
              className="rmod-input"
            />
          </div>

          <div className="rmod-row2">
            <div className="rmod-field">
              <label>
                Building <span className="rmod-req">*</span>
              </label>
              <select
                value={form.building}
                onChange={(e) => handleChange("building", e.target.value)}
                className="rmod-select"
              >
                {BUILDINGS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div className="rmod-field">
              <label>
                Floor <span className="rmod-req">*</span>
              </label>
              <input
                type="number"
                value={form.floor}
                onChange={(e) => handleChange("floor", +e.target.value)}
                placeholder="e.g. 5"
                min={1}
                className="rmod-input"
              />
            </div>
          </div>

          <div className="rmod-row2">
            <div className="rmod-field">
              <label>Room type</label>
              <select
                value={form.room_type}
                onChange={(e) => handleChange("room_type", e.target.value)}
                className="rmod-select"
              >
                {ROOM_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="rmod-field">
              <label>Capacity</label>
              <input
                type="number"
                value={form.capacity}
                onChange={(e) => handleChange("capacity", +e.target.value)}
                placeholder="e.g. 45"
                min={1}
                className="rmod-input"
              />
            </div>
          </div>

          <div className="rmod-field">
            <label className="rmod-toggle-label">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => handleChange("is_active", e.target.checked)}
                className="rmod-toggle-chk"
              />
              <span>Active room (available for scheduling)</span>
            </label>
          </div>
        </div>

        <div className="rmod-footer">
          {onDelete && (
            <button
              type="button"
              className="rmod-delete-btn"
              onClick={onDelete}
            >
              <i className="ti ti-trash" /> Delete
            </button>
          )}
          <div className="rmod-footer-right">
            <button type="button" className="rmod-cancel-btn" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="rmod-save-btn"
              onClick={handleSubmit}
              disabled={!form.room_name.trim() || !form.capacity || !form.floor}
            >
              <i className="ti ti-device-floppy" />
              {room ? "Save changes" : "Add room"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
