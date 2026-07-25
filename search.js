import express from "express";
import path from "path";
import cors from "cors";
import config from "config";
import os from "os";
import pool, { initializeDatabase } from "./db.js";

const app = express();
const port = process.env.PORT || 7000;
const photosFolder = config.get("configs.IMAGES_FOLDER");

const getLocalIP = () => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
};

app.use(
  cors({
    origin: "*",
    methods: ["GET"],
  })
);
app.use(express.json());

if (!photosFolder || !path.isAbsolute(photosFolder)) {
  console.error("Error: IMAGES_FOLDER path is invalid.");
  process.exit(1);
}

app.use(express.static(photosFolder));

app.get("/api/search", async (req, res) => {
  const {
    query = "",
    min = "",
    max = "",
    startDate = "",
    endDate = "",
  } = req.query;
  const conditions = [];
  const parameters = [];

  if (query.trim()) {
    conditions.push("document_number LIKE ?");
    parameters.push(`%${query.trim()}%`);
  }

  if (min.trim() && max.trim()) {
    const minNumber = Number.parseInt(min, 10);
    const maxNumber = Number.parseInt(max, 10);

    if (
      !Number.isSafeInteger(minNumber) ||
      !Number.isSafeInteger(maxNumber) ||
      minNumber > maxNumber
    ) {
      return res.status(400).json({ error: "Invalid number range." });
    }

    conditions.push(
      "CAST(document_number AS UNSIGNED) BETWEEN ? AND ?"
    );
    parameters.push(minNumber, maxNumber);
  }

  if (startDate.trim() && endDate.trim()) {
    conditions.push(
      "created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)"
    );
    parameters.push(
      `${startDate.trim()} 00:00:00`,
      `${endDate.trim()} 00:00:00`
    );
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const [rows] = await pool.execute(
      `SELECT storage_path
       FROM delivery_documents
       ${whereClause}
       ORDER BY created_at DESC`,
      parameters
    );

    res.json({ photos: rows.map((row) => row.storage_path) });
  } catch (error) {
    console.error("Error searching for photos:", error);
    res.status(500).json({ error: "Failed to search photos." });
  }
});

app.get("/api/checkMissing", async (req, res) => {
  const startNumber = Number.parseInt(req.query.start, 10);
  const endNumber = Number.parseInt(req.query.end, 10);

  if (
    !Number.isSafeInteger(startNumber) ||
    !Number.isSafeInteger(endNumber) ||
    startNumber > endNumber
  ) {
    return res.status(400).json({ error: "Invalid range values." });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT DISTINCT document_number
       FROM delivery_documents
       WHERE CAST(document_number AS UNSIGNED) BETWEEN ? AND ?`,
      [startNumber, endNumber]
    );
    const existingNumbers = new Set(
      rows.map((row) => Number(row.document_number))
    );
    const missing = [];

    for (let number = startNumber; number <= endNumber; number += 1) {
      if (!existingNumbers.has(number)) {
        missing.push(number);
      }
    }

    res.json({ missing });
  } catch (error) {
    console.error("Error checking missing range:", error);
    res.status(500).json({ error: "Failed to check missing range." });
  }
});

await initializeDatabase();

app.listen(port, "0.0.0.0", () => {
  const localIP = getLocalIP();
  console.log(`Server running at:
  - Localhost: http://localhost:${port}
  - Network: http://${localIP}:${port}`);
});
