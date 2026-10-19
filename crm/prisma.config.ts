import "dotenv/config";
import { defineConfig } from "prisma/config";

// DATABASE_URL may be absent during `prisma generate` (for example on install), so it is optional here.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
