import { execFileSync } from "node:child_process";

// Pixel access through ffmpeg (already used locally; no new dependency).
// Decodes any image to RGBA8 and encodes RGBA8 back to PNG losslessly.
export const probeSize = (file) => {
  const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", file], { encoding: "utf8" }).trim();
  const [width, height] = out.split("x").map(Number);
  return { width, height };
};

export const readRgba = (file) => {
  const { width, height } = probeSize(file);
  const data = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 1 << 28 });
  return { width, height, data };
};

export const writePng = (file, { width, height, data }) => {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", `${width}x${height}`, "-i", "-", "-frames:v", "1", "-update", "1", file], { input: data });
};

// High-quality resample through ffmpeg (Lanczos); preserves aspect ratio as given.
export const resizePng = (input, output, width, height) => {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", input, "-vf", `scale=${width}:${height}:flags=lanczos+accurate_rnd+full_chroma_int`, "-frames:v", "1", "-update", "1", "-pix_fmt", "rgba", output]);
};

export const crop = (image, x, y, width, height) => {
  const data = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    image.data.copy(data, row * width * 4, ((y + row) * image.width + x) * 4, ((y + row) * image.width + x + width) * 4);
  }
  return { width, height, data };
};

// Bounding box of pixels that differ from white by more than `threshold`.
export const artworkBounds = (image, threshold = 24, region = null) => {
  const { width, height, data } = image;
  const [x0, y0, x1, y1] = region ?? [0, 0, width, height];
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * width + x) * 4;
      const distance = 765 - (data[i] + data[i + 1] + data[i + 2]);
      if (distance > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
};

// Places an image centred on a white square canvas (no scaling here).
export const onWhiteSquare = (image, size) => {
  const data = Buffer.alloc(size * size * 4, 255);
  const offsetX = Math.round((size - image.width) / 2);
  const offsetY = Math.round((size - image.height) / 2);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const s = (y * image.width + x) * 4;
      const d = ((y + offsetY) * size + (x + offsetX)) * 4;
      const a = image.data[s + 3] / 255;
      for (let c = 0; c < 3; c += 1) data[d + c] = Math.round(image.data[s + c] * a + 255 * (1 - a));
      data[d + 3] = 255;
    }
  }
  return { width: size, height: size, data };
};
