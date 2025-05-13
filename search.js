import express from "express";
import fs from "fs/promises";
import path from "path";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname } from "path";

// Set up __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const port = process.env.PORT || 5000;
const photosFolder = path.join(__dirname, "images"); // Absolute path for the images folder

app.use(cors());
app.use(express.json());
// Serve photos statically – this allows your frontend to request them via http://localhost:5000/<photo>
app.use(express.static(photosFolder));

/*
  API: Search Photos by Name, Number Range, and Created Date Range
  - Query parameter "query" is used for text search within filenames.
  - Query parameters "min" and "max" are optional; when both are provided, the API filters images 
    whose first found number in the filename is between min and max (inclusive).
  - Query parameters "startDate" and "endDate" are optional; when provided (in format YYYY-MM-DD),
    the API filters images whose creation date (based on birthtime) falls within that range.
*/
app.get("/api/search", async (req, res) => {
  // Destructure query parameters with defaults.
  const { query = "", min = "", max = "", startDate = "", endDate = "" } = req.query;

  try {
    const files = await fs.readdir(photosFolder);
    // Filter only image files (jpg and png)
    let matchedPhotos = files.filter(file => /\.(jpg|png)$/i.test(file));

    // Filter by text query, if provided.
    if (query.trim() !== "") {
      matchedPhotos = matchedPhotos.filter(file =>
        file.toLowerCase().includes(query.toLowerCase())
      );
    }

    // Filter by range of numbers in the filename, if both min and max are provided.
    if (min.trim() !== "" && max.trim() !== "") {
      const minNum = parseInt(min, 10);
      const maxNum = parseInt(max, 10);
      matchedPhotos = matchedPhotos.filter(file => {
        // Extract the first number found in the filename
        const numberMatch = file.match(/\d+/);
        if (numberMatch) {
          const num = parseInt(numberMatch[0], 10);
          return num >= minNum && num <= maxNum;
        }
        return false; // Exclude files that don't have a number
      });
    }

    // If both startDate and endDate are provided, filter based on file's creation date.
    if (startDate.trim() !== "" && endDate.trim() !== "") {
      // For each matched file, get its creation date as a YYYY-MM-DD string
      const filesWithDates = await Promise.all(
        matchedPhotos.map(async file => {
          const filePath = path.join(photosFolder, file);
          const stats = await fs.stat(filePath);
          // Format birthtime to "YYYY-MM-DD"
          const fileCreatedDate = stats.birthtime.toISOString().split("T")[0];
          return { file, fileCreatedDate };
        })
      );
      // Filter files whose created date falls within the range (inclusive)
      matchedPhotos = filesWithDates
        .filter(item => {
          return item.fileCreatedDate >= startDate && item.fileCreatedDate <= endDate;
        })
        .map(item => item.file);
    }

    res.json({ photos: matchedPhotos });
  } catch (err) {
    console.error("Error searching for photos:", err);
    res.status(500).json({ error: "Failed to search photos." });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
