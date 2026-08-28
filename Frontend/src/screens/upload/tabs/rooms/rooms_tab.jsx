import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../../../../lib/supabaseClient";
import { ROOM_TYPES } from "../../../../constants";
import RoomModal from "./room_modal";
import "./rooms_tab.css";

const DAYS_ORDER = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function getUsername() {
  return JSON.parse(localStorage.getItem("user") || "{}").username || "unknown";
}

function getFloors(roomList) {
  const floors = {};
  roomList.forEach((r) => {
    const floor = r.floor || 1;
    if (!floors[floor]) floors[floor] = [];
    floors[floor].push(r);
  });
  return floors;
}

function groupByDay(schedules) {
  const groups = {};
  (schedules || []).forEach((s) => {
    const day = s.day || "Unknown";
    if (!groups[day]) groups[day] = [];
    groups[day].push(s);
  });
  return groups;
}

function timeToMinutes(t) {
  if (!t) return 0;
  if (t.includes("AM") || t.includes("PM")) {
    const [time, period] = t.split(" ");
    let [h, m] = time.split(":").map(Number);
    if (period === "PM" && h !== 12) h += 12;
    if (period === "AM" && h === 12) h = 0;
    return h * 60 + m;
  }
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function flattenSchedule(row) {
  return {
    schedule_id: row.schedule_id,
    room_id: row.room_id,
    status: row.status,
    day: row.time_slots?.day,
    start_time: row.time_slots?.start_time,
    end_time: row.time_slots?.end_time,
    course_code: row.class_offerings?.courses?.course_code,
    course_name: row.class_offerings?.courses?.course_name,
    section_name: row.class_offerings?.section?.section_name,
    professor_name: row.professor
      ? `${row.professor.first_name} ${row.professor.last_name}`
      : null,
    school_year: row.class_offerings?.school_year,
    semester: row.class_offerings?.semester,
  };
}

function BuildingMap({
  title,
  roomList,
  onRoomClick,
  selectedRoomIds,
  onToggleSelect,
  onToggleSelectBuilding,
}) {
  const floors = getFloors(roomList);
  const allSelected =
    roomList.length > 0 &&
    roomList.every((r) => selectedRoomIds.includes(r.room_id));
  const someSelected = roomList.some((r) =>
    selectedRoomIds.includes(r.room_id),
  );
  return (
    <div className="room-building">
      <div className="room-building-title">
        <input
          type="checkbox"
          className="room-building-chk"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = someSelected && !allSelected;
          }}
          onChange={() => onToggleSelectBuilding(roomList)}
        />
        <i className="ti ti-building" /> {title} Building
      </div>
      {Object.keys(floors).length === 0 ? (
        <div className="room-building-empty">No rooms in this building.</div>
      ) : (
        Object.keys(floors)
          .sort((a, b) => +a - +b)
          .map((floor) => (
            <div key={floor} className="room-floor">
              <div className="room-floor-label">Floor {floor}</div>
              <div className="room-map-grid">
                {floors[floor].map((room) => {
                  const isSelected = selectedRoomIds.includes(room.room_id);
                  const cellClass = room.is_active
                    ? "room-cell-available"
                    : "room-cell-inactive";
                  return (
                    <div
                      key={room.room_id}
                      className={`room-cell ${cellClass} ${isSelected ? "room-cell-selected" : ""}`}
                      title={room.room_name}
                      onClick={() => onRoomClick(room)}
                    >
                      <input
                        type="checkbox"
                        className="room-cell-chk"
                        checked={isSelected}
                        onChange={(e) => onToggleSelect(e, room.room_id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="room-cell-name">{room.room_name}</div>
                      <div className="room-cell-type">
                        {room.room_type
                          ?.replace("Regular ", "")
                          .replace(" Laboratory", " Lab")
                          .replace(" Room", "")}
                      </div>
                      <div className="room-cell-cap">Cap {room.capacity}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
      )}
    </div>
  );
}

export default function RoomsTab() {
  const [rooms, setRooms] = useState([]);
  const [allSchedules, setAllSchedules] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [selectedRoomIds, setSelectedRoomIds] = useState([]);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [filterType, setFilterType] = useState("");
  const [filterBuilding, setFilterBuilding] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");
  const [viewingRoom, setViewingRoom] = useState(null);
  const [viewingRoomSchedules, setViewingRoomSchedules] = useState([]);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [uploadMsg, setUploadMsg] = useState("");
  const [toast, setToast] = useState("");
  const fileInputRef = useRef(null);

  useEffect(() => {
    async function loadAll() {
      await Promise.all([fetchRooms(), fetchSchedules()]);
    }
    loadAll();
  }, []);

  async function fetchRooms() {
    const { data, error } = await supabase
      .from("rooms")
      .select("*")
      .order("room_name");
    if (error) {
      console.error(error);
      return;
    }
    setRooms(data || []);
  }

  async function fetchSchedules() {
    const { data, error } = await supabase.from("schedules").select(`
      schedule_id, room_id, status,
      time_slots ( day, start_time, end_time ),
      professor ( first_name, last_name ),
      class_offerings (
        school_year, semester,
        courses ( course_code, course_name ),
        section ( section_name )
      )
    `);
    if (error) {
      console.error(error);
      return;
    }
    setAllSchedules((data || []).map(flattenSchedule));
  }

  const buildings = [
    ...new Set(rooms.map((r) => r.building).filter(Boolean)),
  ].sort();

  const normalizeRow = (r) => {
    const out = {};
    Object.entries(r).forEach(([k, v]) => {
      out[k.toLowerCase().replace(/[\s-]+/g, "_")] = v;
    });
    return out;
  };

  const filtered = rooms.filter((r) => {
    const matchType = !filterType || r.room_type === filterType;
    const matchBuilding = !filterBuilding || r.building === filterBuilding;
    const matchStatus =
      !filterStatus || (filterStatus === "active" ? r.is_active : !r.is_active);
    const matchSearch =
      !search || r.room_name.toLowerCase().includes(search.toLowerCase());
    return matchType && matchBuilding && matchStatus && matchSearch;
  });

  const sjhRooms = filtered.filter((r) => r.building === "SJH");
  const mgnRooms = filtered.filter((r) => r.building === "MGN");
  const pgnRooms = filtered.filter((r) => r.building === "PGN");
  const apsRooms = filtered.filter((r) => r.building === "APS");
  const otherRooms = filtered.filter(
    (r) => !["SJH", "MGN", "PGN", "APS"].includes(r.building),
  );

  async function handleRoomClick(room) {
    setViewingRoom(room);
    setViewingRoomSchedules(
      allSchedules.filter((s) => s.room_id === room.room_id),
    );
  }

  async function handleEditRoomClick(room) {
    const { data } = await supabase
      .from("schedules")
      .select("schedule_id")
      .eq("room_id", room.room_id)
      .eq("status", "Approved")
      .limit(1);
    if (data && data.length > 0) {
      setToast(
        `${room.room_name} has approved schedules and cannot be edited.`,
      );
      setTimeout(() => setToast(""), 4000);
      return;
    }
    setViewingRoom(null);
    setEditingRoom(room);
    setModalOpen(true);
  }

  async function handleSave(formData) {
    if (editingRoom) {
      const { data, error } = await supabase
        .from("rooms")
        .update(formData)
        .eq("room_id", editingRoom.room_id)
        .select()
        .single();
      if (error) {
        console.error(error);
        return;
      }
      setRooms((prev) =>
        prev.map((r) => (r.room_id === editingRoom.room_id ? data : r)),
      );
      await supabase.from("change_log").insert({
        action: "Edited room",
        entity: formData.room_name,
        details: `${formData.room_type} · Cap ${formData.capacity}`,
        performed_by: getUsername(),
      });
    } else {
      const { data, error } = await supabase
        .from("rooms")
        .insert(formData)
        .select()
        .single();
      if (error) {
        console.error(error);
        return;
      }
      setRooms((prev) => [...prev, data]);
      await supabase.from("change_log").insert({
        action: "Added room",
        entity: formData.room_name,
        details: `${formData.room_type} · Cap ${formData.capacity}`,
        performed_by: getUsername(),
      });
    }
    setModalOpen(false);
    setEditingRoom(null);
  }

  async function confirmDelete() {
    const { data: scheds } = await supabase
      .from("schedules")
      .select("schedule_id")
      .eq("room_id", deleteConfirm.room_id)
      .limit(1);
    if (scheds && scheds.length > 0) {
      setToast(
        `${deleteConfirm.room_name} has schedules and cannot be deleted.`,
      );
      setTimeout(() => setToast(""), 4000);
      setDeleteConfirm(null);
      return;
    }
    const { error } = await supabase
      .from("rooms")
      .delete()
      .eq("room_id", deleteConfirm.room_id);
    if (error) {
      console.error(error);
      return;
    }
    await supabase.from("change_log").insert({
      action: "Deleted room",
      entity: deleteConfirm.room_name,
      details: "",
      performed_by: getUsername(),
    });
    setRooms((prev) => prev.filter((r) => r.room_id !== deleteConfirm.room_id));
    setDeleteConfirm(null);
  }

  async function confirmBulkDelete() {
    const { data: scheds } = await supabase
      .from("schedules")
      .select("room_id")
      .in("room_id", selectedRoomIds);
    const roomsWithScheds = new Set((scheds || []).map((s) => s.room_id));
    const deletable = selectedRoomIds.filter((id) => !roomsWithScheds.has(id));
    const blocked = selectedRoomIds.filter((id) => roomsWithScheds.has(id));
    if (deletable.length > 0) {
      const { error } = await supabase
        .from("rooms")
        .delete()
        .in("room_id", deletable);
      if (error) {
        console.error(error);
        return;
      }
      await supabase.from("change_log").insert({
        action: "Deleted rooms",
        entity: `${deletable.length} rooms`,
        details: "Bulk delete",
        performed_by: getUsername(),
      });
      setRooms((prev) => prev.filter((r) => !deletable.includes(r.room_id)));
      setSelectedRoomIds((prev) =>
        prev.filter((id) => !deletable.includes(id)),
      );
    }
    setBulkDeleteConfirm(false);
    if (blocked.length > 0) {
      setToast(
        `${blocked.length} room${blocked.length !== 1 ? "s" : ""} could not be deleted — they have existing schedules.`,
      );
      setTimeout(() => setToast(""), 5000);
    }
  }

  function toggleRoomSelect(e, roomId) {
    e.stopPropagation();
    setSelectedRoomIds((prev) =>
      prev.includes(roomId)
        ? prev.filter((id) => id !== roomId)
        : [...prev, roomId],
    );
  }

  function toggleSelectBuilding(buildingRooms) {
    const ids = buildingRooms.map((r) => r.room_id);
    const allSelected = ids.every((id) => selectedRoomIds.includes(id));
    if (allSelected) {
      setSelectedRoomIds((prev) => prev.filter((id) => !ids.includes(id)));
    } else {
      setSelectedRoomIds((prev) => [...new Set([...prev, ...ids])]);
    }
  }

  async function handleFileImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploadStatus("uploading");
    setUploadMsg("");
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws);
      if (rows.length === 0) {
        setUploadMsg("File is empty.");
        setUploadStatus("error");
        setTimeout(() => setUploadStatus(null), 4000);
        return;
      }
      const toInsert = rows
        .filter((row) => {
          const n = normalizeRow(row);
          return (
            String(n.status || "Active")
              .trim()
              .toLowerCase() === "active"
          );
        })
        .map((row) => {
          const n = normalizeRow(row);
          const roomName = String(n.room || n.room_name || "").trim();
          const building = String(n.building_code || n.building || "").trim();
          const floorMatch = roomName.match(/-(\d)/);
          const floor = floorMatch
            ? Number(floorMatch[1])
            : Number(n.floor || 1);
          return {
            room_name: roomName,
            room_type: String(n.room_type || "Regular Lecture Room").trim(),
            capacity: Number(n.capacity || 0),
            building,
            floor,
            is_active: true,
          };
        })
        .filter((r) => r.room_name && r.building);
      if (toInsert.length === 0) {
        setUploadMsg(
          "No valid rows found. Need: room, building_code, status, room_type, capacity.",
        );
        setUploadStatus("error");
        setTimeout(() => setUploadStatus(null), 5000);
        return;
      }
      const { error } = await supabase.from("rooms").insert(toInsert);
      if (error) throw error;
      await fetchRooms();
      await supabase.from("change_log").insert({
        action: "Uploaded rooms",
        entity: `${toInsert.length} room(s)`,
        details: "Excel import",
        performed_by: getUsername(),
      });
      setUploadMsg(
        `${toInsert.length} room${toInsert.length !== 1 ? "s" : ""} imported.`,
      );
      setUploadStatus("success");
      setTimeout(() => setUploadStatus(null), 4000);
    } catch (err) {
      console.error(err);
      setUploadMsg(err.message || "Upload failed.");
      setUploadStatus("error");
      setTimeout(() => setUploadStatus(null), 4000);
    }
  }

  const dayGroups = groupByDay(viewingRoomSchedules);

  return (
    <div className="rooms-wrapper">
      {toast && (
        <div className="rooms-toast">
          <i className="ti ti-alert-circle" /> {toast}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: "none" }}
        onChange={handleFileImport}
      />
      <div
        className="rooms-upload-zone"
        onClick={() => fileInputRef.current?.click()}
      >
        {uploadStatus === "uploading" ? (
          <>
            <i className="ti ti-loader rooms-spin" />
            <span>Uploading...</span>
          </>
        ) : uploadStatus === "success" ? (
          <>
            <i
              className="ti ti-circle-check"
              style={{ color: "var(--green)" }}
            />
            <span style={{ color: "var(--green)" }}>
              {uploadMsg || "Uploaded successfully"}
            </span>
          </>
        ) : uploadStatus === "error" ? (
          <>
            <i className="ti ti-alert-circle" style={{ color: "var(--red)" }} />
            <span style={{ color: "var(--red)" }}>
              {uploadMsg || "Upload failed"}
            </span>
          </>
        ) : (
          <>
            <i className="ti ti-file-upload" />
            <span>Upload Excel (.xlsx) to import rooms</span>
          </>
        )}
      </div>

      <div className="rooms-controls">
        <div className="rooms-filters">
          <div className="rooms-search-wrap">
            <i className="ti ti-search" />
            <input
              className="rooms-search-input"
              placeholder="Search rooms..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="rooms-filter-sel"
            value={filterBuilding}
            onChange={(e) => setFilterBuilding(e.target.value)}
          >
            <option value="">All buildings</option>
            {buildings.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <select
            className="rooms-filter-sel"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="">All types</option>
            {ROOM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            className="rooms-filter-sel"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="rooms-controls-right">
          {selectedRoomIds.length > 0 && (
            <button
              className="rooms-bulk-delete-btn"
              style={{ marginRight: 8 }}
              onClick={() => setBulkDeleteConfirm(true)}
            >
              <i className="ti ti-trash" /> Delete ({selectedRoomIds.length})
            </button>
          )}
          <button
            className="rooms-add-btn"
            onClick={() => {
              setEditingRoom(null);
              setModalOpen(true);
            }}
          >
            <i className="ti ti-plus" /> Add room
          </button>
        </div>
      </div>

      <div className="rooms-session-bar">
        <div className="rooms-legend">
          <div className="rooms-legend-item">
            <div className="rooms-legend-dot rooms-legend-available" />
            Active
          </div>
          <div className="rooms-legend-item">
            <div className="rooms-legend-dot rooms-legend-inactive" />
            Inactive
          </div>
        </div>
      </div>

      {rooms.length === 0 ? (
        <div className="rooms-empty">
          <i className="ti ti-building" />
          <p>No rooms yet. Add one manually or upload an Excel file.</p>
        </div>
      ) : (
        <div className="room-map-container">
          {sjhRooms.length > 0 && (
            <BuildingMap
              title="SJH"
              roomList={sjhRooms}
              onRoomClick={handleRoomClick}
              selectedRoomIds={selectedRoomIds}
              onToggleSelect={toggleRoomSelect}
              onToggleSelectBuilding={toggleSelectBuilding}
            />
          )}
          {mgnRooms.length > 0 && (
            <BuildingMap
              title="MGN"
              roomList={mgnRooms}
              onRoomClick={handleRoomClick}
              selectedRoomIds={selectedRoomIds}
              onToggleSelect={toggleRoomSelect}
              onToggleSelectBuilding={toggleSelectBuilding}
            />
          )}
          {pgnRooms.length > 0 && (
            <BuildingMap
              title="PGN"
              roomList={pgnRooms}
              onRoomClick={handleRoomClick}
              selectedRoomIds={selectedRoomIds}
              onToggleSelect={toggleRoomSelect}
              onToggleSelectBuilding={toggleSelectBuilding}
            />
          )}
          {apsRooms.length > 0 && (
            <BuildingMap
              title="APS"
              roomList={apsRooms}
              onRoomClick={handleRoomClick}
              selectedRoomIds={selectedRoomIds}
              onToggleSelect={toggleRoomSelect}
              onToggleSelectBuilding={toggleSelectBuilding}
            />
          )}
          {otherRooms.length > 0 && (
            <BuildingMap
              title="Other"
              roomList={otherRooms}
              onRoomClick={handleRoomClick}
              selectedRoomIds={selectedRoomIds}
              onToggleSelect={toggleRoomSelect}
              onToggleSelectBuilding={toggleSelectBuilding}
            />
          )}
        </div>
      )}

      {viewingRoom && (
        <div
          className="rooms-modal-overlay"
          onClick={() => setViewingRoom(null)}
        >
          <div
            className="rooms-schedule-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rooms-schedule-modal-header">
              <div>
                <div className="rooms-schedule-modal-title">
                  {viewingRoom.room_name}
                </div>
                <div className="rooms-schedule-modal-sub">
                  {viewingRoom.room_type} · Cap {viewingRoom.capacity} ·{" "}
                  {viewingRoom.is_active ? "Active" : "Inactive"}
                </div>
              </div>
              <div className="rooms-schedule-modal-actions">
                <button
                  className="rooms-schedule-edit-btn"
                  onClick={() => handleEditRoomClick(viewingRoom)}
                >
                  <i className="ti ti-edit" /> Edit room
                </button>
                <button
                  className="rooms-schedule-delete-btn"
                  onClick={async () => {
                    const { data } = await supabase
                      .from("schedules")
                      .select("schedule_id")
                      .eq("room_id", viewingRoom.room_id)
                      .limit(1);
                    if (data && data.length > 0) {
                      setToast(
                        `${viewingRoom.room_name} has schedules and cannot be deleted.`,
                      );
                      setTimeout(() => setToast(""), 4000);
                      return;
                    }
                    setViewingRoom(null);
                    setDeleteConfirm(viewingRoom);
                  }}
                >
                  <i className="ti ti-trash" /> Delete
                </button>
                <button
                  className="rooms-modal-close"
                  onClick={() => setViewingRoom(null)}
                >
                  <i className="ti ti-x" />
                </button>
              </div>
            </div>
            <div className="rooms-schedule-modal-body">
              {viewingRoomSchedules.length === 0 ? (
                <div className="rooms-schedule-empty">
                  <i className="ti ti-calendar-off" />
                  <p>No classes scheduled in this room.</p>
                </div>
              ) : (
                <div className="rooms-schedule-days">
                  {DAYS_ORDER.filter((day) => dayGroups[day]).map((day) => (
                    <div key={day} className="rooms-schedule-day">
                      <div className="rooms-schedule-day-label">{day}</div>
                      <div className="rooms-schedule-day-entries">
                        {dayGroups[day]
                          .sort(
                            (a, b) =>
                              timeToMinutes(a.start_time) -
                              timeToMinutes(b.start_time),
                          )
                          .map((sched) => (
                            <div
                              key={sched.schedule_id}
                              className="rooms-schedule-entry"
                            >
                              <div className="rooms-entry-time">
                                {sched.start_time} – {sched.end_time}
                              </div>
                              <div className="rooms-entry-info">
                                <div className="rooms-entry-course">
                                  <span className="rooms-entry-code">
                                    {sched.course_code}
                                  </span>
                                  <span className="rooms-entry-name">
                                    {sched.course_name}
                                  </span>
                                </div>
                                <div className="rooms-entry-meta">
                                  <span>
                                    <i className="ti ti-users" />
                                    {sched.section_name}
                                  </span>
                                  <span>
                                    <i className="ti ti-user" />
                                    {sched.professor_name || "Unassigned"}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <RoomModal
          room={editingRoom}
          onSave={handleSave}
          onDelete={
            editingRoom
              ? () => {
                  setModalOpen(false);
                  setEditingRoom(null);
                  setDeleteConfirm(editingRoom);
                }
              : null
          }
          onClose={() => {
            setModalOpen(false);
            setEditingRoom(null);
          }}
        />
      )}

      {deleteConfirm && (
        <div
          className="rooms-confirm-overlay"
          onClick={() => setDeleteConfirm(null)}
        >
          <div
            className="rooms-confirm-box"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rooms-confirm-icon">
              <i className="ti ti-alert-triangle" />
            </div>
            <div className="rooms-confirm-title">Delete room?</div>
            <p className="rooms-confirm-msg">
              <strong>{deleteConfirm.room_name}</strong> will be permanently
              removed.
            </p>
            <div className="rooms-confirm-btns">
              <button
                className="rooms-cancel-btn"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button className="rooms-confirm-del-btn" onClick={confirmDelete}>
                <i className="ti ti-trash" /> Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkDeleteConfirm && (
        <div
          className="rooms-confirm-overlay"
          onClick={() => setBulkDeleteConfirm(false)}
        >
          <div
            className="rooms-confirm-box"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rooms-confirm-icon">
              <i className="ti ti-alert-triangle" />
            </div>
            <div className="rooms-confirm-title">
              Delete {selectedRoomIds.length} room
              {selectedRoomIds.length !== 1 ? "s" : ""}?
            </div>
            <p className="rooms-confirm-msg">
              <strong>
                {selectedRoomIds.length} room
                {selectedRoomIds.length !== 1 ? "s" : ""}
              </strong>{" "}
              will be permanently removed.
            </p>
            <div className="rooms-confirm-btns">
              <button
                className="rooms-cancel-btn"
                onClick={() => setBulkDeleteConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="rooms-confirm-del-btn"
                onClick={confirmBulkDelete}
              >
                <i className="ti ti-trash" /> Delete all
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
