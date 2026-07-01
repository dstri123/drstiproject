@echo off
REM Setup and test script for Distri API on Windows

echo.
echo ==========================================
echo DISTRI API - Setup and Test
echo ==========================================
echo.

REM Step 1: Run migrations
echo [1] Running database migrations...
python manage.py migrate

REM Step 2: Seed database
echo.
echo [2] Seeding database with test data...
python manage.py seed_data

REM Step 3: Show seeded login credentials
call :show_credentials

REM Step 4: Run tests
echo.
echo [4] Running API tests...
python test_api.py

echo.
echo ==========================================
pause
goto :eof

:show_credentials
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
goto :eof
