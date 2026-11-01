/**
 * Camera card-recognition module — public entry point. See README.md.
 */
export { getRecognizer, disposeRecognizer } from './engine';
export type * from './types';
export type { RecognizerSource, TextRecognizer } from './recognizer';
export type { TesseractOptions } from './tesseract';
export { buildScanIndex, matchObservations, scanLines, findNames, printingsOf, createPokemonMatcher, type ScanIndex } from './match';
export { createYgoMatcher } from './ygo/match';
export { parseLines, type ParseContext } from './parse';
export { normalizeName, canonicalNum } from './ocr-normalize';
export { startCamera, stopCamera, grabFrame, coverTransform, mapBox, unmapBox, visibleRegion, CameraError, type CoverTransform } from './camera';
export { updateTracks, type Track } from './tracker';
export { useCardScanner, type UseCardScannerOptions, type CardScanner, type ScannerStatus } from './useCardScanner';
export { isMlkitAvailable } from './mlkit';
