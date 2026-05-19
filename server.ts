import express from "express";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import handler from "./api/proxy.js";

dotenv.config();

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // API Route Dispatcher
  app.all("/api/*", (req, res) => handler(req as any, res as any));

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile("dist/index.html", { root: "." });
    });
  }

  app.listen(3000, "0.0.0.0", () => {
    console.log("Dev server running on http://localhost:3000");
  });
}

startServer();
