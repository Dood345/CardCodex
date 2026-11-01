import { afterEach, describe, expect, it } from 'vitest';
import { imageCaptureFor, probePhotoSize, takePhoto } from './photo';

type Fake = { getPhotoCapabilities: () => Promise<PhotoCapabilities>; takePhoto: () => Promise<Blob> };

const stream = (live = true) => ({ getVideoTracks: () => [{ readyState: live ? 'live' : 'ended' }] }) as unknown as MediaStream;

function install(fake: Partial<Fake>) {
  (globalThis as { ImageCapture?: unknown }).ImageCapture = class {
    constructor(public track: MediaStreamTrack) {}
    getPhotoCapabilities = fake.getPhotoCapabilities ?? (() => Promise.reject(new Error('no caps')));
    takePhoto = fake.takePhoto ?? (() => Promise.reject(new Error('no photo')));
  };
}

afterEach(() => {
  delete (globalThis as { ImageCapture?: unknown }).ImageCapture;
});

describe('imageCaptureFor', () => {
  it('is null without the API, without a stream, or with an ended track', () => {
    expect(imageCaptureFor(stream())).toBeNull();
    install({});
    expect(imageCaptureFor(null)).toBeNull();
    expect(imageCaptureFor(stream(false))).toBeNull();
    expect(imageCaptureFor(stream())).not.toBeNull();
  });
});

describe('probePhotoSize', () => {
  it('reports the largest photo the camera offers, null when it cannot say', async () => {
    install({ getPhotoCapabilities: () => Promise.resolve({ imageWidth: { min: 320, max: 4032, step: 1 }, imageHeight: { min: 240, max: 3024, step: 1 } }) });
    expect(await probePhotoSize(stream())).toEqual({ w: 4032, h: 3024 });
    install({ getPhotoCapabilities: () => Promise.resolve({}) });
    expect(await probePhotoSize(stream())).toBeNull();
    install({});
    expect(await probePhotoSize(stream())).toBeNull();
    expect(await probePhotoSize(stream(), 20)).toBeNull();
  });

  it('gives up after the timeout', async () => {
    install({ getPhotoCapabilities: () => new Promise(() => undefined) });
    expect(await probePhotoSize(stream(), 20)).toBeNull();
  });
});

describe('takePhoto', () => {
  it('is null (the preview is used) when the API is missing, the capture rejects or takes too long', async () => {
    expect(await takePhoto(stream())).toBeNull();
    install({ takePhoto: () => Promise.reject(new Error('platform error')) });
    expect(await takePhoto(stream(), { size: null })).toBeNull();
    install({ takePhoto: () => new Promise(() => undefined) });
    expect(await takePhoto(stream(), { size: null, timeoutMs: 20 })).toBeNull();
  });

  it('asks for the given size', async () => {
    let asked: PhotoSettings | undefined;
    install({
      takePhoto: ((s?: PhotoSettings) => {
        asked = s;
        return Promise.reject(new Error('stop here'));
      }) as Fake['takePhoto'],
    });
    await takePhoto(stream(), { size: { w: 4032, h: 3024 } });
    expect(asked).toEqual({ imageWidth: 4032, imageHeight: 3024 });
  });
});
