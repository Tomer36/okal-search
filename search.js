import express from "express";
import fs from "fs/promises";
import path from "path";
import cors from "cors";
// import config from "config";

const app = express();
const port = process.env.PORT || 5000;
// const photosFolder = config.get("configs.PHOTOS_FOLDER"); // Set the path of the photos folder
const photosFolder = "images"

app.use(cors());
app.use(express.json());
app.use(express.static(photosFolder)); // Serve photos statically

// API: Search Photos by Name
app.get("/api/search", async (req, res) => {
  const { query } = req.query; // Get search query
  if (!query) return res.status(400).json({ error: "Search query is required." });

  try {
    const files = await fs.readdir(photosFolder);
    const matchedPhotos = files.filter(file =>
      file.toLowerCase().includes(query.toLowerCase()) && /\.(jpg|png)$/i.test(file)
    );

    res.json({ photos: matchedPhotos });
  } catch (err) {
    console.error("Error searching for photos:", err);
    res.status(500).json({ error: "Failed to search photos." });
  }
});

// Start Server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
