import express from "express";
import fs from "fs/promises";
import path from "path";
import cors from "cors";
import config from "config";
import os from "os";

const app = express();
const port = process.env.PORT || 7000;
const photosFolder = config.get("configs.IMAGES_FOLDER");

// Helper function to get local IP address for easier access in the network
const getLocalIP = () => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost"; // Fallback
};

// Middleware
app.use(
  cors({
    origin: "*", // Allow access from any origin (adjust for security)
    methods: ["GET"],
  })
);
app.use(express.json());

// Verify `photosFolder` path is correctly resolved
if (!photosFolder || !path.isAbsolute(photosFolder)) {
  console.error("Error: IMAGES_FOLDER path is invalid.");
  process.exit(1);
}

// Serve photos statically – This allows frontend to request them via http://<server-ip>:7000/<photo>
app.use(express.static(photosFolder));

app.get("/api/search", async (req, res) => {
  const { query = "", min = "", max = "", startDate = "", endDate = "" } = req.query;

  try {
    const files = await fs.readdir(photosFolder);
    let matchedPhotos = files.filter(file => /\.(jpg|png)$/i.test(file));

    if (query.trim()) {
      matchedPhotos = matchedPhotos.filter(file =>
        file.toLowerCase().includes(query.toLowerCase())
      );
    }

    if (min.trim() && max.trim()) {
      const minNum = parseInt(min, 10);
      const maxNum = parseInt(max, 10);
      matchedPhotos = matchedPhotos.filter(file => {
        const numberMatch = file.match(/\d+/);
        return numberMatch && parseInt(numberMatch[0], 10) >= minNum && parseInt(numberMatch[0], 10) <= maxNum;
      });
    }

    if (startDate.trim() && endDate.trim()) {
      const filesWithDates = await Promise.all(
        matchedPhotos.map(async file => {
          const filePath = path.join(photosFolder, file);
          const stats = await fs.stat(filePath);
          return { file, fileCreatedDate: stats.birthtime.toISOString().split("T")[0] };
        })
      );

      matchedPhotos = filesWithDates
        .filter(item => item.fileCreatedDate >= startDate && item.fileCreatedDate <= endDate)
        .map(item => item.file);
    }

    res.json({ photos: matchedPhotos });
  } catch (err) {
    console.error("Error searching for photos:", err);
    res.status(500).json({ error: "Failed to search photos." });
  }
});

// Start the server and make it accessible on the network
app.listen(port, "0.0.0.0", () => {
  const localIP = getLocalIP();
  console.log(`Server running at:
  - Localhost: http://localhost:${port}
  - Network: http://${localIP}:${port}`);
});
