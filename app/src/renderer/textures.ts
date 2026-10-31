// Texture loading with downscaling. Model atlases are often 4096-8192px; a desktop pet is drawn at
// a fraction of that, so we decode straight to a smaller ImageBitmap and save most of the VRAM.

export interface LoadedTexture {
  texture: WebGLTexture;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
}

/** Reads width/height from a PNG header without decoding the image. */
async function pngSize(blob: Blob): Promise<[number, number] | null> {
  const head = new DataView(await blob.slice(0, 24).arrayBuffer());
  if (head.byteLength < 24 || head.getUint32(0) !== 0x89504e47) return null;
  return [head.getUint32(16), head.getUint32(20)];
}

/** `scale` (0..1] shrinks the image; it is also capped at the GPU's maximum texture size. */
export async function loadTexture(gl: WebGL2RenderingContext, url: string, scale: number): Promise<LoadedTexture> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`texture ${url}: HTTP ${res.status}`);
  const blob = await res.blob();

  const size = await pngSize(blob);
  const options: ImageBitmapOptions = { premultiplyAlpha: "none", colorSpaceConversion: "none" };
  if (size) {
    const maxSide = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const s = Math.min(1, scale, maxSide / Math.max(size[0], size[1]));
    if (s < 1) {
      options.resizeWidth = Math.max(1, Math.round(size[0] * s));
      options.resizeHeight = Math.max(1, Math.round(size[1] * s));
      options.resizeQuality = "high";
    }
  }
  const bitmap = await createImageBitmap(blob, options);
  // WebKit uploads ImageBitmaps decoded from PNG with straight alpha whatever premultiplyAlpha says,
  // so go through a 2D canvas: it stores premultiplied pixels, and canvas uploads honour
  // UNPACK_PREMULTIPLY_ALPHA_WEBGL in every engine.
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  const { width, height } = bitmap;
  bitmap.close();

  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindTexture(gl.TEXTURE_2D, null);

  canvas.width = canvas.height = 0;
  return { texture, width, height, sourceWidth: size?.[0] ?? width, sourceHeight: size?.[1] ?? height };
}
