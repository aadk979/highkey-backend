import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { dbPool } from "./db/pool.js";

async function start() {
  const app = await buildApp();

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
  } catch (error) {
    app.log.error({ error }, "Failed to start server");
    process.exitCode = 1;
  }

  const shutdown = async () => {
    app.log.info("Graceful shutdown started");
    await app.close();
    await dbPool.end();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

void start();
