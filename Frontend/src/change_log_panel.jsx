import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "./lib/supabaseClient";
import "./change_log_panel.css";

const QUICK_FILTERS = [
  { value: "1hour", label: "Last hour" },
  { value: "24hours", label: "Last 24 hours" },
];

const MORE_FILTERS = [
  { value: "7days", label: "Last 7 days" },
  { value: "4weeks", label: "Last 4 weeks" },
  { value: "all", label: "All time" },
];

function getDateFilter(filter) {
  const now = new Date();
  const map = {
    "1hour": 60 * 60 * 1000,
    "24hours": 24 * 60 * 60 * 1000,
    "7days": 7 * 24 * 60 * 60 * 1000,
    "4weeks": 28 * 24 * 60 * 60 * 1000,
  };
  if (filter === "all") return null;
  return new Date(now.getTime() - map[filter]).toISOString();
}

function formatDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getActionIcon(action) {
  if (!action) return "ti-history";
  const a = action.toLowerCase();
  if (a.includes("added")) return "ti-plus";
  if (a.includes("edited")) return "ti-edit";
  if (a.includes("deleted")) return "ti-trash";
  if (a.includes("approved")) return "ti-circle-check";
  if (a.includes("archived")) return "ti-archive";
  if (a.includes("generated")) return "ti-player-play";
  if (a.includes("removed")) return "ti-x";
  return "ti-history";
}

function getActionColor(action) {
  if (!action) return "log-icon-default";
  const a = action.toLowerCase();
  if (a.includes("added")) return "log-icon-add";
  if (a.includes("edited")) return "log-icon-edit";
  if (a.includes("deleted") || a.includes("removed")) return "log-icon-delete";
  if (a.includes("approved")) return "log-icon-approve";
  if (a.includes("archived")) return "log-icon-archive";
  return "log-icon-default";
}

export default function ChangeLogPanel({ open, onClose }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("1hour");
  const [search, setSearch] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (moreRef.current && !moreRef.current.contains(e.target))
        setMoreOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function fetchLogs() {
      setLoading(true);
      try {
        let query = supabase
          .from("change_log")
          .select("*")
          .order("created_at", { ascending: false });
        const since = getDateFilter(filter);
        if (since) query = query.gte("created_at", since);
        const { data, error } = await query;
        if (error) throw error;
        if (!cancelled) setLogs(data || []);
      } catch (error) {
        console.error("Failed to fetch logs:", error);
        if (!cancelled) setLogs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchLogs();
    return () => {
      cancelled = true;
    };
  }, [open, filter]);

  const filteredLogs = logs.filter((log) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      log.action?.toLowerCase().includes(s) ||
      log.entity?.toLowerCase().includes(s) ||
      log.details?.toLowerCase().includes(s) ||
      log.performed_by?.toLowerCase().includes(s)
    );
  });

  function handleExport() {
    if (filteredLogs.length === 0) return;
    const rows = filteredLogs.map((log) => ({
      "Date & Time": formatDate(log.created_at),
      Action: log.action || "",
      Entity: log.entity || "",
      Details: log.details || "",
      "Performed By": log.performed_by || "",
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [
      { wch: 22 },
      { wch: 24 },
      { wch: 28 },
      { wch: 40 },
      { wch: 16 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, "Change Log");
    const date = new Date().toLocaleDateString("en-PH").replace(/\//g, "-");
    XLSX.writeFile(wb, `OrangeTail_Change_Log_${date}.xlsx`);
  }

  const activeMoreFilter = MORE_FILTERS.find((f) => f.value === filter);

  if (!open) return null;

  return (
    <>
      <div className="log-backdrop" onClick={onClose} />
      <aside className="log-panel">
        <div className="log-header">
          <div className="log-header-left">
            <i className="ti ti-history log-header-icon" aria-hidden="true" />
            <span className="log-header-title">Change Log</span>
          </div>
          <div className="log-header-actions">
            <button
              type="button"
              className="log-export-btn"
              onClick={handleExport}
              disabled={filteredLogs.length === 0}
              title="Export to Excel"
            >
              <i className="ti ti-file-spreadsheet" /> Export
            </button>
            <button
              type="button"
              className="log-close-btn"
              onClick={onClose}
              aria-label="Close change log"
            >
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="log-controls">
          <div className="log-search-wrap">
            <i className="ti ti-search" aria-hidden="true" />
            <input
              className="log-search-input"
              placeholder="Search logs…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="log-filter-row">
            {QUICK_FILTERS.map((f) => (
              <button
                type="button"
                key={f.value}
                className={`log-filter-tab ${filter === f.value ? "log-filter-tab-active" : ""}`}
                onClick={() => {
                  setFilter(f.value);
                  setMoreOpen(false);
                }}
              >
                {f.label}
                {filter === f.value && (
                  <i className="ti ti-check log-filter-check" />
                )}
              </button>
            ))}
            <div className="log-more-wrap" ref={moreRef}>
              <button
                type="button"
                className={`log-filter-tab ${activeMoreFilter ? "log-filter-tab-active" : ""}`}
                onClick={() => setMoreOpen((prev) => !prev)}
              >
                {activeMoreFilter ? activeMoreFilter.label : "More"}
                <i
                  className={`ti ${moreOpen ? "ti-chevron-up" : "ti-chevron-down"} log-filter-chevron`}
                />
              </button>
              {moreOpen && (
                <div className="log-more-dropdown">
                  {MORE_FILTERS.map((f) => (
                    <button
                      type="button"
                      key={f.value}
                      className={`log-more-option ${filter === f.value ? "log-more-option-active" : ""}`}
                      onClick={() => {
                        setFilter(f.value);
                        setMoreOpen(false);
                      }}
                    >
                      {f.label}
                      {filter === f.value && <i className="ti ti-check" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="log-body">
          {loading ? (
            <div className="log-loading">
              <i className="ti ti-loader log-spin" aria-hidden="true" />{" "}
              Loading…
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="log-empty">
              <i className="ti ti-history" aria-hidden="true" />
              <p>No logs found.</p>
            </div>
          ) : (
            <div className="log-list">
              {filteredLogs.map((log) => (
                <div key={log.log_id} className="log-item">
                  <div
                    className={`log-item-icon ${getActionColor(log.action)}`}
                  >
                    <i
                      className={`ti ${getActionIcon(log.action)}`}
                      aria-hidden="true"
                    />
                  </div>
                  <div className="log-item-content">
                    <div className="log-item-action">{log.action}</div>
                    <div className="log-item-entity">{log.entity}</div>
                    {log.details && (
                      <div className="log-item-details">{log.details}</div>
                    )}
                    <div className="log-item-meta">
                      {log.performed_by && (
                        <span className="log-item-by">
                          <i className="ti ti-user" /> {log.performed_by}
                        </span>
                      )}
                      <span className="log-item-time">
                        {formatDate(log.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
