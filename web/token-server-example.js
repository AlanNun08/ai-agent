/**
 * Optional Express server for secure WebRTC token minting.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=... node web/token-server-example.js
 */

import express from "express";

const app = express();
const port = process.env.PORT || 3000;

app.get("/api/elevenlabs/conversation-token", async (_req, res) => {
  try {
    const response = await fetch(
      "https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=agent_0301k5n5zm13evpbc6rfzj78q0bt",
      {
        method: "GET",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY || "",
        },
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text || "Failed to mint token" });
    }

    const data = await response.json();
    return res.json(data);
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown server error",
    });
  }
});

app.listen(port, () => {
  console.log(`Token server running on http://localhost:${port}`);
});
