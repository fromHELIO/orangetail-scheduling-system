# Database Setup & Recovery

OrangeTail uses a [Supabase](https://supabase.com/) (PostgreSQL) database. This folder contains everything needed to recreate it from scratch in a new Supabase project, in case the original database is unavailable.

| File | Contents |
|---|---|
| `schema.sql` | Tables, relationships, functions, triggers, and security policies |
| `data.sql` | All records (users, professors, rooms, curriculums, schedules, etc.) |

The login function is in `Frontend/supabase/functions/login/`.

---

## What you need

- A free Supabase account: https://supabase.com
- [Node.js](https://nodejs.org/) (for the Supabase CLI, run through `npx`; no install needed)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- This repository, cloned to your computer

---

## Step 1: Create a new Supabase project

1. Log in to https://supabase.com/dashboard and click **New project**.
2. Enter a project name and a database password (save the password).
3. Wait for the project to finish setting up.
4. Note the **Project ID** shown in **Project Settings → General**. You'll need it in Step 3.

## Step 2: Create the tables and load the data

1. In the Supabase dashboard, open **SQL Editor** → **New query**.
2. Open `database/schema.sql` from this repository, copy its entire contents into the editor, and click **Run**.
3. Open a new query, paste the entire contents of `database/data.sql`, and click **Run**.
4. Open **Table Editor** to confirm the tables and records are there.

## Step 3: Deploy the login function

The system logs in through a Supabase Edge Function. From the repository root:

```bash
cd Frontend
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_ID
npx supabase functions deploy login --no-verify-jwt
cd ..
```

Replace `YOUR_PROJECT_ID` with the Project ID from Step 1. `npx supabase login` opens a browser window to sign in.

## Step 4: Connect the system to the new database

1. In the Supabase dashboard, go to **Project Settings → API Keys** (and **Project Settings → Data API** for the project URL). Copy:
   - the **Project URL**
   - the **anon / public** key
   - the **service_role / secret** key
2. In the repository root, copy `.env.example` to `.env` and fill it in:

   ```env
   SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
   SUPABASE_KEY=YOUR_SERVICE_ROLE_KEY
   VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
   VITE_ALGORITHM_API_URL=http://localhost:8000
   ```

## Step 5: Build and run the system

The prebuilt Docker Hub images are connected to the original database, so build from source to use the new one:

```bash
docker compose up -d --build
```

Open **http://localhost:8080** and log in with the existing accounts from `data.sql`.

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Error when running `data.sql` | Make sure `schema.sql` ran successfully first. Run `data.sql` in a fresh query. |
| Login fails with a network / function error | The login function isn't deployed. Repeat Step 3 and check **Edge Functions** in the dashboard. |
| `Invalid API key` when generating schedules | `SUPABASE_KEY` in `.env` must be the **service_role** key of the new project. Run `docker compose up -d --force-recreate algorithm` after fixing it. |
| App still shows old data | The frontend was built with the old URL. Rebuild with `docker compose up -d --build`. |

---

## For developers: regenerating the dump files

Run these from the repository root with Docker Desktop running. Get the connection string from the Supabase dashboard: click **Connect** → **Session pooler** → copy the URI and replace `[YOUR-PASSWORD]` with the database password.

```bash
npx supabase db dump --db-url "CONNECTION_STRING" -f database/schema.sql
npx supabase db dump --db-url "CONNECTION_STRING" --data-only -f database/data.sql
```
