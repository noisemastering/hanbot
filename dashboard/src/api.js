import axios from "axios";

const API = axios.create({
  baseURL: "https://hanbot-production.up.railway.app",
  headers: {
    Authorization: "Bearer hanlob_admin_2025"
  }
});

export default API;
