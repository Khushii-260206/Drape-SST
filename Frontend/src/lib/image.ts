const MAX_DIMENSION = 1200;
const MAX_INPUT_BYTES = 20 * 1024 * 1024;

/** Photo types the picker offers. HEIC/HEIF is what iPhones produce; browsers that can't decode it say so. */
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";
const PHOTO_TYPES = /^image\/(jpeg|png|webp|heic|heif)$/i;
const WRONG_TYPE = "Please choose a JPEG, PNG or WebP photo.";

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

const UNSUPPORTED = "This image format isn't supported by your browser — try a JPEG or PNG.";

/** Decodes with createImageBitmap, falling back to an <img> element (older Safari, odd formats). */
async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // fall through to the <img> path
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(UNSUPPORTED);
  }
}

/**
 * Shrinks a photo to something sensible before it is uploaded, so a wardrobe of full-size phone
 * photos stays quick to load and well inside the free storage tier.
 */
export async function prepareImage(file: File): Promise<Blob> {
  if (!PHOTO_TYPES.test(file.type)) throw new Error(WRONG_TYPE);
  if (file.size === 0) throw new Error("That file is empty.");
  if (file.size > MAX_INPUT_BYTES) throw new Error("That photo is over 20 MB — please pick a smaller one.");

  const decoded = await decode(file);
  try {
    if (!decoded.width || !decoded.height) throw new Error(UNSUPPORTED);

    const scale = Math.min(1, MAX_DIMENSION / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    // Flatten transparency onto white so PNG cut-outs don't turn black as JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(decoded.source, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    // If the browser couldn't re-encode, keep the original; otherwise prefer the smaller of the two
    // unless we actually had to shrink it.
    if (!blob) return file;
    return blob.size < file.size || scale < 1 ? blob : file;
  } finally {
    decoded.release();
  }
}

const THUMB_DIMENSION = 480;

/** A small JPEG for grids and chat chips (~25 KB instead of ~150 KB). */
export async function makeThumbnail(photo: Blob): Promise<Blob> {
  const decoded = await decode(photo);
  try {
    const scale = Math.min(1, THUMB_DIMENSION / Math.max(decoded.width, decoded.height));
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No canvas");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(decoded.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    if (!blob) throw new Error("Couldn't encode thumbnail");
    return blob;
  } finally {
    decoded.release();
  }
}

const AVATAR_DIMENSION = 256;

/** A small square JPEG (as a data URL) for the profile photo, cropped around the centre. */
export async function makeAvatar(file: File): Promise<string> {
  if (!PHOTO_TYPES.test(file.type)) throw new Error(WRONG_TYPE);
  if (file.size === 0) throw new Error("That file is empty.");
  if (file.size > MAX_INPUT_BYTES) throw new Error("That photo is over 20 MB — please pick a smaller one.");
  const decoded = await decode(file);
  try {
    const side = Math.min(decoded.width, decoded.height);
    if (!side) throw new Error(UNSUPPORTED);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_DIMENSION;
    canvas.height = AVATAR_DIMENSION;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't process that photo in this browser.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, AVATAR_DIMENSION, AVATAR_DIMENSION);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(decoded.source, (decoded.width - side) / 2, (decoded.height - side) / 2, side, side, 0, 0, AVATAR_DIMENSION, AVATAR_DIMENSION);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    decoded.release();
  }
}

const ANALYSIS_DIMENSION = 640;

/**
 * A small JPEG data URL for sending to a vision model. 640px keeps weave, collars and prints readable while the upload
 * stays around 40-80 KB instead of the megabytes a phone photo is. Photos are already ≤1200px when they get here.
 */
export async function photoToAnalysisUrl(photo: Blob, maxSide = ANALYSIS_DIMENSION): Promise<string> {
  const decoded = await decode(photo);
  try {
    const scale = Math.min(1, maxSide / Math.max(decoded.width, decoded.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(decoded.width * scale));
    canvas.height = Math.max(1, Math.round(decoded.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser can't prepare photos.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.78);
  } finally {
    decoded.release();
  }
}
