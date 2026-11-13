import { resolve } from "node:path";
import { networkInterfaces } from "node:os";
import express from "express";
import { createStore } from "./store";
import { createApp } from "./app";

const root = process.cwd(),
  data = resolve(process.env.DATA_DIR || "data");
const store = createStore(data, root),
  app = createApp(store);
const dev = process.argv.includes("--dev");
if (dev) {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  app.use(
    express.static(resolve(root, "dist"), {
      maxAge: "1h",
      setHeaders(res, path) {
        if (path.endsWith("index.html"))
          res.setHeader("Cache-Control", "no-cache");
      },
    }),
  );
  app.get("/{*path}", (_req, res) =>
    res.sendFile(resolve(root, "dist/index.html")),
  );
}
const port = Number(process.env.PORT || 4173),
  host = process.env.HOST || "0.0.0.0";
const server = app.listen(port, host, () => {
  console.log(`Tilemaxx: http://localhost:${port}`);
  if (host === "0.0.0.0")
    for (const interfaces of Object.values(networkInterfaces()))
      for (const nic of interfaces || [])
        if (nic.family === "IPv4" && !nic.internal)
          console.log(`Network: http://${nic.address}:${port}`);
  console.log(`Data: ${data}`);
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () =>
    server.close(() => {
      store.db.close();
      process.exit(0);
    }),
  );
