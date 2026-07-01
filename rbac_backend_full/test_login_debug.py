#!/usr/bin/env python
"""Debug login response for acme_admin1"""

import requests
import json

API_BASE_URL = "http://127.0.0.1:8000/api/v1"

print("Testing login with acme_admin1...")
print("=" * 60)

try:
    response = requests.post(
        f"{API_BASE_URL}/auth/login/",
        json={
            "username": "acme_admin1",
            "password": "AcmeAdmin@123"
        },
        timeout=5
    )

    print(f"Status Code: {response.status_code}")
    print(f"\nResponse:")
    data = response.json()
    print(json.dumps(data, indent=2))

    # Check if user data is in response
    if "user" in data:
        print(f"\n✓ User data found!")
        print(f"  Role: {data['user'].get('role', 'MISSING')}")
        print(f"  Sub Role: {data['user'].get('sub_role', 'MISSING')}")
    else:
        print(f"\n✗ User data NOT in response!")
        print(f"  Available keys: {list(data.keys())}")

except requests.exceptions.ConnectionError:
    print("ERROR: Cannot connect to API server")
    print("Make sure to run: python manage.py runserver")
except Exception as e:
    print(f"ERROR: {e}")
