import { useState, useEffect } from "react";
import LoginScreen from "./screens/login/login_screen";
import DashboardScreen from "./screens/dashboard/dashboard_screen";
import UploadScreen from "./screens/upload/upload_screen";
import GenerateScreen from "./screens/generate/generate_screen";
import ViewSchedulesScreen from "./screens/view_schedules/view_schedules_screen";
import ChangeLogPanel from "./change_log_panel";
import "./App.css";

export default function App() {
  const [currentScreen, setCurrentScreen] = useState(null); // null = loading
  const [viewSchedulesSessionId, setViewSchedulesSessionId] = useState(null);
  const [logOpen, setLogOpen] = useState(false);

  useEffect(() => {
    const user = localStorage.getItem("user");
    if (!user) {
      setCurrentScreen("login");
      return;
    }
    const saved = localStorage.getItem("currentScreen");
    setCurrentScreen(saved || "dashboard");
  }, []);

  function handleLoginSuccess() {
    navigate("dashboard");
  }

  function handleLogout() {
    localStorage.removeItem("user");
    localStorage.removeItem("currentScreen");
    setCurrentScreen("login");
    setLogOpen(false);
  }

  function navigate(screen) {
    localStorage.setItem("currentScreen", screen);
    setCurrentScreen(screen);
  }

  function handleNavigate(screen) {
    navigate(screen);
  }

  function handleViewSchedules(sessionId) {
    setViewSchedulesSessionId(sessionId || null);
    navigate("view");
  }

  // Still loading session
  if (currentScreen === null) return null;

  const isLoggedIn = currentScreen !== "login";

  return (
    <>
      {isLoggedIn && (
        <button
          className="app-log-btn"
          onClick={() => setLogOpen((o) => !o)}
          title="Change log"
          aria-label="Open change log"
        >
          <i className="ti ti-history" aria-hidden="true" />
        </button>
      )}

      <ChangeLogPanel open={logOpen} onClose={() => setLogOpen(false)} />

      {(() => {
        switch (currentScreen) {
          case "login":
            return <LoginScreen onLoginSuccess={handleLoginSuccess} />;

          case "dashboard":
            return (
              <DashboardScreen
                onNavigate={handleNavigate}
                onLogout={handleLogout}
              />
            );

          case "upload":
            return <UploadScreen onBack={() => handleNavigate("dashboard")} />;

          case "generate":
            return (
              <GenerateScreen
                onBack={() => handleNavigate("dashboard")}
                onViewSchedules={handleViewSchedules}
              />
            );

          case "view":
            return (
              <ViewSchedulesScreen
                onBack={() => handleNavigate("dashboard")}
                initialSessionId={viewSchedulesSessionId}
              />
            );

          default:
            return <LoginScreen onLoginSuccess={handleLoginSuccess} />;
        }
      })()}
    </>
  );
}
