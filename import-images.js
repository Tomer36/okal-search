import fs from "fs/promises";
import path from "path";
import config from "config";
import pool, { initializeDatabase } from "./db.js";

const photosFolder = config.get("configs.IMAGES_FOLDER");
const batchSize = 500;

async function findImages(folder) {
  const images = [];
  const entries = await fs.readdir(folder, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(folder, entry.name);

    if (entry.isDirectory()) {
      images.push(...(await findImages(fullPath)));
    } else if (entry.isFile() && /\.(jpg|jpeg|png)$/i.test(entry.name)) {
      images.push(fullPath);
    }
  }

  return images;
}

async function importBatch(imagePaths) {
  const rows = await Promise.all(
    imagePaths.map(async (fullPath) => {
      const stats = await fs.stat(fullPath);
      const extension = path.extname(fullPath);
      const documentNumber = path.basename(fullPath, extension);
      const storagePath = path
        .relative(photosFolder, fullPath)
        .replaceAll("\\", "/");

      return [documentNumber, storagePath, stats.birthtime];
    })
  );

  const placeholders = rows.map(() => "(?, ?, ?)").join(", ");
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO delivery_documents
         (document_number, storage_path, created_at)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         document_number = VALUES(document_number),
         created_at = VALUES(created_at)`,
      rows.flat()
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

try {
  await initializeDatabase();

  console.log(`Scanning image folder: ${photosFolder}`);
  const imagePaths = await findImages(photosFolder);
  console.log(`Found ${imagePaths.length.toLocaleString()} images.`);

  let imported = 0;
  for (let index = 0; index < imagePaths.length; index += batchSize) {
    const batch = imagePaths.slice(index, index + batchSize);
    await importBatch(batch);
    imported += batch.length;
    console.log(
      `Imported ${imported.toLocaleString()} / ${imagePaths.length.toLocaleString()}`
    );
  }

  const [rows] = await pool.query(
    "SELECT COUNT(*) AS count FROM delivery_documents"
  );
  console.log(`Import complete. Database rows: ${rows[0].count}`);
} catch (error) {
  console.error("Image import failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
