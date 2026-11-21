// refs analysis parameters. Reported in analysis.json so results are reproducible.
export const SCENE_THRESHOLD = 0.12;     // ffmpeg scene score above which a frame starts a new shot (0.3 missed dark-UI cuts scoring 0.14-0.17)
export const MIN_CUT_GAP_SECONDS = 0.2;  // cuts closer than this are merged (fades emit several)
export const FRAME_INTERVAL_SECONDS = 0.5;
export const FRAME_WIDTH = 480;
export const PALETTE_SIZE = 6;
export const PALETTE_LEVELS = 8;         // quantization levels per RGB channel
export const PALETTE_SAMPLE_FPS = 1;
export const PALETTE_THUMB_WIDTH = 32;
export const MOTION_SAMPLE_FPS = 10;
export const MOTION_THUMB_WIDTH = 64;
