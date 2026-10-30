import sharp from 'sharp';

/**
 * Computes a perceptual hash of an image using the average-hash (aHash) algorithm.
 *
 * Steps:
 * 1. Resize the image to 8×8 pixels
 * 2. Convert to grayscale
 * 3. Compute the mean pixel value
 * 4. Generate a 64-bit hash: each bit is 1 if the pixel is >= mean, else 0
 * 5. Return the hash as a 16-character hex string
 *
 * @param buffer - The raw image buffer
 * @returns A 16-character hex string representing the perceptual hash
 */
export async function computePerceptualHash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer)
    .resize(8, 8, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Calculate mean pixel value
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i]!;
  }
  const mean = sum / data.length;

  // Build 64-bit hash as a BigInt
  let hash = BigInt(0);
  for (let i = 0; i < data.length; i++) {
    if (data[i]! >= mean) {
      hash |= BigInt(1) << BigInt(63 - i);
    }
  }

  // Convert to a 16-character zero-padded hex string
  return hash.toString(16).padStart(16, '0');
}

/**
 * Calculates the hamming distance between two hex-encoded perceptual hashes.
 * The hamming distance is the number of differing bits.
 *
 * @param hash1 - First perceptual hash (hex string)
 * @param hash2 - Second perceptual hash (hex string)
 * @returns The number of differing bits between the two hashes
 */
export function hammingDistance(hash1: string, hash2: string): number {
  const h1 = BigInt(`0x${hash1}`);
  const h2 = BigInt(`0x${hash2}`);
  let xor = h1 ^ h2;

  let distance = 0;
  while (xor > BigInt(0)) {
    distance += Number(xor & BigInt(1));
    xor >>= BigInt(1);
  }

  return distance;
}
