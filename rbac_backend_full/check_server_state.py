#!/usr/bin/env python
"""Check if server is using new or old code"""

import requests
import json

API_BASE_URL = "http://127.0.0.1:8000/api/v1"

print("\n" + "="*70)
print("CHECKING DJANGO SERVER STATE")
print("="*70 + "\n")

try:
    response = requests.post(
        f"{API_BASE_URL}/auth/login/",
        json={"username": "acme_admin1", "password": "AcmeAdmin@123"},
        timeout=5
    )

    data = response.json()

    print("LOGIN RESPONSE ANALYSIS:")
    print("-" * 70)
    print(f"Status Code: {response.status_code}")
    print(f"\nResponse Keys: {list(data.keys())}\n")

    if "user" in data:
        print("✓ SERVER IS USING NEW CODE!")
        print("  User data is present in response")
        print(f"  Role: {data['user'].get('role', 'MISSING')}")
        print("\n=> Clear browser cache and try login again")
        print("=> Go to http://localhost:3000")
        print("=> Press Ctrl+Shift+Delete to clear cache")
    else:
        print("✗ SERVER IS USING OLD CODE!")
        print("  User data is NOT in response")
        print("  Only tokens are returned\n")
        print("REQUIRED FIX:")
        print("1. Stop Django server (Ctrl+C)")
        print("2. Run: python manage.py runserver")
        print("3. Wait for 'Starting development server...'")
        print("4. Then try login again")

except requests.exceptions.ConnectionError:
    print("✗ CANNOT CONNECT TO SERVER!")
    print("\nMake sure Django is running:")
    print("  cd rbac_backend_full")
    print("  python manage.py runserver")
except Exception as e:
    print(f"✗ ERROR: {e}")

print("\n" + "="*70 + "\n")
