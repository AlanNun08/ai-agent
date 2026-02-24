# AI Real Estate Assistant Deployment

This repository contains a ready-to-ship web deployment for the **ElevenLabs Conversational AI Agent**:

- **Agent name:** AI Real Estate Assistant
- **Agent ID:** `agent_0301k5n5zm13evpbc6rfzj78q0bt`

## Quick start

Serve the `web/` folder from any static hosting provider (Vercel, Netlify, GitHub Pages, S3+CloudFront, Nginx, etc.).

### Local preview

```bash
python3 -m http.server 8080 --directory web
```

Open: <http://localhost:8080>

## What is included

- `web/index.html`: embeddable ElevenLabs widget integration using your agent ID.
- `web/token-server-example.js`: optional secure token endpoint for WebRTC-based SDK sessions.

## Production note

The embeddable widget in `web/index.html` does not require exposing your ElevenLabs API key in the browser.
If you later move to the React/React Native SDK with WebRTC, use the token server example to mint short-lived conversation tokens server-side.
