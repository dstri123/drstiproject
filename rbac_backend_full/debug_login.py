#!/usr/bin/env python
"""Debug login endpoint response"""

import requests
import json

API_BASE_URL = "http://127.0.0.1:8000/api/v1"

try:
    response = requests.post(
        f"{API_BASE_URL}/auth/login/",
        json={"username": "acme_admin1", "password": "AcmeAdmin@123"},
        timeout=5
    )

    print(f"Status Code: {response.status_code}")
    print(f"\nFull Response:")
    print(json.dumps(response.json(), indent=2))

except Exception as e:
    print(f"Error: {e}")
