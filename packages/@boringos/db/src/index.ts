export type {
  DatabaseConfig,
  MigrationManager,
  MigrationInfo,
  MigrationResult,
  FrameworkTable,
} from "./types.js";

export { FRAMEWORK_TABLES } from "./types.js";

export { createDatabase } from "./connection.js";
export type { Db, DatabaseConnection } from "./connection.js";

export { createMigrationManager } from "./migrate.js";

export { packCredentials, unpackCredentials } from "./credentials.js";

export * from "./schema/index.js";
