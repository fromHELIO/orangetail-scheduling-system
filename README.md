# OrangeTail — Automated Scheduling & Professor Loading System

An intelligent, automated class scheduling and faculty loading application designed to streamline academic timetabling, optimize room allocation, and handle complex curriculum requirements. Built specifically for university department operations, OrangeTail replaces manual scheduling with a fast, constraint-guided generation engine.

---

## Table of Contents

- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [System Architecture](#system-architecture)
- [Project Structure](#project-structure)
- [Quick Start with Docker](#quick-start-with-docker)
- [Building from Source with Docker](#building-from-source-with-docker)
- [Local Development (without Docker)](#local-development-without-docker)
- [Environment Variables](#environment-variables)
- [API Endpoints](#api-endpoints)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Key Features

* **Automated Schedule Generation:** Uses a memetic optimization algorithm to process curriculum block requests, room availability, and faculty constraints.
* **ML-Assisted Faculty Matching:** A trained scikit-learn model scores professor–course compatibility based on historical schedules.
* **Faculty & Room Allocation:** Balances professor workloads and assigns suitable rooms based on course type (e.g., major vs. general education, lecture vs. laboratory).
* **Hard & Soft Conflict Detection:** Flags hard violations (overlapping professor/room assignments) and soft warnings (e.g., excessive consecutive hours or 3+ classes on a single day).
* **Interactive Section Management:** Inspect, add, edit, and adjust scheduled courses per section before final approval.
* **Summer Term Support:** Dedicated workflow for manual configuration of summer course offerings.
* **Audit Trail & Logging:** System-wide change logs track actions such as schedule approvals, session creation, and section deletions.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Desktop Framework** | [Tauri](https://tauri.app/) (React / Vite frontend wrapped in Rust) |
| **Frontend** | React (JSX), Vite, Modern CSS, Tabler Icons |
| **Database & Auth** | [Supabase](https://supabase.com/) (PostgreSQL) |
| **Optimization Backend** | Python, FastAPI, scikit-learn, pandas |
| **Containerization** | Docker, Docker Compose, nginx |

---

## System Architecture

```text
 ┌────────────────────────┐        ┌──────────────────────────┐
 │  orangetail-frontend   │  HTTP  │  orangetail-algorithm    │
 │  React app on nginx    │ ─────► │  FastAPI + scheduler     │
 │  localhost:8080        │        │  localhost:8000          │
 └───────────┬────────────┘        └────────────┬─────────────┘
             │                                  │
             └──────────────┬───────────────────┘
                            ▼
                ┌────────────────────────┐
                │  Supabase (cloud)      │
                │  PostgreSQL + Auth     │
                └────────────────────────┘
```

- The **frontend** handles the user interface, login, and data management, reading and writing directly to Supabase.
- The **algorithm server** receives generation requests from the frontend, fetches the required data from Supabase, runs the scheduling algorithm, and returns the generated schedule.

---

## Project Structure

```text
orangetail-scheduling-system/
├── Frontend/                   # React + Tauri application
│   ├── src/
│   │   ├── screens/            # dashboard, generate, login, upload, view_schedules
│   │   ├── lib/                # Supabase client (supabaseClient.js)
│   │   └── ...
│   ├── src-tauri/              # Tauri (Rust) desktop configuration
│   │   └── bin/                # PyInstaller-compiled backend sidecar
│   ├── supabase/               # Supabase edge functions (login)
│   ├── Dockerfile              # Builds the web frontend image (nginx)
│   └── nginx.conf
│
├── Algorithm/                  # Python schedule-generation backend
│   ├── api.py                  # FastAPI server entry point
│   ├── scheduler.py            # Memetic scheduling algorithm
│   ├── database.py             # Supabase data access
│   ├── lab_matching.py         # Laboratory / room-type matching
│   ├── ml_predictor.py         # Faculty compatibility predictions
│   ├── train_faculty_model.py  # Trains the faculty affinity model
│   ├── faculty_affinity_model.pkl
│   ├── requirements.txt
│   └── Dockerfile              # Builds the algorithm server image
│
├── docker-compose.yml          # Runs both containers together
├── .env.example                # Environment variable template
└── LICENSE
```

---

## Quick Start with Docker

The fastest way to run OrangeTail. No source code or setup required.

**Docker Hub images:**
- Algorithm server: https://hub.docker.com/r/fromhelio/orangetail-algorithm
- Web frontend: https://hub.docker.com/r/fromhelio/orangetail-frontend

**Requirements:**
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- An internet connection (the database is hosted on Supabase)

**1. Start the containers**

```bash
docker run -d --name orangetail-algorithm -p 8000:8000 fromhelio/orangetail-algorithm
docker run -d --name orangetail-frontend -p 8080:80 fromhelio/orangetail-frontend
```

Docker automatically downloads both images from Docker Hub on the first run.

**2. Open the system**

| Service | URL |
|---|---|
| OrangeTail web app | http://localhost:8080 |
| Algorithm API docs | http://localhost:8000/docs |

**3. Stop the system**

```bash
docker rm -f orangetail-algorithm orangetail-frontend
```

---

## Building from Source with Docker

Use this to build the images yourself from the code in this repository.

**1. Clone the repository**

```bash
git clone https://github.com/fromHELIO/orangetail-scheduling-system.git
cd orangetail-scheduling-system
```

**2. Create the environment file**

Copy `.env.example` to `.env` and fill in the Supabase credentials (see [Environment Variables](#environment-variables)).

```bash
cp .env.example .env        # macOS / Linux
copy .env.example .env      # Windows
```

**3. Build and start**

```bash
docker compose up -d --build
```

The first build takes a few minutes. Then open http://localhost:8080.

**Useful commands**

| Command | Description |
|---|---|
| `docker compose ps` | Show running containers |
| `docker compose logs algorithm` | View algorithm server logs |
| `docker compose logs frontend` | View frontend logs |
| `docker compose up -d --build --force-recreate` | Rebuild after code or `.env` changes |
| `docker compose down` | Stop and remove the containers |

---

## Local Development (without Docker)

**Requirements:** Python 3.12+, Node.js 22+, and (for the desktop app) the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

**Algorithm server**

```bash
cd Algorithm
pip install -r requirements.txt
# create Algorithm/.env with SUPABASE_URL and SUPABASE_KEY
python api.py
```

The API runs at http://127.0.0.1:8000.

**Frontend (web)**

```bash
cd Frontend
npm install
# create Frontend/.env with VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_ALGORITHM_API_URL
npm run dev
```

**Frontend (desktop app)**

```bash
cd Frontend
npx tauri dev
```

---

## Environment Variables

All variables are listed in `.env.example`. The `.env` file contains credentials and is excluded from version control.

| Variable | Used by | Description |
|---|---|---|
| `SUPABASE_URL` | Algorithm | Supabase project URL |
| `SUPABASE_KEY` | Algorithm | Supabase service-role key |
| `VITE_SUPABASE_URL` | Frontend | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Frontend | Supabase anon (public) key |
| `VITE_ALGORITHM_API_URL` | Frontend | Algorithm server URL (default: `http://localhost:8000`) |

> `VITE_*` variables are embedded into the frontend at build time. After changing them, rebuild the frontend image.

---

## API Endpoints

The algorithm server exposes the following endpoints. Interactive documentation is available at http://localhost:8000/docs.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `POST` | `/api/generate-schedule` | Starts a schedule-generation job |
| `GET` | `/api/generate-schedule/{job_id}` | Gets the status and result of a generation job |

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `port is already allocated` | Another program is using port 8000 or 8080. Stop any locally running `python api.py`, `uvicorn`, or `npm run dev`, then try again. |
| A container stops right after starting | Check its logs with `docker logs orangetail-algorithm` (or `docker compose logs algorithm`). |
| `Invalid API key` when generating | The Supabase key given to the algorithm is incorrect. Check `SUPABASE_KEY` in `.env`, then run `docker compose up -d --force-recreate algorithm`. |
| Frontend changes don't appear | Rebuild with `docker compose up -d --build`, then hard-refresh the browser (Ctrl+F5). |
| Slow generation on Apple Silicon Macs | The images are built for x86/AMD64 and run under emulation on M-series Macs. |

---

## License

This project is licensed under the [MIT License](LICENSE).
