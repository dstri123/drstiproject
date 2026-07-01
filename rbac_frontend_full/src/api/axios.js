import axios from "axios";

const API = axios.create({
  baseURL: "http://127.0.0.1:8000/api/v1/",
});

// Endpoints that don't require (and shouldn't send) an auth token
const PUBLIC_ENDPOINTS = [
  "auth/signup/",
  "auth/login/",
  "check-admin/",
  "create-admin/",
];

API.interceptors.request.use((config) => {
  const isPublic = PUBLIC_ENDPOINTS.some((path) => config.url?.includes(path));

  if (!isPublic) {
    const token = localStorage.getItem("token") || localStorage.getItem("access");

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }

  return config;
});

export default API;
