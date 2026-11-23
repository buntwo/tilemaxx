import { resolve } from "node:path";
import { networkInterfaces } from "node:os";
import express from "express";
import { createStore } from "./store";
import { createApp } from "./app";

const root = process.cwd(),
  data = resolve(process.env.DATA_DIR || "data");
const { TILEMAXX_API_TOKEN: token, TILEMAXX_WEB_PASSWORD: browserPassword } =
  process.env;
const credentials = token !== undefined || browserPassword !== undefined
  ? { token: token ?? "", browserPassword: browserPassword ?? "" }
  : undefined;
const store = createStore(data, root),
  app = createApp(store, { credentials, root });
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
      maxAge: credentials ? 0 : "1h",
      setHeaders(res, path) {
        if (credentials) res.setHeader("Cache-Control", "private, no-store");
        else if (path.endsWith("index.html") || path.endsWith("sw.js"))
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
