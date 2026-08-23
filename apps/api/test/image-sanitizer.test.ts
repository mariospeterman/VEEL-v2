import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  ImageValidationError,
  sanitizeImage
} from "../src/modules/content/image-sanitizer";

describe("content image sanitization", () => {
  it("normalizes orientation and strips source metadata before storage", async () => {
    const source = await sharp({
      create: {
        width: 8,
        height: 5,
        channels: 3,
        background: { r: 30, g: 90, b: 180 }
      }
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const result = await sanitizeImage(source, "image/jpeg");
    const metadata = await sharp(result.body).metadata();

    expect(result).toMatchObject({
      mimeType: "image/jpeg",
      extension: "jpg",
      widthPixels: 5,
      heightPixels: 8
    });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });

  it("rejects a declared MIME that differs from detected bytes", async () => {
    const source = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    }).png().toBuffer();

    await expect(sanitizeImage(source, "image/jpeg")).rejects.toEqual(
      new ImageValidationError("Declared image type does not match the uploaded file")
    );
  });

  it("rejects empty and unsupported image bodies", async () => {
    await expect(sanitizeImage(Buffer.alloc(0), "image/png")).rejects.toBeInstanceOf(
      ImageValidationError
    );
    await expect(sanitizeImage(Buffer.from("not-an-image"), "image/png")).rejects.toBeInstanceOf(
      ImageValidationError
    );
  });
});
