import dotenv from "dotenv"
import "dotenv/config";

dotenv.config({
  path: "../../.env",
});

import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",

  migrations: {
    path: "prisma/migrations",
  },

  datasource: {
    url: env("DIRECT_URL"),
  },
});
