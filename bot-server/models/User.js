const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  psid: { type: String, unique: true, required: true },
  first_name: String,
  last_name: String,
  profile_pic: String,
  locale: String,
  timezone: Number,
  gender: String,
  last_interaction: { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", userSchema);
