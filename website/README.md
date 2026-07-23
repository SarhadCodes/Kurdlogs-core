# KurdLogs Core — Marketing website

Premium promotional site for KurdLogs Core (React + Vite + Tailwind + shadcn/ui).

## Pages

- `/` — Product landing with real panel screenshots
- `/about` — Product story
- `/team` — Team
- `/faq` — FAQ (shadcn Accordion)
- `/docs` — Step-by-step install guide

## Local development

```bash
cd website
npm install
npm run dev
```

Dev server defaults to http://localhost:5174

Optional: `VITE_PANEL_URL=http://localhost:8081`

## Docker

Served on port **8082** via Compose:

```bash
docker compose build website
docker compose up -d website
```

Open http://localhost:8082
