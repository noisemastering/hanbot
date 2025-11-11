import axios from "axios";

const API = axios.create({
  baseURL: process.env.REACT_APP_API_URL || "https://hanbot-production.up.railway.app",
  headers: {
    Authorization: "Bearer hanlob_admin_2025"
  }
});

export default API;
