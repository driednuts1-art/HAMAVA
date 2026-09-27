import { Injectable, UnsupportedMediaTypeException } from '@nestjs/common';
import sharp, { Metadata } from 'sharp';

const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const MAX_DIMENSION = 1600;
const WEBP_QUALITY = 82;

/**
 * Real (non-mocked) image handling: validates that an upload is actually a
 * decodable image in an accepted format, then re-encodes it to WebP. sharp's
 * default output does not carry over EXIF/ICC metadata unless `withMetadata`
 * is explicitly requested, so a plain re-encode already satisfies the
 * "strip EXIF/GPS" requirement (product.md §5) — `.rotate()` first bakes in
 * the EXIF orientation so photos don't appear sideways once it's gone.
 */
@Injectable()
export class ImageProcessorService {
  async reencodeToWebp(data: Buffer): Promise<Buffer> {
    let metadata: Metadata;
    try {
      metadata = await sharp(data, { failOn: 'error' }).metadata();
    } catch {
      throw new UnsupportedMediaTypeException('File is not a valid image.');
    }

    if (!metadata.format || !ACCEPTED_FORMATS.has(metadata.format)) {
      throw new UnsupportedMediaTypeException(
        'Only JPEG, PNG, or WebP images are accepted.',
      );
    }

    return sharp(data)
      .rotate()
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer();
  }
}
