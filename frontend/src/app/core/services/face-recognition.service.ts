import { Injectable, signal } from '@angular/core';
import * as faceapi from '@vladmandic/face-api';
import { EnrolledFace } from '../api/api.models';

export interface FaceScanResult {
  hasFace: boolean;
  score: number;
  descriptor?: number[];
  box?: { x: number; y: number; width: number; height: number };
  snapshot?: string;
  landmarks?: unknown;
}

export interface FaceMatchEvaluation {
  matched: boolean;
  matchScore: number;
  distance: number;
  threshold: number;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class FaceRecognitionService {
  readonly modelsLoaded = signal(false);
  readonly loadingModels = signal(false);
  private loadPromise: Promise<boolean> | null = null;

  /**
   * Loads the TinyFaceDetector, FaceLandmark68, and FaceRecognition models
   * from the local /models folder.
   */
  async loadModels(): Promise<boolean> {
    if (this.modelsLoaded()) return true;
    if (this.loadPromise) return this.loadPromise;

    this.loadingModels.set(true);

    this.loadPromise = (async () => {
      try {
        const modelPath = '/models';
        await Promise.all([
          faceapi.nets.tinyFaceDetector.loadFromUri(modelPath),
          faceapi.nets.faceLandmark68Net.loadFromUri(modelPath),
          faceapi.nets.faceRecognitionNet.loadFromUri(modelPath),
        ]);
        this.modelsLoaded.set(true);
        this.loadingModels.set(false);
        return true;
      } catch (err) {
        console.warn('Failed to load local face models, trying CDN fallback:', err);
        try {
          const cdnPath = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
          await Promise.all([
            faceapi.nets.tinyFaceDetector.loadFromUri(cdnPath),
            faceapi.nets.faceLandmark68Net.loadFromUri(cdnPath),
            faceapi.nets.faceRecognitionNet.loadFromUri(cdnPath),
          ]);
          this.modelsLoaded.set(true);
          this.loadingModels.set(false);
          return true;
        } catch (cdnErr) {
          console.error('Failed to load face models from CDN:', cdnErr);
          this.loadingModels.set(false);
          return false;
        }
      }
    })();

    return this.loadPromise;
  }

  /**
   * Resizes an image or Data URL to a compact JPEG Data URL (max 640px)
   * so face snapshots never exceed upload/database limits.
   */
  compressImageToDataUrl(source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement, maxDim = 640, quality = 0.85): string | undefined {
    const srcW = source instanceof HTMLVideoElement
      ? source.videoWidth
      : (source instanceof HTMLImageElement ? (source.naturalWidth || source.width) : source.width);
    const srcH = source instanceof HTMLVideoElement
      ? source.videoHeight
      : (source instanceof HTMLImageElement ? (source.naturalHeight || source.height) : source.height);

    if (!srcW || !srcH) return undefined;

    const scale = Math.min(1, maxDim / Math.max(srcW, srcH));
    const targetW = Math.max(1, Math.round(srcW * scale));
    const targetH = Math.max(1, Math.round(srcH * scale));

    const offscreen = document.createElement('canvas');
    offscreen.width = targetW;
    offscreen.height = targetH;
    const ctx = offscreen.getContext('2d');
    if (!ctx) return undefined;

    ctx.drawImage(source, 0, 0, targetW, targetH);
    return offscreen.toDataURL('image/jpeg', quality);
  }

  /**
   * Fast snapshot capture - only executed when punch is confirmed or explicit photo requested.
   */
  captureSnapshot(element: HTMLVideoElement, canvasRef: HTMLCanvasElement): string | undefined {
    if (element.videoWidth > 0 && element.videoHeight > 0) {
      canvasRef.width = element.videoWidth;
      canvasRef.height = element.videoHeight;
      const ctx = canvasRef.getContext('2d');
      if (ctx) {
        ctx.drawImage(element, 0, 0, canvasRef.width, canvasRef.height);
        return this.compressImageToDataUrl(canvasRef) ?? canvasRef.toDataURL('image/jpeg', 0.85);
      }
    }
    return undefined;
  }

  /** Waits briefly until a video element has decoded its first frame dimensions. */
  async waitForVideoReady(video: HTMLVideoElement, timeoutMs = 4000): Promise<boolean> {
    if (video.readyState >= 2 && video.videoWidth > 0) return true;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (video.readyState >= 2 && video.videoWidth > 0) return true;
      await new Promise((r) => setTimeout(r, 60));
    }
    return video.videoWidth > 0;
  }

  /**
   * Detects a single face from an HTML video, canvas, or image element.
   */
  async detectFace(
    element: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
    canvasRef?: HTMLCanvasElement,
    captureSnapshot: boolean = true
  ): Promise<FaceScanResult> {
    const ready = await this.loadModels();
    if (!ready) {
      return { hasFace: false, score: 0 };
    }

    try {
      if (element instanceof HTMLVideoElement && element.videoWidth === 0) {
        await this.waitForVideoReady(element, 2500);
      }

      const isStaticImage = element instanceof HTMLImageElement || element instanceof HTMLCanvasElement;
      const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
      const primaryOptions = new faceapi.TinyFaceDetectorOptions({
        inputSize: isStaticImage ? 416 : (captureSnapshot ? 320 : (isMobile ? 160 : 224)),
        scoreThreshold: isStaticImage ? 0.35 : (captureSnapshot ? 0.38 : 0.5),
      });

      let detection = await faceapi
        .detectSingleFace(element, primaryOptions)
        .withFaceLandmarks()
        .withFaceDescriptor();

      // Retry with larger inputSize and lower threshold during active enrollment capture
      if (!detection && captureSnapshot) {
        const fallbackOptions = new faceapi.TinyFaceDetectorOptions({
          inputSize: 416,
          scoreThreshold: 0.25,
        });
        detection = await faceapi
          .detectSingleFace(element, fallbackOptions)
          .withFaceLandmarks()
          .withFaceDescriptor();
      }

      if (!detection) {
        return { hasFace: false, score: 0 };
      }

      let snapshot: string | undefined;
      if (captureSnapshot && canvasRef && element instanceof HTMLVideoElement && element.videoWidth > 0) {
        snapshot = this.captureSnapshot(element, canvasRef);
      } else if (captureSnapshot && isStaticImage) {
        snapshot = this.compressImageToDataUrl(element);
      }

      const box = detection.detection.box;

      return {
        hasFace: true,
        score: Math.round(detection.detection.score * 100),
        descriptor: Array.from(detection.descriptor),
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        snapshot,
        landmarks: detection.landmarks,
      };
    } catch (err) {
      console.warn('Face detection error:', err);
      return { hasFace: false, score: 0 };
    }
  }

  /**
   * Identifies whether a 128D descriptor is a synthetic dummy array
   * (e.g. from older placeholder Math.random() generation) instead of a real neural vector.
   */
  isDummyDescriptor(descriptor: unknown): boolean {
    if (!Array.isArray(descriptor) || descriptor.length !== 128) return true;
    const allPositive = descriptor.every((v) => typeof v === 'number' && v > 0);
    const inDummyRange = descriptor.every((v) => typeof v === 'number' && v >= 0.08 && v <= 0.35);
    return allPositive && inDummyRange;
  }

  /**
   * Compares two 128-dimensional face descriptors using true Euclidean distance.
   * Standard threshold for face-api.js ResNet-34 is distance <= 0.58 for same person.
   */
  compareFaces(
    liveDescriptor: number[] | Float32Array,
    enrolledDescriptor: number[] | Float32Array,
    requiredThreshold = 70
  ): FaceMatchEvaluation {
    const arr1 = liveDescriptor instanceof Float32Array ? liveDescriptor : new Float32Array(liveDescriptor);
    const arr2 = enrolledDescriptor instanceof Float32Array ? enrolledDescriptor : new Float32Array(enrolledDescriptor);

    const distance = faceapi.euclideanDistance(arr1, arr2);

    // In ResNet-34 face embeddings (L2-normalized 128D space):
    // - Distance 0.00 - 0.35: Excellent/identical match (92% - 100%)
    // - Distance 0.35 - 0.58: Same person under natural camera/lighting variations (70% - 92%)
    // - Distance 0.58 - 0.65: Borderline / weak match (50% - 70%)
    // - Distance > 0.65: Different person / impostor (< 50%)
    let normalizedScore: number;
    if (distance <= 0.35) {
      normalizedScore = Math.round(100 - (distance / 0.35) * 8);
    } else if (distance <= 0.58) {
      normalizedScore = Math.round(92 - ((distance - 0.35) / 0.23) * 22);
    } else {
      normalizedScore = Math.max(0, Math.round(70 - ((distance - 0.58) / 0.27) * 70));
    }

    const matched = normalizedScore >= requiredThreshold;

    let message = '';
    if (matched) {
      message = `✅ Face verified (${normalizedScore}% match). Identity confirmed!`;
    } else {
      message = `❌ Face did not match (${normalizedScore}% match; at least ${requiredThreshold}% required). Please try again.`;
    }

    return {
      matched,
      matchScore: normalizedScore,
      distance,
      threshold: requiredThreshold,
      message,
    };
  }

  /**
   * Checks whether a candidate face descriptor or photo already belongs to another employee.
   * Returns the conflicting employee record when a match is found, or null if unique.
   */
  findDuplicateEnrolledFace(
    candidateDescriptor: number[] | null | undefined,
    enrolledFaces: EnrolledFace[],
    excludeEmployeeIdOrCode?: string | null,
    candidatePhotoUrl?: string | null
  ): EnrolledFace | null {
    const excluded = (excludeEmployeeIdOrCode || '').trim().toLowerCase();
    const cleanPhoto = (candidatePhotoUrl || '').trim();

    for (const face of enrolledFaces) {
      if (
        excluded &&
        (face.employeeId?.toLowerCase() === excluded || face.employeeCode?.toLowerCase() === excluded)
      ) {
        continue;
      }

      if (cleanPhoto && face.avatarUrl && face.avatarUrl.trim() === cleanPhoto) {
        return face;
      }

      if (!candidateDescriptor || candidateDescriptor.length === 0 || !face.faceDescriptor) {
        continue;
      }

      try {
        const existing = JSON.parse(face.faceDescriptor) as number[];
        if (!Array.isArray(existing) || existing.length !== candidateDescriptor.length) {
          continue;
        }
        if (this.isDummyDescriptor(candidateDescriptor) || this.isDummyDescriptor(existing)) {
          continue;
        }
        const evalRes = this.compareFaces(candidateDescriptor, existing, 70);
        if (evalRes.matched) {
          return face;
        }
      } catch {
        // Skip malformed descriptors
      }
    }

    return null;
  }
}
