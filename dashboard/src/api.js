import axios from "axios";

const API = axios.create({
  baseURL: "http://localhost:3000", // tu servidor Node local
  headers: {
    Authorization: "Bearer hanlob_admin_2025"
  }
});

export default API;
