# Dstri — Local Setup Guide

This app has **two parts**:

| Part          | Folder               | Stack                                  | Runs on               |
| ------------- | -------------------- | -------------------------------------- | --------------------- |
| Backend (API) | `rbac_backend_full`  | Django + Django REST Framework + MySQL | http://localhost:8000 |
| Frontend (UI) | `rbac_frontend_full` | React (CRA + CRACO) + three.js         | http://localhost:3000 |

Run **both** at the same time, in two terminals.

---

## 1. Prerequisites

Install these first:

- **Python 3.10 – 3.13** — https://www.python.org/downloads/
- **Node.js 18+ and npm** — https://nodejs.org/
- **MySQL Server 8.x** — https://dev.mysql.com/downloads/
- **Git** — https://git-scm.com/

> Windows note: `mysqlclient` (a backend dependency) needs the MySQL C connector.
> The easiest route on Windows is to install MySQL via the official installer
> (it ships the needed libraries), or use a prebuilt wheel:
> `pip install mysqlclient` usually works once MySQL is installed.

---

## 2. Get the code

If the backend and frontend are **separate** repos, clone both side by side:

```bash
git clone <BACKEND_REPO_URL> rbac_backend_full
git clone <FRONTEND_REPO_URL> rbac_frontend_full
```

(If they're in **one** repo, just `git clone <REPO_URL>` — both folders are inside.)

---

## 3. Database setup (MySQL)

The backend expects a database named **`distriapp`** on **port 3307** with user
**`root`** / password **`root`** (see `rbac_backend_full/core/settings.py`).

Create the database (adjust if your MySQL runs on the default port 3306):

```sql
-- in the MySQL client
CREATE DATABASE distriapp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

If your MySQL uses a different **port / user / password**, edit
`rbac_backend_full/core/settings.py` → `DATABASES['default']` to match:

```python
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.mysql',
        'NAME': 'distriapp',
        'USER': 'root',
        'PASSWORD': 'Drsti@2026',
        'HOST': '127.0.0.1',
        'PORT': '3307',     # <- change to 3306 if that's your MySQL port
    }
}
```

---

## 4. Backend setup (Django API)

```bash
cd rbac_backend_full

# 1) create + activate a virtual environment
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
# source venv/bin/activate

# 2) install dependencies
pip install -r requirements.txt

# 3) create the database tables
python manage.py migrate

# 4) (optional) create an admin user for /admin
python manage.py createsuperuser

# 5) run the API server
python manage.py runserver
```

Backend is now at **http://localhost:8000** (API base: `http://localhost:8000/api/v1/`).

---

## 5. Frontend setup (React UI)

Open a **second terminal**:

```bash
cd rbac_frontend_full

# install dependencies (legacy peer deps avoids version-range conflicts
# from leaflet / maplibre-gl)
npm install --legacy-peer-deps

# start the dev server
npm start
```

Frontend is now at **http://localhost:3000** and talks to the backend.

> If your backend is **not** on `http://127.0.0.1:8000`, edit the API base URL in
> `rbac_frontend_full/src/api/axios.js`:
>
> ```js
> baseURL: "http://127.0.0.1:8000/api/v1/",
> ```

---

## 6. First login

1. Open http://localhost:3000
2. Sign up / log in (or use the admin user from `createsuperuser`).
3. Create a project, then upload BIM (`.ifc`/`.fbx`) and Point Cloud (`.ply`)
   files to use the 3D Viewer, Analytics, and Progress Assessment.

---

## 7. Production build (optional)

```bash
cd rbac_frontend_full
npm run build         # outputs an optimized static site in build/
```

Serve `build/` behind nginx (or `npx serve -s build`). When hosting, the server
must send these headers (needed for SharedArrayBuffer / 3D features):

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

(The dev server already sets these via `craco.config.js`.)

---

## 8. Troubleshooting

| Problem                                    | Fix                                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `pip install mysqlclient` fails            | Install MySQL Server first (provides the C connector); on Linux: `sudo apt install default-libmysqlclient-dev build-essential`. |
| `Access denied` / `Can't connect` to MySQL | Check the user/password/port in `core/settings.py` match your MySQL.                                                            |
| Frontend can't reach the API / CORS errors | Confirm the backend is running on :8000 and the `baseURL` in `src/api/axios.js` is correct.                                     |
| `npm install` peer-dependency errors       | Use `npm install --legacy-peer-deps`.                                                                                           |
| Map tiles / 3D not loading                 | They go through the backend tile proxy — make sure the backend is running.                                                      |
| Port already in use                        | Backend: `python manage.py runserver 8001`; Frontend: `set PORT=3001 && npm start`.                                             |

---

## 9. What needs to run together

- **MySQL** (port 3307 by default)
- **Backend**: `python manage.py runserver` (port 8000)
- **Frontend**: `npm start` (port 3000)

All three must be up for the app to work end to end.
