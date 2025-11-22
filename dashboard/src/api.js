import axios from "axios";

const API = axios.create({
  baseURL: process.env.REACT_APP_API_URL || "https://hanbot-production.up.railway.app",
  withCredentials: true,
  headers: {
    Authorization: "Bearer hanlob_admin_2025"
  }
});

// Add request interceptor to include JWT token for authenticated routes
API.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default API;
