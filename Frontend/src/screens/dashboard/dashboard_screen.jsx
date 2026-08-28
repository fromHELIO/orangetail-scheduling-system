import "./dashboard_screen.css";

const MENU_ITEMS = [
  {
    id: "generate",
    icon: "ti-settings",
    title: "Generate schedule",
    description:
      "Select curriculums, set year level and semester, then auto-generate a new schedule.",
  },
  {
    id: "view",
    icon: "ti-calendar",
    title: "View schedules",
    description:
      "Browse generated schedules organized by curriculum, year level, and section.",
  },
  {
    id: "upload",
    icon: "ti-upload",
    title: "Upload data",
    description: "Manage professors, rooms, and curriculums.",
  },
];

export default function DashboardScreen({ onNavigate, onLogout }) {
  const user = JSON.parse(localStorage.getItem("user") || "{}");
  const username = user.username || user.name || "User";

  return (
    <div className="dashboard-wrapper">
      {/* Topbar */}
      <header className="dashboard-topbar">
        <div className="dashboard-brand">
          OrangeTail <span>Scheduling System</span>
        </div>
        <div className="dashboard-topbar-right">
          <span className="dashboard-welcome">Welcome, {username}!</span>
          <button className="dashboard-logout-btn" onClick={onLogout}>
            <i className="ti ti-logout" aria-hidden="true" />
            Log out
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="dashboard-body">
        <h1 className="dashboard-heading">What would you like to do?</h1>
        <p className="dashboard-subheading">Select an option to continue.</p>

        <div className="dashboard-grid">
          {MENU_ITEMS.map((item) => (
            <button
              key={item.id}
              className="dashboard-card"
              onClick={() => onNavigate(item.id)}
            >
              <div className="dashboard-icon-box">
                <i className={`ti ${item.icon}`} aria-hidden="true" />
              </div>
              <h2 className="dashboard-card-title">{item.title}</h2>
              <p className="dashboard-card-desc">{item.description}</p>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
