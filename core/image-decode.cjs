const zlib = require('node:zlib');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const ranges = require('../shared/appearance-ranges.json');
const { appError } = require('./errors.cjs');

const MAX_BYTES = ranges.maxImageBytes;
const MAX_PIXELS = ranges.maxPixels;

function sniff(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function assertPixels(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw appError('ASSET_INVALID', '图片尺寸无效');
  }
  if (width * height > MAX_PIXELS) throw appError('ASSET_INVALID', '图片像素超过 2500 万，已拒绝');
}

function toBuffer(data) {
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

function declaredSize(buffer, format) {
  try {
    if (format === 'png' && buffer.toString('ascii', 12, 16) === 'IHDR') {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (format === 'jpeg') {
      let offset = 2;
      while (offset + 8 < buffer.length) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1];
        if (marker >= 0xc0 && marker <= 0xc2 && marker !== 0xc4) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
        }
        if (marker === 0xd8 || marker === 0xd9) {
          offset += 2;
          continue;
        }
        offset += 2 + buffer.readUInt16BE(offset + 2);
      }
    }
    if (format === 'webp' && buffer.toString('ascii',12,16)==='VP8L' && buffer.length>=25 && buffer[20]===0x2f){const bits=buffer.readUInt32LE(21);return{width:1+(bits&0x3fff),height:1+((bits>>>14)&0x3fff)};}
    if (format === 'webp' && buffer.toString('ascii',12,16)==='VP8 ' && buffer.length>=30 && buffer[23]===0x9d && buffer[24]===0x01 && buffer[25]===0x2a)return{width:buffer.readUInt16LE(26)&0x3fff,height:buffer.readUInt16LE(28)&0x3fff};
    if (format === 'webp' && buffer.toString('ascii', 12, 16) === 'VP8X'  && buffer.length >= 30) {
      return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    }
  } catch {
    return null;
  }
  return null;
}

function paeth(left, up, upLeft) {
  const score = left + up - upLeft;
  const leftDistance = Math.abs(score - left);
  const upDistance = Math.abs(score - up);
  const upLeftDistance = Math.abs(score - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  return upDistance <= upLeftDistance ? up : upLeft;
}

function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 1;
  const chunks = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > buffer.length) throw appError('ASSET_INVALID', 'PNG 无法解码');
    const data = buffer.subarray(start, end);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') chunks.push(data);
    else if (type === 'IEND') break;
    offset = end + 4;
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (bitDepth !== 8 || interlace !== 0 || !channels || !chunks.length) {
    throw appError('ASSET_INVALID', 'PNG 无法解码');
  }
  assertPixels(width, height);
  let inflated;
  try {
    inflated = zlib.inflateSync(Buffer.concat(chunks), {maxOutputLength: height * (width * channels + 1)});
  } catch {
    throw appError('ASSET_INVALID', 'PNG 无法解码');
  }
  const stride = width * channels;
  if (inflated.length < height * (stride + 1)) throw appError('ASSET_INVALID', 'PNG 无法解码');
  const output = Buffer.alloc(width * height * 4);
  let source = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[source];
    source += 1;
    const row = Buffer.alloc(stride);
    for (let index = 0; index < stride; index += 1) {
      const raw = inflated[source];
      source += 1;
      const left = index >= channels ? row[index - channels] : 0;
      const up = previous[index];
      const upLeft = index >= channels ? previous[index - channels] : 0;
      let value = raw;
      if (filter === 1) value = (raw + left) & 255;
      else if (filter === 2) value = (raw + up) & 255;
      else if (filter === 3) value = (raw + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) value = (raw + paeth(left, up, upLeft)) & 255;
      else if (filter !== 0) throw appError('ASSET_INVALID', 'PNG 无法解码');
      row[index] = value;
    }
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4;
      const pixel = x * channels;
      if (colorType === 6) {
        output[target] = row[pixel];
        output[target + 1] = row[pixel + 1];
        output[target + 2] = row[pixel + 2];
        output[target + 3] = row[pixel + 3];
      } else if (colorType === 2) {
        output[target] = row[pixel];
        output[target + 1] = row[pixel + 1];
        output[target + 2] = row[pixel + 2];
        output[target + 3] = 255;
      } else if (colorType === 0) {
        output[target] = output[target + 1] = output[target + 2] = row[pixel];
        output[target + 3] = 255;
      } else {
        output[target] = output[target + 1] = output[target + 2] = row[pixel];
        output[target + 3] = row[pixel + 1];
      }
    }
    previous = row;
  }
  return { format: 'png', mime: 'image/png', width, height, data: output };
}

function decodeJpeg(buffer) {
  let image;
  try {
    image = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: true, maxResolutionInMP:MAX_PIXELS / 1000000, maxMemoryUsageInMB:256 });
  } catch {
    throw appError('ASSET_INVALID', 'JPEG 无法解码');
  }
  if (!image || !image.data) throw appError('ASSET_INVALID', 'JPEG 无法解码');
  assertPixels(image.width, image.height);
  return { format: 'jpeg', mime: 'image/jpeg', width: image.width, height: image.height, data: toBuffer(image.data) };
}

async function decodeWebp(buffer) {
  let image;
  try {
    const mod = await import('@jsquash/webp/decode.js');
    image = await mod.default(buffer);
  } catch {
    throw appError('ASSET_INVALID', 'WebP 无法解码');
  }
  if (!image || !image.data) throw appError('ASSET_INVALID', 'WebP 无法解码');
  assertPixels(image.width, image.height);
  return { format: 'webp', mime: 'image/webp', width: image.width, height: image.height, data: toBuffer(image.data) };
}

async function decodeImage(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (buffer.length === 0) throw appError('ASSET_INVALID', '图片是空的');
  if (buffer.length > MAX_BYTES) throw appError('ASSET_INVALID', '请选择小于 5 MB 的图片');
  const format = sniff(buffer);
  if (!format) throw appError('ASSET_INVALID', '仅支持 PNG、JPEG 和 WebP 图片');
  const declared = declaredSize(buffer, format);
  if (!declared) throw appError('ASSET_INVALID','图片缺少可安全校验的尺寸');
  assertPixels(declared.width, declared.height);
  if (format === 'png') return decodePng(buffer);
  if (format === 'jpeg') return decodeJpeg(buffer);
  return decodeWebp(buffer);
}

function encodePng(width, height, data) {
  const png = new PNG({ width, height });
  const source = toBuffer(data);
  if (source.length < width * height * 4) throw appError('ASSET_INVALID', '图片数据不完整');
  source.copy(png.data, 0, 0, width * height * 4);
  return PNG.sync.write(png);
}

module.exports = { decodeImage, encodePng, sniff, MAX_BYTES, MAX_PIXELS, assertPixels };
