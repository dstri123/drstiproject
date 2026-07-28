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

API.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const refresh = localStorage.getItem("refresh");
    const isAuthRequest = originalRequest?.url?.includes("auth/login/");

    const clearExpiredSession = () => {
      localStorage.removeItem("token");
      localStorage.removeItem("access");
      localStorage.removeItem("refresh");
      if (!isAuthRequest && window.location.pathname !== "/login") {
        window.location.assign("/login");
      }
    };

    if (
      error.response?.status !== 401 ||
      originalRequest?._retry ||
      isAuthRequest
    ) {
      if (error.response?.status === 401 && !refresh) {
        clearExpiredSession();
      }
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      const refreshResponse = await axios.post(
        `${API.defaults.baseURL}auth/token/refresh/`,
        { refresh },
      );
      const access = refreshResponse.data.access;
      localStorage.setItem("token", access);
      originalRequest.headers.Authorization = `Bearer ${access}`;
      return API(originalRequest);
    } catch (refreshError) {
      clearExpiredSession();
      return Promise.reject(refreshError);
    }
  },
);

export default API;
