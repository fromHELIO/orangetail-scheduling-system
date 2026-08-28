import { useState } from "react";
import ProfessorsTab from "./tabs/professors/professors_tab";
import RoomsTab from "./tabs/rooms/rooms_tab";
import CurriculumsTab from "./tabs/curriculums/curriculums_tab";
import "./upload_screen.css";

const TABS = [
  { id: "professors", label: "Professors", icon: "ti-users" },
  { id: "rooms", label: "Rooms", icon: "ti-building" },
  { id: "curriculums", label: "Curriculums", icon: "ti-book" },
];

export default function UploadScreen({ onBack }) {
  const [activeTab, setActiveTab] = useState(() => {
    return localStorage.getItem("uploadActiveTab") || "professors";
  });

  function handleTabChange(tab) {
    setActiveTab(tab);
    localStorage.setItem("uploadActiveTab", tab);
  }

  return (
    <div className="upload-wrapper">
      {/* Topbar */}
      <header className="upload-topbar">
        <div className="upload-brand">
          OrangeTail <span>Scheduling System</span>
        </div>
      </header>

      {/* Inner bar */}
      <div className="upload-inner-bar">
        <button className="upload-back-btn" onClick={onBack}>
          <i className="ti ti-chevron-left" aria-hidden="true" />
          Menu
        </button>
        <span className="upload-sep">/</span>
        <span className="upload-screen-title">Upload Data</span>
      </div>

      {/* Content */}
      <div className="upload-content">
        {/* Tabs */}
        <div className="upload-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`upload-tab ${
                activeTab === tab.id ? "upload-tab-active" : ""
              }`}
              onClick={() => handleTabChange(tab.id)}
            >
              <i className={`ti ${tab.icon}`} aria-hidden="true" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="upload-tab-content">
          {activeTab === "professors" && <ProfessorsTab />}
          {activeTab === "rooms" && <RoomsTab />}
          {activeTab === "curriculums" && <CurriculumsTab />}
        </div>
      </div>
    </div>
  );
}
