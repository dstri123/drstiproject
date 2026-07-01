@echo off
REM Reset and start the backend server

echo.
echo =========================================
echo DISTRI BACKEND - RESET AND START
echo =========================================
echo.

REM Step 1: Run migrations
echo [1] Running database migrations...
python manage.py migrate

REM Step 2: Seed database
echo.
echo [2] Seeding database with fresh data...
python manage.py seed_data

REM Step 3: Show seeded login credentials
echo.
echo ==========================================
echo SEEDED LOGIN CREDENTIALS
echo ==========================================
echo Super Admin : superadmin       / SuperAdmin@123
echo Admin       : acme_admin1       / AcmeAdmin@123
echo Member      : acme_member1      / AcmeMember@123
echo Proj Manager: acme_pm1          / AcmePM@123
echo Engineer    : tech_engineer1    / TechEng@123
echo Contributor : global_contributor1 / GlobalContrib@123
echo ==========================================

REM Step 4: Start server
echo.
echo [4] Starting Django development server...
echo.
echo Server will run at: http://127.0.0.1:8000
echo API endpoint: http://127.0.0.1:8000/api/v1
echo.
echo Press Ctrl+C to stop the server
echo.

python manage.py runserver
