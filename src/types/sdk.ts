/**
 * Type re-exports for `web_pen_sdk` 0.8.0 (published).
 * Published index only exports runtime values; types live in deep paths.
 */

export type {
  VersionInfo,
  SettingInfo,
  PageInfo,
  PaperSize,
  View,
  ScreenDot,
} from 'web_pen_sdk/dist/Util/type';

export type { default as PenController } from 'web_pen_sdk/dist/PenCotroller/PenController';

export type PenDotEvent = {
  pageInfo?: {
    section?: number;
    owner?: number;
    book?: number;
    note?: number;
    page?: number;
  };
  section?: number;
  owner?: number;
  book?: number;
  note?: number;
  page?: number;
  x?: number;
  y?: number;
  f?: number;
  dotType?: number;
  DotType?: number;
  timeStamp?: number;
  timeDiff?: number;
  angle?: {
    tx?: number;
    ty?: number;
    twist?: number;
  };
};

export const DotTypes = {
  PEN_DOWN: 0,
  PEN_MOVE: 1,
  PEN_UP: 2,
  PEN_HOVER: 3,
  PEN_INFO: 4,
  PEN_ERROR: 5,
} as const;
