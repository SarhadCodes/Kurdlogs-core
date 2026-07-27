export interface OnboardingStep {
  id: string;
  path: string;
  navTarget?: string;
  title: string;
  summary: string;
  steps: string[];
}

export const ONBOARDING_STORAGE_VERSION = 'v1';

export const onboardingSteps: OnboardingStep[] = [
  {
    id: 'welcome',
    path: '/',
    title: 'Welcome to KurdLogs Core',
    summary: 'A quick tour of every section in the panel. You can skip anytime.',
    steps: [
      'Use the sidebar (or menu on mobile) to move between sections.',
      'Each step opens the page and explains what it is for.',
      'You can replay this guide later from Settings.',
    ],
  },
  {
    id: 'dashboard',
    path: '/',
    navTarget: '/',
    title: 'Dashboard',
    summary: 'Your control-room overview after sign-in.',
    steps: [
      'See how many channels, playlists, and tokens you have at a glance.',
      'Check which channels are live, offline, or in error.',
      'Use quick actions to jump into Channels or refresh stats.',
    ],
  },
  {
    id: 'channels',
    path: '/channels',
    navTarget: '/channels',
    title: 'Channels',
    summary: 'Create and manage live or playlist-driven TV channels.',
    steps: [
      'Create a channel and pick playlist mode or a live source URL.',
      'Start, stop, or restart streams from the channel card.',
      'Open a channel to edit preview, settings, logs, and output links.',
    ],
  },
  {
    id: 'playlists',
    path: '/playlists',
    navTarget: '/playlists',
    title: 'Playlists',
    summary: 'Build 24/7 automated channels from videos and media files.',
    steps: [
      'Create a playlist and add items by upload or file path.',
      'Drag items to reorder playback.',
      'Assign the playlist when creating or editing a channel.',
    ],
  },
  {
    id: 'blueprints',
    path: '/blueprints',
    navTarget: '/blueprints',
    title: 'Blueprint',
    summary: 'Design advanced channel layouts with a visual block editor.',
    steps: [
      'Compose sources, transitions, and outputs on the canvas.',
      'Simulate the timeline before publishing.',
      'Publish a blueprint to spawn a ready-made channel.',
    ],
  },
  {
    id: 'transcoding',
    path: '/transcoding',
    navTarget: '/transcoding',
    title: 'Transcoding',
    summary: 'Encoding profiles used when channels output adaptive streams.',
    steps: [
      'Review default profiles for 1080p, 720p, and 480p.',
      'Create custom bitrates and resolutions if needed.',
      'Assign profiles on individual channels in channel settings.',
    ],
  },
  {
    id: 'tokens',
    path: '/tokens',
    navTarget: '/tokens',
    title: 'Tokens',
    summary: 'Secure embed and playback access for your streams.',
    steps: [
      'Create tokens for players, websites, or partner apps.',
      'Set expiry and allowed origins where supported.',
      'Copy embed URLs from channel output links when publishing.',
    ],
  },
  {
    id: 'overlays',
    path: '/overlays',
    navTarget: '/overlays',
    title: 'Overlays',
    summary: 'Lower-thirds, logos, and on-screen graphics for channels.',
    steps: [
      'Upload PNG/WebP assets for logos and bugs.',
      'Position overlays per channel or brand profile.',
      'Preview overlays on live channel output when streaming.',
    ],
  },
  {
    id: 'branding',
    path: '/brand-profiles',
    navTarget: '/brand-profiles',
    title: 'Branding',
    summary: 'Reusable brand packages for consistent channel identity.',
    steps: [
      'Save colors, logos, and typography presets.',
      'Attach a brand profile to channels for unified styling.',
      'Reuse the same look across multiple outputs.',
    ],
  },
  {
    id: 'processing',
    path: '/processing',
    navTarget: '/processing',
    title: 'Processing',
    summary: 'Track playlist normalization and background media jobs.',
    steps: [
      'Watch FFmpeg jobs convert uploads to H.264/AAC.',
      'See which playlist items are ready, queued, or failed.',
      'Retry or replace items that did not normalize cleanly.',
    ],
  },
  {
    id: 'monitoring',
    path: '/monitoring',
    navTarget: '/monitoring',
    title: 'Monitoring',
    summary: 'Server health, stream metrics, and runtime diagnostics.',
    steps: [
      'Monitor CPU, memory, and disk for the stack.',
      'Inspect per-channel bitrate, FPS, and uptime.',
      'Use this page when troubleshooting unstable streams.',
    ],
  },
  {
    id: 'benchmark',
    path: '/benchmark',
    navTarget: '/benchmark',
    title: 'Benchmark',
    summary: 'Stress-test encoding paths before going live.',
    steps: [
      'Run sample transcodes to compare preset performance.',
      'Validate hardware or CPU headroom on your host.',
      'Optional — skip if you are not tuning performance yet.',
    ],
  },
  {
    id: 'settings',
    path: '/settings',
    navTarget: '/settings',
    title: 'Settings',
    summary: 'Profile, password, and optional security preferences.',
    steps: [
      'Update your display name and avatar.',
      'Change your password whenever you want.',
      'MFA is optional — enable it only if you choose to.',
    ],
  },
  {
    id: 'install',
    path: '/install',
    navTarget: '/install',
    title: 'Install app',
    summary: 'Add KurdLogs to your home screen as a PWA.',
    steps: [
      'Install on desktop or mobile for a full-screen panel.',
      'Follow the browser-specific steps shown on this page.',
      'Works great for operators who keep the panel open all day.',
    ],
  },
  {
    id: 'finish',
    path: '/',
    navTarget: '/',
    title: 'You are ready to broadcast',
    summary: 'That covers every main section of the panel.',
    steps: [
      'Start on Dashboard, then create your first channel.',
      'Reopen this guide anytime from Settings → Panel guide.',
      'Need help? Check Monitoring if something looks off.',
    ],
  },
];
