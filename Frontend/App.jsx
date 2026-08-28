import { useState, useEffect } from "react";
import { Command } from "@tauri-apps/plugin-shell";
import LoginScreen from "./screens/login/login_screen";
import DashboardScreen from "./screens/dashboard/dashboard_screen";
import UploadScreen from "./screens/upload/upload_screen";
import GenerateScreen from "./screens/generate/generate_screen";
import ViewSchedulesScreen from "./screens/view_schedules/view_schedules_screen";
import ChangeLogPanel from "./change_log_panel";
import "./App.css";

export default function App() {
  // Spawn the Python FastAPI backend sidecar on initial component mount
  useEffect(() => {
    async function startBackend() {
      try {
        const command = Command.sidecar("bin/schedule-backend");
        
        command.stdout.on("data", (line) => {
          console.log(`[Backend]: ${line}`);
        });

        command.stderr.on("data", (line) => {
          console.error(`[Backend Error]: ${line}`);
        });

        const child = await command.spawn();
        console.log(`Python Backend sidecar started on PID: ${child.pid}`);
      } catch (error) {
        console.error("Failed to launch Python sidecar process:", error);
      }
    }

    startBackend();
  }, []);

  const [currentScreen, setCurrentScreen] = useState(() => {
    const user = localStorage.getItem("user");

    if (!user) {
      return "login";
    }

    return localStorage.getItem("currentScreen") || "dashboard";
  });

  const [viewSchedulesSessionId, setViewSchedulesSessionId] = useState(null);
  const [logOpen, setLogOpen] = useState(false);

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