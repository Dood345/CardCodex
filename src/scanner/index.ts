/**
 * Camera card-recognition module — public entry point. See README.md.
 */
export { getRecognizer, disposeRecognizer } from './engine';
export type * from './types';
export type { RecognizerSource, TextRecognizer } from './recognizer';
export type { TesseractOptions } from './tesseract';
export { buildScanIndex, matchObservations, scanLines, findNames, printingsOf, createPokemonMatcher, type ScanIndex } from './match';
export { createYgoMatcher } from './ygo/match';
export { hashCard, matchPocket, nearestByHash, decodeHashFile, hashSpecFor, HASH_SPEC, type HashSpec, type HashTable, type HashHit } from './hash';
export { loadHashTable, mergeArtworkEvidence, ARTWORK_MATCH_BITS } from './artwork';
export { parseLines, type ParseContext } from './parse';
export { normalizeName, canonicalNum } from './ocr-normalize';
export {
  startCamera,
  stopCamera,
  grabFrame,
  coverTransform,
  mapBox,
  unmapBox,
  visibleRegion,
  previewToPhoto,
  orientLike,
  CameraError,
  type CoverTransform,
  type Size,
} from './camera';
export { takePhoto, probePhotoSize, imageCaptureFor, type PhotoResult, type TakePhotoOptions } from './photo';
export { adviseCapture, sharpness, wantedCardPx, type CaptureAdvice, type GuidanceMetrics, type AdviceKind } from './guidance';
export { updateTracks, type Track } from './tracker';
export { useCardScanner, type UseCardScannerOptions, type CardScanner, type ScannerStatus } from './useCardScanner';
export { isMlkitAvailable } from './mlkit';
