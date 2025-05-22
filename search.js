import express from "express";
import fs from "fs/promises";
import path from "path";
import cors from "cors";
import config from "config";
import os from "os";

// New imports for PDF generation and sending mail
import PDFDocument from "pdfkit";
import fsSync from "fs";
import axios from "axios";
import FormData from "form-data";

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

/*
  New Endpoint:
  /api/generate-and-send-pdf
  This endpoint:
  1. Repeats your search logic (using the same criteria as /api/search) to retrieve matching images.
  2. Generates a PDF document listing the found image names.
  3. Sends that PDF as an attachment through your mail microservice (via your API gateway route).
  
  The request body should contain:
    - query, min, max, startDate, endDate: search parameters (same as /api/search)
    - to: the recipient email address
*/
app.post("/api/generate-and-send-pdf", async (req, res) => {
  const { query = "", min = "", max = "", startDate = "", endDate = "", to } = req.body;

  if (!to) {
    return res.status(400).json({ error: "Recipient email ('to') is required." });
  }

  try {
    // --- Step 1: Search for images with the same logic ---
    const files = await fs.readdir(photosFolder);
    let matchedPhotos = files.filter(file => /\.(jpg|png)$/i.test(file));

    if (query.trim()) {
      matchedPhotos = matchedPhotos.filter(file => file.toLowerCase().includes(query.toLowerCase()));
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

    if (matchedPhotos.length === 0) {
      return res.status(404).json({ error: "No images found for the given search criteria." });
    }

    // --- Step 2: Generate PDF from the search results ---
    const pdfPath = path.join(__dirname, "search_results.pdf");
    const doc = new PDFDocument();
    const writeStream = fsSync.createWriteStream(pdfPath);
    doc.pipe(writeStream);
    
    doc.fontSize(18).text("Search Results", { align: "center" });
    doc.moveDown();
    matchedPhotos.forEach(file => {
      doc.fontSize(12).text(file);
    });
    doc.end();

    // Wait for the PDF file to be fully written
    writeStream.on("finish", async () => {
      // --- Step 3: Send the generated PDF via the mail microservice through the API gateway ---
      // Assuming your API gateway route for email forwarding is: http://localhost:<DEFAULT_PORT>/route-mail
      // (Make sure the DEFAULT_PORT setting in your config is set accordingly)
      const gatewayPort = config.get("configs.DEFAULT_PORT");
      const mailGatewayUrl = `http://localhost:${gatewayPort}/route-mail`;

      // Create a multipart/form-data payload
      const formData = new FormData();
      formData.append("to", to);
      formData.append("subjectType", "searchResults");
      formData.append("info", `Search results for query "${query}"`);
      formData.append("attachment", fsSync.createReadStream(pdfPath));

      try {
        const response = await axios.post(mailGatewayUrl, formData, {
          headers: formData.getHeaders(),
        });
        res.json({ message: "PDF generated and email sent successfully", mailResponse: response.data });
      } catch (mailErr) {
        console.error("Error sending mail via gateway:", mailErr);
        res.status(500).json({ error: "Failed to send email", details: mailErr.toString() });
      }
    });

    writeStream.on("error", (streamErr) => {
      console.error("Error generating PDF:", streamErr);
      res.status(500).json({ error: "Failed to generate PDF", details: streamErr.toString() });
    });
  } catch (err) {
    console.error("Error processing generate-and-send-pdf request:", err);
    res.status(500).json({ error: "Internal server error", details: err.toString() });
  }
});

// Start the server and make it accessible on the network
app.listen(port, "0.0.0.0", () => {
  const localIP = getLocalIP();
  console.log(`Server running at:
  - Localhost: http://localhost:${port}
  - Network: http://${localIP}:${port}`);
});
