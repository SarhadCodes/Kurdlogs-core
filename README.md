# KurdLogs Core 📺

![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![FFmpeg](https://img.shields.io/badge/FFmpeg-007808?style=for-the-badge&logo=ffmpeg&logoColor=white)
![NGINX](https://img.shields.io/badge/NGINX-009639?style=for-the-badge&logo=nginx&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)

A lightweight, modern, self-hosted IPTV management panel for restreaming, transcoding, and 24/7 automated TV channels.

## Features

- **Modern Dashboard**: Dark theme, glassmorphism UI with live stream previews and stats.
- **Channel Management**: Support for M3U8, MP4, RTMP, MPEG-TS, SRT, UDP, HTTP.
- **24/7 Playlists**: Drag-and-drop scheduling for automated channels.
- **Live Transcoding**: Adaptive HLS (1080p, 720p, 480p) via FFmpeg.
- **Overlays**: Add logos, scrolling text, LIVE badges, and watermarks dynamically.
- **Tokenized Streams**: Secure HLS URLs with auto-refreshing tokens.
- **Monitoring**: Real-time CPU, RAM, bitrate, and FPS tracking via WebSockets.
- **Auto-Reconnect**: Automatically restart streams on crash or source failure.

## Architecture

```mermaid
graph TB
    UI["Frontend (React)"] <--> API["Backend API"]
    UI <--> WS["WebSockets"]
    API <--> DB["PostgreSQL"]
    API --> FFM["FFmpeg"]
    FFM -->|HLS| NGINX["NGINX RTMP"]
    UI -->|Playback| NGINX
```

## Quick Start (Docker)

1. Clone the repository
2. Run the installation script:
```bash
sudo ./install.sh
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `JWT_SECRET` | Secret key for auth | (random) |
| `DATABASE_URL` | Postgres connection string | `postgresql://...` |
| `FFMPEG_PATH` | Path to FFmpeg executable | `ffmpeg` |
| `STREAMS_DIR` | Output directory for HLS | `/var/streams` |

## Default Credentials
- **User:** `admin`
- **Pass:** `admin123`

## License
MIT
