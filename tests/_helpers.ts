import type { DatabaseConfig } from "@boringos/db";

export function testDbConfig(dataDir: string, port: number): DatabaseConfig {
  return process.env.TEST_DATABASE_URL
    ? { url: process.env.TEST_DATABASE_URL }
    : { embedded: true as const, dataDir, port };
}
