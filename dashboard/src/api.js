import axios from "axios";

const API = axios.create({
  baseURL: process.env.REACT_APP_API_URL || "http://localhost:3000",
  headers: {
    Authorization: `Bearer ${process.env.REACT_APP_API_KEY || "hanlob_admin_2025"}`
  }
});

export default API;
