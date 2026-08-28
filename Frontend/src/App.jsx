import { useState, useEffect, useRef } from "react";
import { Command } from "@tauri-apps/plugin-shell";
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

  // Ref to prevent double-spawning during React 18 Strict Mode double-mounts
  const sidecarSpawned = useRef(false);

  // 1. Spawn Python FastAPI Sidecar on Mount
  useEffect(() => {
    if (sidecarSpawned.current) return;
    sidecarSpawned.current = true;

    async function startBackend() {
      try {
        console.log("[Tauri]: Spawning Python backend sidecar...");
        const command = Command.sidecar("bin/schedule-backend");

        command.stdout.on("data", (line) => {
          console.log(`[Backend STDOUT]: ${line}`);
        });

        command.stderr.on("data", (line) => {
          console.error(`[Backend STDERR]: ${line}`);
        });

        command.on("error", (error) => {
          console.error("[Backend Process Error]:", error);
        });

        command.on("close", (data) => {
          console.warn(`[Backend Exited]: Code ${data.code}, Signal ${data.signal}`);
        });

        const child = await command.spawn();
        console.log(`[Tauri]: Python backend running under PID: ${child.pid}`);
      } catch (error) {
        console.error("[Tauri]: Failed to launch sidecar executable:", error);
      }
    }

    startBackend();
  }, []);

  // 2. Restore User Session & Screen
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