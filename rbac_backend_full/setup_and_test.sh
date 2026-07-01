#!/bin/bash
# Setup and test script for Distri API

echo "=========================================="
echo "DISTRI API - Setup & Test"
echo "=========================================="

# Step 1: Run migrations
echo ""
echo "[1] Running database migrations..."
python manage.py migrate

# Step 2: Seed database
echo ""
echo "[2] Seeding database with test data..."
python manage.py seed_data

# Step 3: Check if server is running, if not start it
echo ""
echo "[3] Checking if API server is running..."
if ! curl -s http://127.0.0.1:8000/api/v1/profile/ > /dev/null 2>&1; then
    echo "    Server not running. Please start it with:"
    echo "    python manage.py runserver"
    echo ""
    echo "    Then run the test script again:"
    echo "    python test_api.py"
else
    echo "    Server is running!"

    # Step 4: Run tests
    echo ""
    echo "[4] Running API tests..."
    python test_api.py
fi
