# OrangeTail — Automated Scheduling & Professor Loading System

An intelligent, automated class scheduling and faculty loading application designed to streamline academic timetabling, optimize room allocation, and handle complex curriculum requirements. Built specifically for university department operations, OrangeTail replaces manual scheduling with a fast, constraint-guided generation engine.

---

## Key Features

* **Automated Schedule Generation:** Uses a background optimization algorithm to process curriculum block requests, room availability, and faculty constraints.
* **Faculty & Room Allocation:** Intelligently balances professor workloads and assigns suitable rooms based on course types (e.g., major vs. general education courses).
* **Hard & Soft Conflict Detection:** Flags hard violations (overlapping professor/room assignments) and soft warnings (e.g., excessive consecutive hours or 3+ classes on a single day).
* **Interactive Section Management:** Inspect, add, edit, and adjust scheduled courses per section before final approval.
* **Summer Term Support:** Dedicated workflow for manual configuration of summer course offerings.
* **Audit Trail & Logging:** System-wide change logs track actions such as schedule approvals, session creation, and section deletions.

---

## Tech Stack

* **Desktop Framework:** [Tauri](https://tauri.app/) (React / Vite frontend wrapped in Rust)
* **Frontend:** React (JSX), Modern CSS, Tabler Icons
* **Database & Auth:** [Supabase](https://supabase.com/) (PostgreSQL backend for schedules, offerings, sections, and room data)
* **Optimization Backend:** Python (PyInstaller sidecar execution or FastAPI server utilizing `scikit-learn` / custom constraint-solving algorithms)

---

## Project Architecture

```text
├── Frontend/               # Tauri + React application UI
│   ├── src/
│   │   ├── components/     # UI screens (GenerateScreen, Schedules, Modals)
│   │   ├── lib/            # Supabase client integration
│   │   └── ...
│   └── src-tauri/          # Rust configuration & native sidecar binaries
│       └── bin/            # PyInstaller compiled backend executable
│
└── Algorithm/              # Python schedule-generation algorithm
    ├── api.py              # Backend entry point / API service
    └── schedule-backend/   # Source algorithm files
