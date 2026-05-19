import express from "express";
import { VercelRequest, VercelResponse } from "@vercel/node";
import handler from "./api/proxy.js"; // Note: Vercel functions use .ts, but in Node we might need to handle the import
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3001; // We run the API on 3001 and Vite proxies 3000 -> 3001?
// Actually AI Studio exposes 3000. So we should run Vite on 3000 and the API on something else, 
// OR run a single server that handles both.

// Let's use the single-server-with-vite-middleware pattern, it's most robust for AI Studio.
// But we'll keep the logic in api/proxy.ts so Vercel can use it.

import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // API Routes - Forward to the Vercel handler logic
  app.all("/api/*", (req, res) => {
    // Mock the Vercel request/response objects if needed
    // Since api/proxy.ts expects VercelRequest/VercelResponse
    handler(req as any, res as any);
  });

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
