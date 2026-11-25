// All verify thresholds live here. Change them here, nowhere else.

// first-frame / blank-stretch: a sampled frame counts as blank when its luma
// range (YMAX - YMIN, 8-bit) is tiny (near-uniform: any single colour) or
// when even its brightest pixel is near black.
export const UNIFORM_LUMA_RANGE = 6;
export const NEAR_BLACK_YMAX = 32;

// Sampling rate (frames per second) for the signalstats pass.
export const SAMPLE_FPS = 10;

// blank-stretch
export const BLANK_MIN_SECONDS = 0.5;   // warn from here
export const BLANK_FAIL_SECONDS = 1.0;  // fail from here
export const BLANK_IGNORE_TAIL_SECONDS = 0.5; // final fade-out is allowed
export const BLACKDETECT_PIX_TH = 0.02;
export const BLACKDETECT_PIC_TH = 0.98;

// near-empty (warn only): content coverage = share of pixels whose luma differs
// from the frame's background (most common luma) by more than NEAR_EMPTY_LUMA_DELTA.
export const NEAR_EMPTY_COVERAGE = 0.004;
export const NEAR_EMPTY_LUMA_DELTA = 12;
export const NEAR_EMPTY_MIN_SECONDS = 0.2;
export const NEAR_EMPTY_IGNORE_HEAD_SECONDS = 0.1;
export const NEAR_EMPTY_IGNORE_TAIL_SECONDS = 0.5;
export const NEAR_EMPTY_W = 160;
export const NEAR_EMPTY_H = 90;

// frozen-stretch
export const FREEZE_WARN_SECONDS = 2;
export const FREEZE_FAIL_SECONDS = 3;
export const FREEZE_NOISE_DB = -60;
// A freeze that runs to the end of the video is an end card: fail only past this.
export const FREEZE_END_HOLD_FAIL_SECONDS = 5;
export const FREEZE_END_TOLERANCE_SECONDS = 0.15;

// duration
export const DEFAULT_FPS = 30;
export const FRAME_COUNT_TOLERANCE = 1;

// loudness (warn only). Only comparable on ffmpeg 8.0.1.
export const LOUDNESS_MIN_LUFS = -17;   // -16 target with 1 LU measurement tolerance: the approved brag reference measured -16.3
export const LOUDNESS_MAX_LUFS = -12;
export const TRUE_PEAK_MAX_DBTP = -1;
// Sparse sound (effects only): when the audio above SPARSE_SILENCE_DB is less than
// this share of the duration, judge by true peak instead of integrated loudness.
export const SPARSE_AUDIO_SHARE = 0.4;
export const SPARSE_SILENCE_DB = -50;
export const SPARSE_TRUE_PEAK_MIN_DBTP = -6;
export const SPARSE_TRUE_PEAK_MAX_DBTP = -1;

// contact sheet
export const SHEET_MAX_WIDTH = 2400;
export const SHEET_MAX_COLS = 8;
export const SHEET_MAX_FRAMES = 96;

// layer 1
export const HF_CHECK_TIMEOUT_MS = 10 * 60 * 1000;

// on-beat (warn only): a cut counts as on the grid when it is within this many video frames of the
// nearest beat or half-beat. Scene detection reports the first new frame, so one frame of
// rounding plus half a frame of grid jitter is the honest measurement error.
export const ON_BEAT_TOLERANCE_FRAMES = 1.5;
export const ON_BEAT_LIST_MAX = 5;      // worst offenders named in the message

// variety (warn only)
export const VARIETY_MAX_REPEAT = 3;    // the same transition this many times in a row is a tic


// stillness (warn only). Measured on 128 px wide gray samples at SAMPLE_FPS, 16 px cells, mean
// absolute luma difference between consecutive samples (0-255 scale). Measured on a real map
// screenshot: a drift of 3 px/s at 1080 px width gives a frame mean of 0.64 and 6 px/s of 0.94
// (both still); 12 px/s gives 1.74 (motion). A blinking cursor, a moving cursor or typing give a
// frame mean under 0.1 but one cell at 3-6, and under 3 % of the cells change. A drift changes 80-97 %.
export const STILL_MIN_SECONDS = 3;          // a still stretch longer than this warns
export const STILL_BIN_SECONDS = 0.5;        // resolution of the stretch
export const STILL_GLOBAL_MAX = 1.2;         // bin mean above this = real movement (between 6 and 12 px/s)
export const STILL_LOCAL_PEAK = 1.0;         // one 16 px cell changing by more than this = something happened there
export const STILL_LOCAL_MAX_SHARE = 0.25;   // ...as long as it is local (a drift touches most cells)
export const STILL_CELL = 16;
export const STILL_W = 128;
export const STILL_CELL_ACTIVE = 0.3;        // a cell counts as changed above this mean difference

// poster (warn only): frame 0 doubles as the thumbnail. Measured on 320 px wide gray: a designed
// hook frame covers 55 % of the pixels, edge share 0.16; a single line of text on a dark ground
// (a weak thumbnail) 3 % and 0.04.
export const POSTER_W = 320;
export const POSTER_MIN_COVERAGE = 0.05;  // share of pixels differing from the background luma by more than NEAR_EMPTY_LUMA_DELTA
export const POSTER_MIN_EDGE = 0.01;      // share of pixels with a gradient (|dx|+|dy|) above POSTER_EDGE_DELTA
export const POSTER_EDGE_DELTA = 24;

// loudness: short-term (3 s) cap for sparse audio, where integrated loudness is not judged.
// Platforms normalise to about -14 LUFS integrated; the music range tops out at -12, and a sparse
// mix may legitimately carry 3 LU more in its loudest 3 s. Above that, a few loud effects are
// being heard as shouting.
export const SPARSE_SHORT_TERM_MAX_LUFS = -9;

// critic frames
export const CRITIC_FRAME_WIDTH = 960;
export const CRITIC_FRAME_MAX = 16;
export const CRITIC_FRAME_MIN = 6;               // scene detection misses soft cuts; below this, evenly spaced frames fill in
export const CRITIC_FRAME_EARLY_SECONDS = 0.2;   // first frame after the opening
export const CRITIC_FRAME_AFTER_CUT_SECONDS = 0.1; // shot start: past the transition's first frame
export const CRITIC_FRAME_TAIL_SECONDS = 1;      // the last second

// human moments
export const MOMENTS_MAX = 5;
export const MOMENT_MIN_GAP_SECONDS = 1;         // two moments closer than this are one
export const HOOK_SECONDS = 2;

// empty-area / subject-scale (warn only). Measured on the 10 fps 160x90 gray frames of near-empty,
// background = the frame's most common luma, "near" = within NEAR_EMPTY_LUMA_DELTA, median over the
// video without the last EMPTY_AREA_IGNORE_TAIL_SECONDS (the end card). Calibration pair, 1080x1920, 20 s:
//   BAD  (phone about 40 % of the width, bottom third empty): largest empty band 0.300 of the height
//        (bottom), 0.294 of the width, content coverage 0.134
//   GOOD (approved reference, fills the frame): largest empty band 0.133 of the height, 0.069 of the
//        width, content coverage 0.292
// Thresholds sit at roughly the midpoint, rounded down, so both sides keep a margin.
export const EMPTY_AREA_LINE_SHARE = 0.98;   // a row/column is empty when this share of its pixels is background
export const EMPTY_AREA_MAX_SHARE = 0.2;     // largest empty band above this share of height or width warns
export const SUBJECT_SCALE_MIN_COVERAGE = 0.2; // median share of the frame covered by non-background content below this warns
export const EMPTY_AREA_IGNORE_TAIL_SECONDS = 5;

// shot boundaries from shots.json: a declared boundary must show a real change between the frames
// SHOT_CHANGE_FRAMES before and after it (mean absolute luma difference, 0-255, on 160x90 gray).
// Measured on BAD, whose cuts only change a phone-sized area: 2.4, 2.5, 3.9, 5.9 and 12.0.
// Two frames of unchanged video differ by 0.02-0.1 (encoder noise), so 1.0 separates them.
export const SHOT_CHANGE_FRAMES = 2;
export const SHOT_CHANGE_MIN_DIFF = 1.0;

// static-shots (warn only). Uses the stillness machinery (motionBins: a 0.5 s bin is moving at frame
// mean >= STILL_GLOBAL_MAX or a local cell change), per shot, after its entrance, whole bins only.
// A shot is static when >= STATIC_SHOT_STILL_SHARE of those bins are still; the video warns when
// >= STATIC_SHOTS_WARN_SHARE of the non-end shots are static.
// Measured (bin frame means after the entrance, 0-255):
//   STATIC mert-sabah-menusu (4 photo shots + end card, 3 s each): the photos DO drift slowly, a
//     constant mean of 0.9-1.1 (about 6 px/s, a slow push) in shots 1, 2 and 4 = 100 % still bins;
//     shot 3 (6-9 s) is steady at 1.4-1.5, just above STILL_GLOBAL_MAX, so it counts as moving (0 % still).
//     Static share 3 of 4 = 0.75. The end card is 0.6.
//   MOVING sweetspot brag.mp4 (one detected cut at 4.3 s, so the last shot is dropped as the end card):
//     the one judged shot (0-4.3 s) has still share 0.00 (bin means 3-19).
//   MOVING deneme2-bizim.mp4 (cuts 4.3, 14.3, 17.2 s): still share 0.33, 0.28 and 0.00 for the three
//     judged shots; no static shot (0 of 3).
// 0.7 and 0.5 keep the Mert video above and both moving videos well below. The drift of the Mert
// photos is real but a slow push of ~1 mean is exactly what STILL_GLOBAL_MAX calls still; this
// check does not change that line.
export const STATIC_ENTRANCE_SECONDS = 0.6;
export const STATIC_SHOT_STILL_SHARE = 0.7;
export const STATIC_SHOTS_WARN_SHARE = 0.5;
