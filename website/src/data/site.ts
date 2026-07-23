export const PANEL_URL = import.meta.env.VITE_PANEL_URL || 'http://localhost:8081';
export const REPO_URL = 'https://github.com/SarhadCodes/Kurdlogs-core.git';
export const REPO_PAGE_URL = 'https://github.com/SarhadCodes/Kurdlogs-core';

export const screenshots = [
  {
    src: '/screenshots/dashboard.png',
    alt: 'KurdLogs Core dashboard overview',
    title: 'Dashboard',
    caption: 'Live channel health, uptime, and infrastructure at a glance.',
  },
  {
    src: '/screenshots/channels.png',
    alt: 'Channel live preview with metrics',
    title: 'Channels',
    caption: 'Preview streams with CPU, bitrate, and health in one place.',
  },
  {
    src: '/screenshots/playlists.png',
    alt: 'Playlist management screen',
    title: 'Playlists',
    caption: 'Build 24/7 schedules with looping and ordered items.',
  },
  {
    src: '/screenshots/blueprints.png',
    alt: 'Channel blueprint designer',
    title: 'Blueprints',
    caption: 'Design channel behavior without hand-writing FFmpeg graphs.',
  },
  {
    src: '/screenshots/monitoring.png',
    alt: 'System monitoring overview',
    title: 'Monitoring',
    caption: 'CPU, memory, and channel playback status in real time.',
  },
] as const;

export const features = [
  {
    title: 'Channel control',
    body: 'Manage M3U8, MP4, RTMP, and more from a single operator panel built for broadcast teams.',
  },
  {
    title: '24/7 playlists',
    body: 'Schedule continuous channels with looping playlists and blueprints that keep content moving.',
  },
  {
    title: 'Live transcoding',
    body: 'Adaptive HLS ladders via FFmpeg so every screen gets the right quality.',
  },
  {
    title: 'Secure delivery',
    body: 'Tokenized HLS URLs with auto-refresh so streams stay protected without breaking players.',
  },
  {
    title: 'Overlays & branding',
    body: 'Logos, LIVE badges, and brand profiles applied where your audience sees them.',
  },
  {
    title: 'Operator monitoring',
    body: 'WebSocket-backed CPU, RAM, bitrate, and FPS so you catch issues before viewers do.',
  },
] as const;

export const faqItems = [
  {
    q: 'What is KurdLogs Core?',
    a: 'KurdLogs Core is a self-hosted IPTV and broadcast control panel. It helps you run channels, playlists, blueprints, transcoding, overlays, tokens, and monitoring from one modern UI.',
  },
  {
    q: 'Is it self-hosted?',
    a: 'Yes. You run it on your own machine or VPS with Docker. Your media, credentials, and streams stay under your control.',
  },
  {
    q: 'What do I need to install it?',
    a: 'Docker and Docker Compose (plus Git to clone the repo). On Windows/macOS download Docker Desktop; on Linux install Docker Engine. The Docs page has direct download links. The stack includes PostgreSQL, the API, the panel, and NGINX RTMP.',
  },
  {
    q: 'How do I log in the first time?',
    a: 'After containers are up, open the panel URL (default http://localhost:8081) and sign in with admin / admin123. Change the password in Settings immediately.',
  },
  {
    q: 'Can I run it alongside Flussonic or other media servers?',
    a: 'Yes. KurdLogs uses HTTP port 8081 and RTMP publish port 1936 by default so it can sit next to services that already use 80 or 1935.',
  },
  {
    q: 'Does it support automated TV channels?',
    a: 'Yes. Use playlists and channel blueprints to design continuous movie, music, or kids channels without writing FFmpeg graphs by hand.',
  },
  {
    q: 'Is there a license fee?',
    a: 'The project is MIT licensed. You can use, modify, and deploy it for your own broadcast operations.',
  },
] as const;

export const team: {
  name: string;
  role: string;
  bio: string;
  initials: string;
  photo?: string;
}[] = [
  {
    name: 'Sarhad',
    role: 'Founder & CEO',
    bio: 'Leads KurdLogs Core end to end — product direction, operator experience, and the self-hosted stack that keeps channels on air.',
    initials: 'SA',
    photo: '/images/team/sarhad.png',
  },
  {
    name: 'KurdLogs Team',
    role: 'Engineering & operations',
    bio: 'Builds and runs the panel: streaming pipelines, Docker delivery, monitoring, and the tools broadcast teams use every day.',
    initials: 'KL',
    photo: '/images/team/kurdlogs-team-wave-v3.png',
  },
];

export const requirements = [
  {
    name: 'KurdLogs Core',
    platform: 'GitHub',
    detail: 'Clone the official repository — source, Docker Compose files, and deploy scripts.',
    href: 'https://github.com/SarhadCodes/Kurdlogs-core',
    cta: 'Open on GitHub',
  },
  {
    name: 'Docker Desktop',
    platform: 'Windows & macOS',
    detail: 'Includes Docker Engine and Compose — the easiest way to run KurdLogs locally.',
    href: 'https://www.docker.com/products/docker-desktop/',
    cta: 'Download Docker Desktop',
  },
  {
    name: 'Docker Engine',
    platform: 'Linux / VPS',
    detail: 'Install Engine with the Compose plugin for servers. Follow the guide for your distro.',
    href: 'https://docs.docker.com/engine/install/',
    cta: 'Install Docker Engine',
  },
  {
    name: 'Git',
    platform: 'All platforms',
    detail: 'Required to clone the KurdLogs Core repository from GitHub.',
    href: 'https://git-scm.com/downloads',
    cta: 'Download Git',
  },
  {
    name: 'WSL 2',
    platform: 'Windows',
    detail: 'Required by Docker Desktop on Windows. Install if the Docker setup asks for it.',
    href: 'https://learn.microsoft.com/en-us/windows/wsl/install',
    cta: 'Install WSL',
  },
] as const;

export const installSteps = [
  {
    title: 'Install Docker',
    detail:
      'Download Docker from the links above. On Windows/macOS use Docker Desktop; on Linux use Docker Engine + Compose. Confirm with `docker --version` and `docker compose version`.',
  },
  {
    title: 'Get the project',
    detail:
      'Clone https://github.com/SarhadCodes/Kurdlogs-core.git then open a terminal in the project root (the folder that contains `docker-compose.yml`).',
  },
  {
    title: 'Configure environment (optional)',
    detail:
      'Copy `.env.example` to `.env` if present, or create `.env` with `JWT_SECRET`, `POSTGRES_PASSWORD`, and `HTTP_PORT=8081`. Defaults work for local testing.',
  },
  {
    title: 'Build and start',
    detail:
      'On Windows run `.\\deploy-local.cmd`. On Linux/VPS run `sudo ./install.sh`. Or use `docker compose build` then `docker compose up -d`. Wait until Postgres is healthy.',
  },
  {
    title: 'Open the panel',
    detail:
      'Visit http://localhost:8081 (or your `HTTP_PORT`). Hard refresh once after the first build. Sign in with admin / admin123.',
  },
  {
    title: 'Secure and verify',
    detail:
      'Change the admin password in Settings. Create a channel or playlist, confirm Monitoring shows CPU/memory, and check the sidebar build version after updates.',
  },
] as const;

export const installCommands = [
  {
    label: 'Clone repository',
    code: 'git clone https://github.com/SarhadCodes/Kurdlogs-core.git\ncd Kurdlogs-core',
  },
  {
    label: 'Windows (branded CLI)',
    code: '.\\deploy-local.cmd',
  },
  {
    label: 'Linux / VPS (branded CLI)',
    code: 'sudo ./install.sh',
  },
  {
    label: 'Docker Compose',
    code: 'docker compose build frontend backend nginx-rtmp\ndocker compose up -d',
  },
  {
    label: 'Check status',
    code: 'docker compose ps frontend backend nginx-rtmp',
  },
] as const;
