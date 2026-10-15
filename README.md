# OrangeTail — Automated Scheduling & Professor Loading System

An intelligent, automated class scheduling and faculty loading application designed to streamline academic timetabling, optimize room allocation, and handle complex curriculum requirements. Built specifically for university department operations, OrangeTail replaces manual scheduling with a fast, constraint-guided generation engine.

---

## Table of Contents

- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [System Architecture](#system-architecture)
- [Project Structure](#project-structure)
- [Quick Start: Run from Docker Hub](#quick-start-run-from-docker-hub)
- [Building from Source with Docker](#building-from-source-with-docker)
- [Database Setup & Recovery](#database-setup--recovery)
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
| **Database & Auth** | [Supabase](https://supabase.com/) (PostgreSQL + Edge Functions) |
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
                │  PostgreSQL + Login    │
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
│   ├── supabase/functions/     # Supabase Edge Function (login)
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
├── database/                   # Database recovery files
│   ├── README.md               # Step-by-step database setup guide
│   ├── schema.sql              # Tables, relationships, policies
│   └── data.sql                # System records
│
├── docker-compose.yml          # Builds and runs both containers together
├── .env.example                # Environment variable template
└── LICENSE
```

---

## Quick Start: Run from Docker Hub

Run OrangeTail directly from the published Docker images. No source code or GitHub clone is needed.

**Docker Hub images:**
- Algorithm server: https://hub.docker.com/r/fromhelio/orangetail-algorithm
- Web frontend: https://hub.docker.com/r/fromhelio/orangetail-frontend

**Requirements:**
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (installed and running)
- An internet connection (the database is hosted on Supabase)
- The database credentials (provided by the developers)

### Step 1: Create a folder with a `.env` file

Create an empty folder anywhere on your computer. Inside it, create a file named exactly **`.env`** containing:

```env
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
SUPABASE_KEY=YOUR_SERVICE_ROLE_KEY
```

> **Windows:** make sure the file is named `.env` and not `.env.txt`. In Notepad, choose **Save as type: All Files** when saving.

### Step 2: Open a terminal in that folder

- **Windows:** open the folder in File Explorer, click the address bar, type `powershell`, and press Enter.
- **macOS / Linux:** open Terminal and `cd` into the folder.

### Step 3: Download the images from Docker Hub

```bash
docker pull fromhelio/orangetail-algorithm:latest
docker pull fromhelio/orangetail-frontend:latest
```

### Step 4: Start the containers

```bash
docker run -d --name orangetail-algorithm -p 8000:8000 --env-file .env fromhelio/orangetail-algorithm:latest
docker run -d --name orangetail-frontend -p 8080:80 fromhelio/orangetail-frontend:latest
```

Confirm both are running:

```bash
docker ps
```

Both `orangetail-algorithm` and `orangetail-frontend` should show a status of **Up**.

### Step 5: Open the system

| Service | URL |
|---|---|
| OrangeTail web app | http://localhost:8080 |
| Algorithm API docs | http://localhost:8000/docs |

### Step 6: Stop the system

```bash
docker rm -f orangetail-algorithm orangetail-frontend
```

> The frontend image is connected to the original OrangeTail database. To use a different (recreated) database, follow [Building from Source with Docker](#building-from-source-with-docker) instead.

---

## Building from Source with Docker

Use this to build the images yourself, for example to connect the system to a new database.

**1. Clone the repository**

```bash
git clone https://github.com/fromHELIO/orangetail-scheduling-system.git
cd orangetail-scheduling-system
```

**2. Create the environment file**

Copy `.env.example` to `.env` and fill in all values (see [Environment Variables](#environment-variables)).

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

## Database Setup & Recovery

The database runs on Supabase. If the original database is unavailable, it can be recreated in a new Supabase project using the SQL dump files in the `database/` folder.

**Full step-by-step guide: [database/README.md](database/README.md)**

In summary:
1. Create a new Supabase project.
2. Run `database/schema.sql`, then `database/data.sql`, in the Supabase SQL Editor.
3. Deploy the login Edge Function from `Frontend/supabase/functions/login`.
4. Put the new project's URL and keys in `.env`.
5. Build and run with `docker compose up -d --build`.

---

## Local Development (without Docker)

**Requirements:** Python 3.12+, Node.js 22+, and (for the desktop app) the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

**Algorithm server**

```bash
cd Algorithm
pip install -r requirements.txt
# create Algorithm/.env with SUPABASE_URL and SUPABASE_KEY (copy from .env.example)
python api.py
```

The API runs at http://127.0.0.1:8000.

**Frontend (web)**

```bash
cd Frontend
npm install
# create Frontend/.env with the three VITE_* lines from .env.example
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

| Variable | Used by | When | Description |
|---|---|---|---|
| `SUPABASE_URL` | Algorithm | At startup | Supabase project URL |
| `SUPABASE_KEY` | Algorithm | At startup | Supabase service-role key |
| `VITE_SUPABASE_URL` | Frontend | At build time | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Frontend | At build time | Supabase anon (public) key |
| `VITE_ALGORITHM_API_URL` | Frontend | At build time | Algorithm server URL (default: `http://localhost:8000`) |

> `VITE_*` variables are embedded into the frontend when the image is built, so they are only needed when building from source. Running the Docker Hub images only requires `SUPABASE_URL` and `SUPABASE_KEY`.

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
| `RuntimeError: SUPABASE_URL and/or SUPABASE_KEY are missing` | The algorithm container didn't receive the credentials. Make sure you ran the command from the folder containing `.env`, included `--env-file .env`, and that the file isn't named `.env.txt`. |
| `Conflict. The container name ... is already in use` | Remove the old containers first: `docker rm -f orangetail-algorithm orangetail-frontend` |
| `port is already allocated` | Another program is using port 8000 or 8080. Stop any locally running `python api.py`, `uvicorn`, or `npm run dev`, or remove old containers as above. |
| A container stops right after starting | Check its logs: `docker logs orangetail-algorithm` |
| `Invalid API key` when generating | `SUPABASE_KEY` must be the **service_role** key, on one line, with no quotes or extra text. Fix `.env`, then remove and re-run the algorithm container. |
| Frontend changes don't appear | Rebuild with `docker compose up -d --build`, then hard-refresh the browser (Ctrl+F5). |
| Slow generation on Apple Silicon Macs | The images are built for x86/AMD64 and run under emulation on M-series Macs. |

---

## License

This project is licensed under the [MIT License](LICENSE).
