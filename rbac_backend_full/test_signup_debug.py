#!/usr/bin/env python
"""Debug signup endpoint"""

import requests
import json

API_BASE_URL = "http://127.0.0.1:8000/api/v1"

print("Testing signup endpoint...")
print("=" * 60)

try:
    response = requests.post(
        f"{API_BASE_URL}/auth/signup/",
        json={
            "username": "testuser123",
            "email": "testuser123@example.com",
            "password": "TestPass@123"
        },
        timeout=5
    )

    print(f"Status Code: {response.status_code}")
    print(f"\nResponse:")
    data = response.json()
    print(json.dumps(data, indent=2))

    if response.status_code == 201:
        print("\n✓ Signup successful!")
    else:
        print(f"\n✗ Signup failed with status {response.status_code}")

except requests.exceptions.ConnectionError:
    print("ERROR: Cannot connect to API server")
    print("Make sure to run: python manage.py runserver")
except Exception as e:
    print(f"ERROR: {e}")
