#!/usr/bin/env python
"""
Distri API Test Script
Tests all API endpoints to verify the backend is working correctly
"""

import requests
import json
from datetime import datetime

# Configuration
API_BASE_URL = "http://127.0.0.1:8000/api/v1"
TEST_RESULTS = []

class TestResult:
    def __init__(self, test_name, passed, message="", response_data=None):
        self.test_name = test_name
        self.passed = passed
        self.message = message
        self.response_data = response_data
        self.timestamp = datetime.now().strftime("%H:%M:%S")

def print_header(text):
    print("\n" + "="*60)
    print(f"  {text}")
    print("="*60)

def print_test(result):
    status = "[PASS]" if result.passed else "[FAIL]"
    print(f"{status} | {result.timestamp} | {result.test_name}")
    if result.message:
        print(f"       Message: {result.message}")
    TEST_RESULTS.append(result)

def test_health():
    """Test if API is responding"""
    print_header("1. HEALTH CHECK")
    try:
        response = requests.get(f"{API_BASE_URL}/profile/", timeout=5)
        # Any response means server is up (even 401 without auth)
        if response.status_code in [200, 400, 401, 403]:
            print_test(TestResult("API Health Check", True, "API is responding"))
            return True
        else:
            print_test(TestResult("API Health Check", False, f"Unexpected status: {response.status_code}"))
            return False
    except requests.exceptions.ConnectionError:
        print_test(TestResult("API Health Check", False, "Cannot connect to API. Is server running?"))
        return False
    except Exception as e:
        print_test(TestResult("API Health Check", False, str(e)))
        return False

def test_login(username, password):
    """Test login endpoint"""
    print_header("2. LOGIN TEST")
    try:
        response = requests.post(
            f"{API_BASE_URL}/auth/login/",
            json={"username": username, "password": password},
            timeout=5
        )

        if response.status_code == 200:
            data = response.json()
            has_token = "access" in data and "refresh" in data

            if has_token:
                # Extract role from user object or top-level
                role = data.get("user", {}).get("role") or data.get("role", "unknown")
                print_test(TestResult(
                    "Login Endpoint",
                    True,
                    f"Login successful. Token issued. Role: {role}",
                    data
                ))
                return data.get("access"), role
            else:
                error_detail = f"Response keys: {list(data.keys())}"
                print_test(TestResult("Login Endpoint", False, f"Missing token. {error_detail}"))
                return None, None
        else:
            try:
                error_msg = response.json().get("error", response.text) if response.text else "Empty response"
            except:
                error_msg = response.text
            print_test(TestResult("Login Endpoint", False, f"Status {response.status_code}: {error_msg}"))
            return None, None
    except Exception as e:
        print_test(TestResult("Login Endpoint", False, str(e)))
        return None, None

def test_profile(token):
    """Test profile endpoint"""
    print_header("3. PROFILE TEST")
    if not token:
        print_test(TestResult("Profile Endpoint", False, "No token available"))
        return False

    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(f"{API_BASE_URL}/profile/", headers=headers, timeout=5)

        if response.status_code == 200:
            data = response.json()
            print_test(TestResult(
                "Profile Endpoint",
                True,
                f"Profile retrieved for {data.get('username', 'N/A')}",
                data
            ))
            return True
        else:
            print_test(TestResult("Profile Endpoint", False, f"Status {response.status_code}"))
            return False
    except Exception as e:
        print_test(TestResult("Profile Endpoint", False, str(e)))
        return False

def test_organizations(token):
    """Test organizations list endpoint"""
    print_header("4. ORGANIZATIONS TEST")
    if not token:
        print_test(TestResult("Organizations Endpoint", False, "No token available"))
        return False

    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(f"{API_BASE_URL}/organizations/", headers=headers, timeout=5)

        if response.status_code == 200:
            data = response.json()
            count = len(data) if isinstance(data, list) else 0
            print_test(TestResult(
                "Organizations Endpoint",
                True,
                f"Retrieved {count} organizations",
                {"count": count}
            ))
            return True
        else:
            print_test(TestResult("Organizations Endpoint", False, f"Status {response.status_code}"))
            return False
    except Exception as e:
        print_test(TestResult("Organizations Endpoint", False, str(e)))
        return False

def test_check_username():
    """Test username availability check"""
    print_header("5. USERNAME CHECK TEST")
    try:
        response = requests.post(
            f"{API_BASE_URL}/check-username/",
            json={"username": "nonexistent_user_12345"},
            timeout=5
        )

        if response.status_code == 200:
            data = response.json()
            is_available = data.get("available", False)
            print_test(TestResult(
                "Username Check Endpoint",
                True,
                f"Username availability: {is_available}",
                data
            ))
            return True
        else:
            print_test(TestResult("Username Check Endpoint", False, f"Status {response.status_code}"))
            return False
    except Exception as e:
        print_test(TestResult("Username Check Endpoint", False, str(e)))
        return False

def test_check_email():
    """Test email availability check"""
    print_header("6. EMAIL CHECK TEST")
    try:
        response = requests.post(
            f"{API_BASE_URL}/check-email/",
            json={"email": "nonexistent@example.com"},
            timeout=5
        )

        if response.status_code == 200:
            data = response.json()
            is_available = data.get("available", False)
            print_test(TestResult(
                "Email Check Endpoint",
                True,
                f"Email availability: {is_available}",
                data
            ))
            return True
        else:
            print_test(TestResult("Email Check Endpoint", False, f"Status {response.status_code}"))
            return False
    except Exception as e:
        print_test(TestResult("Email Check Endpoint", False, str(e)))
        return False

def print_summary():
    """Print test summary"""
    print_header("TEST SUMMARY")
    passed = sum(1 for r in TEST_RESULTS if r.passed)
    total = len(TEST_RESULTS)
    percentage = (passed / total * 100) if total > 0 else 0

    print(f"\nTotal Tests: {total}")
    print(f"Passed: {passed} [OK]")
    print(f"Failed: {total - passed} [FAIL]")
    print(f"Success Rate: {percentage:.1f}%")

    if passed == total:
        print("\n[SUCCESS] ALL TESTS PASSED! Application is ready to use.")
    else:
        print("\n[WARNING] Some tests failed. Check the output above for details.")

    print("\n" + "="*60)

def main():
    """Run all tests"""
    print("\n" + "[TEST] DISTRI API TEST SUITE".center(60))
    print(f"API Base URL: {API_BASE_URL}")
    print(f"Test Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    # Test 1: Health check
    if not test_health():
        print("\n[ERROR] Cannot proceed - API is not responding")
        print("\nMake sure to run:")
        print("  python manage.py runserver")
        return

    # Test 2: Login
    token, role = test_login("acme_admin1", "AcmeAdmin@123")

    # Test 3: Profile
    if token:
        test_profile(token)

    # Test 4: Organizations
    if token:
        test_organizations(token)

    # Test 5: Username check
    test_check_username()

    # Test 6: Email check
    test_check_email()

    # Summary
    print_summary()

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n[INTERRUPTED] Tests interrupted by user")
    except Exception as e:
        print(f"\n\n[ERROR] Unexpected error: {e}")
