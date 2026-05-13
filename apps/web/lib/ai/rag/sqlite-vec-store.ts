/**
 * SQLite-vec Vector Store — app-side re-export layer.
 * Wires app-specific TAURI_DB_PATH and schema into the @openloomi/rag package.
 */

import { TAURI_DB_PATH } from "@/lib/utils/path";
import * as schema from "@/lib/db/schema-sqlite";
import { configureVectorService } from "@openloomi/rag/vector-service";
import {
  getSQLiteVecStore as pkgGetSQLiteVecStore,
  resetSQLiteVecStore,
  SQLiteVecStore,
  type VectorSearchResult,
  type DocumentChunk,
} from "@openloomi/rag/sqlite-vec-store";

// Configure vector-service with the app's SQLite store
configureVectorService({
  getStore: () => pkgGetSQLiteVecStore(TAURI_DB_PATH, schema as any),
});

export {
  SQLiteVecStore,
  resetSQLiteVecStore,
  type VectorSearchResult,
  type DocumentChunk,
};

// Re-export with app-specific wiring
export async function getSQLiteVecStore(): Promise<SQLiteVecStore> {
  return await pkgGetSQLiteVecStore(TAURI_DB_PATH, schema as any);
}
