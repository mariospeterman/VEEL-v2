import sharp, { type Sharp } from "sharp";

const maxImageBytes = 20 * 1024 * 1024;
const maxImagePixels = 40_000_000;
const maxImageDimension = 16_384;

export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageValidationError";
  }
}

export interface SanitizedImage {
  body: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
  widthPixels: number;
  heightPixels: number;
}

export async function sanitizeImage(
  body: Buffer,
  declaredMimeType: string
): Promise<SanitizedImage> {
  if (body.length === 0 || body.length > maxImageBytes) {
    throw new ImageValidationError("Image must be between 1 byte and 20 MB");
  }

  let image = sharp(body, {
    failOn: "warning",
    limitInputPixels: maxImagePixels,
    pages: 1,
    sequentialRead: true
  });
  const source = await image.metadata().catch(() => {
    throw new ImageValidationError("Image data is invalid or unsupported");
  });
  const normalized = normalizedFormat(source.format);

  if (!normalized || normalized.mimeType !== declaredMimeType) {
    throw new ImageValidationError("Declared image type does not match the uploaded file");
  }
  if ((source.pages ?? 1) !== 1) {
    throw new ImageValidationError("Animated or multi-page images are not supported");
  }
  validateDimensions(source.width, source.height);

  image = image.rotate();
  const output = await encodeWithoutMetadata(image, normalized.extension).catch(() => {
    throw new ImageValidationError("Image data is invalid or unsupported");
  });
  if (output.length > maxImageBytes) {
    throw new ImageValidationError("Sanitized image exceeds the 20 MB limit");
  }
  const metadata = await sharp(output, {
    failOn: "warning",
    limitInputPixels: maxImagePixels
  }).metadata().catch(() => {
    throw new ImageValidationError("Image data is invalid or unsupported");
  });
  const widthPixels = metadata.width ?? 0;
  const heightPixels = metadata.height ?? 0;
  validateDimensions(widthPixels, heightPixels);

  return {
    body: output,
    mimeType: normalized.mimeType,
    extension: normalized.extension,
    widthPixels,
    heightPixels
  };
}

function validateDimensions(width: number | undefined, height: number | undefined): void {
  if (
    !width ||
    !height ||
    width > maxImageDimension ||
    height > maxImageDimension ||
    width * height > maxImagePixels
  ) {
    throw new ImageValidationError("Image dimensions exceed the supported limit");
  }
}

function normalizedFormat(
  format: string | undefined
): Pick<SanitizedImage, "mimeType" | "extension"> | null {
  if (format === "jpeg") return { mimeType: "image/jpeg", extension: "jpg" };
  if (format === "png") return { mimeType: "image/png", extension: "png" };
  if (format === "webp") return { mimeType: "image/webp", extension: "webp" };
  return null;
}

async function encodeWithoutMetadata(
  image: Sharp,
  extension: SanitizedImage["extension"]
): Promise<Buffer> {
  if (extension === "jpg") {
    return image.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  }
  if (extension === "png") {
    return image.png({ compressionLevel: 9 }).toBuffer();
  }
  return image.webp({ quality: 90 }).toBuffer();
}
