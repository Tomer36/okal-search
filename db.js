import mysql from "mysql2/promise";
import config from "config";

const pool = mysql.createPool({
  host: config.get("db.host"),
  port: config.get("db.port"),
  user: config.get("db.user"),
  password: config.get("db.password"),
  database: config.get("db.name"),
  waitForConnections: true,
  connectionLimit: 10,
});

export async function initializeDatabase() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS delivery_documents (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      document_number VARCHAR(50) NOT NULL,
      storage_path VARCHAR(500) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_delivery_documents_storage_path (storage_path),
      KEY idx_delivery_documents_number (document_number),
      KEY idx_delivery_documents_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

export default pool;
