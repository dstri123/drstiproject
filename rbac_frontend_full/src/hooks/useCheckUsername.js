import { useState, useCallback, useRef } from "react";
import API from "../api/axios";

export function useCheckUsername() {
  const [checking, setChecking] = useState(false);
  const [isAvailable, setIsAvailable] = useState(null);
  const [message, setMessage] = useState("");
  const debounceTimer = useRef(null);

  const checkUsername = useCallback(
    async (username) => {
      if (!username || username.length < 3) {
        setIsAvailable(null);
        setMessage("");
        return;
      }

      setChecking(true);

      try {
        const res = await API.post("check-username/", { username });
        setIsAvailable(res.data.available);
        setMessage(res.data.message);
      } catch (err) {
        setIsAvailable(null);
        setMessage("Error checking username");
      } finally {
        setChecking(false);
      }
    },
    []
  );

  const debouncedCheck = useCallback((username) => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    setIsAvailable(null);
    setMessage("");

    debounceTimer.current = setTimeout(() => {
      checkUsername(username);
    }, 500);
  }, [checkUsername]);

  return { checking, isAvailable, message, debouncedCheck };
}

export function useCheckEmail() {
  const [checking, setChecking] = useState(false);
  const [isAvailable, setIsAvailable] = useState(null);
  const [message, setMessage] = useState("");
  const debounceTimer = useRef(null);

  const checkEmail = useCallback(
    async (email) => {
      if (!email) {
        setIsAvailable(null);
        setMessage("");
        return;
      }

      setChecking(true);

      try {
        const res = await API.post("check-email/", { email });
        setIsAvailable(res.data.available);
        setMessage(res.data.message);
      } catch (err) {
        setIsAvailable(null);
        setMessage("Error checking email");
      } finally {
        setChecking(false);
      }
    },
    []
  );

  const debouncedCheck = useCallback((email) => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    debounceTimer.current = setTimeout(() => {
      checkEmail(email);
    }, 500);
  }, [checkEmail]);

  return { checking, isAvailable, message, debouncedCheck };
}
