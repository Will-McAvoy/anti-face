const zlib = require('node:zlib');
const { appError } = require('../core/errors.cjs');
const {isSafeRelativePath, MAX_FILE_COUNT, MAX_SINGLE_FILE_BYTES, MAX_TOTAL_UNCOMPRESSED_BYTES}=require('../core/backup-schema.cjs');

/**
 * Standard PKZip encoder and decoder using Node.js built-in zlib
 */

function crc32(buf) {
  return zlib.crc32 ? zlib.crc32(buf) : 0;
}

function writeZip(files) {
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.path.replace(/\\/g, '/'), 'utf8');
    const rawData = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data || '');
    const compressed = zlib.deflateRawSync(rawData, { level: 6 });
    const crc = crc32(rawData);
    const useCompressed = compressed.length < rawData.length;
    const method = useCompressed ? 8 : 0;
    const dataToWrite = useCompressed ? compressed : rawData;

    // Local file header: 30 bytes + nameBuf.length
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4);         // version needed
    localHeader.writeUInt16LE(0x0800, 6);     // flags: UTF-8
    localHeader.writeUInt16LE(method, 8);     // compression method
    localHeader.writeUInt16LE(0, 10);        // mod time
    localHeader.writeUInt16LE(0, 12);        // mod date
    localHeader.writeUInt32LE(crc, 14);       // crc-32
    localHeader.writeUInt32LE(dataToWrite.length, 18); // compressed size
    localHeader.writeUInt32LE(rawData.length, 22);     // uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26);     // filename length
    localHeader.writeUInt16LE(0, 28);                  // extra field length
    nameBuf.copy(localHeader, 30);

    localHeaders.push(localHeader, dataToWrite);

    // Central directory header: 46 bytes + nameBuf.length
    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // signature
    centralHeader.writeUInt16LE(20, 4);          // version made by
    centralHeader.writeUInt16LE(20, 6);          // version needed
    centralHeader.writeUInt16LE(0x0800, 8);      // flags: UTF-8
    centralHeader.writeUInt16LE(method, 10);     // compression method
    centralHeader.writeUInt16LE(0, 12);         // mod time
    centralHeader.writeUInt16LE(0, 14);         // mod date
    centralHeader.writeUInt32LE(crc, 16);        // crc-32
    centralHeader.writeUInt32LE(dataToWrite.length, 20); // compressed size
    centralHeader.writeUInt32LE(rawData.length, 24);     // uncompressed size
    centralHeader.writeUInt16LE(nameBuf.length, 28);     // filename length
    centralHeader.writeUInt16LE(0, 30);                  // extra length
    centralHeader.writeUInt16LE(0, 32);                  // comment length
    centralHeader.writeUInt16LE(0, 34);                  // disk start
    centralHeader.writeUInt16LE(0, 36);                  // internal attr
    centralHeader.writeUInt32LE(0, 38);                  // external attr
    centralHeader.writeUInt32LE(offset, 42);             // relative offset
    nameBuf.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);

    offset += localHeader.length + dataToWrite.length;
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const h of centralHeaders) centralSize += h.length;

  // End of central directory record (EOCD): 22 bytes
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);         // signature
  eocd.writeUInt16LE(0, 4);                  // disk number
  eocd.writeUInt16LE(0, 6);                  // disk start
  eocd.writeUInt16LE(files.length, 8);       // entries on disk
  eocd.writeUInt16LE(files.length, 10);      // total entries
  eocd.writeUInt32LE(centralSize, 12);       // central directory size
  eocd.writeUInt32LE(centralOffset, 16);     // central directory offset
  eocd.writeUInt16LE(0, 20);                 // comment length

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd]);
}

function readZip(zipBuffer) {
  if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length < 22) {
    throw appError('BACKUP_CORRUPT', '无效的 Zip 归档文件');
  }

  // Find EOCD from the end
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= Math.max(0, zipBuffer.length - 65558); i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw appError('BACKUP_CORRUPT', '无法找到 Zip 目录记录 (EOCD)');
  }

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  let curOffset = centralOffset;
  const files = [];
  const seen=new Set(); let total=0;
  if(totalEntries>MAX_FILE_COUNT) throw appError('RESOURCE_LIMIT','ZIP 文件数量超限');

  for (let i = 0; i < totalEntries; i++) {
    if (curOffset + 46 > zipBuffer.length) {
      throw appError('BACKUP_CORRUPT', 'Zip 中心目录越界');
    }
    const sig = zipBuffer.readUInt32LE(curOffset);
    if (sig !== 0x02014b50) {
      throw appError('BACKUP_CORRUPT', `无效的 Zip 目录头部签名: 0x${sig.toString(16)}`);
    }

    const method = zipBuffer.readUInt16LE(curOffset + 10);
    const expectedCrc = zipBuffer.readUInt32LE(curOffset + 16);
    const compressedSize = zipBuffer.readUInt32LE(curOffset + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(curOffset + 24);
    const nameLen = zipBuffer.readUInt16LE(curOffset + 28);
    const extraLen = zipBuffer.readUInt16LE(curOffset + 30);
    const commentLen = zipBuffer.readUInt16LE(curOffset + 32);
    const localOffset = zipBuffer.readUInt32LE(curOffset + 42);

    const nameBuf = zipBuffer.subarray(curOffset + 46, curOffset + 46 + nameLen);
    const fileName = nameBuf.toString('utf8');
    if(!Buffer.from(fileName,'utf8').equals(nameBuf)) throw appError('BACKUP_CORRUPT','文件名编码无效');
    const normalized=fileName.normalize('NFC').replace(/\\/g,'/').toLowerCase();
    if(!isSafeRelativePath(fileName)||fileName.includes('\\')||fileName.split('/').some(p=>!p||p==='.'||/[. ]$/.test(p))) throw appError('PATH_TRAVERSAL','ZIP 路径无效');
    if(seen.has(normalized)) throw appError('BACKUP_CORRUPT','ZIP 路径重复');
    seen.add(normalized);
    if(uncompressedSize>MAX_SINGLE_FILE_BYTES || total+uncompressedSize>MAX_TOTAL_UNCOMPRESSED_BYTES) throw appError('RESOURCE_LIMIT','ZIP 解压大小超限');

    // Read local header to get actual payload
    if (localOffset + 30 > zipBuffer.length) {
      throw appError('BACKUP_CORRUPT', '本地文件头部越界');
    }
    const localSig = zipBuffer.readUInt32LE(localOffset);
    if (localSig !== 0x04034b50) {
      throw appError('BACKUP_CORRUPT', '本地文件头部签名不匹配');
    }

    const localNameLen = zipBuffer.readUInt16LE(localOffset + 26);
    const localExtraLen = zipBuffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > zipBuffer.length) {
      throw appError('BACKUP_CORRUPT', '文件数据区域越界');
    }

    const rawChunk = zipBuffer.subarray(dataStart, dataEnd);
    let decompressed;
    if (method === 8) {
      try {
        decompressed = zlib.inflateRawSync(rawChunk, {maxOutputLength: Math.min(MAX_SINGLE_FILE_BYTES,MAX_TOTAL_UNCOMPRESSED_BYTES-total)});
      } catch (err) {
        throw appError('BACKUP_CORRUPT', `解压文件 ${fileName} 失败: ${err.message}`);
      }
    } else if (method === 0) {
      if(rawChunk.length>MAX_SINGLE_FILE_BYTES || rawChunk.length+total>MAX_TOTAL_UNCOMPRESSED_BYTES) throw appError('RESOURCE_LIMIT','实际解压长度超限');
      decompressed = Buffer.from(rawChunk);
    } else {
      throw appError('BACKUP_CORRUPT', `不支持的压缩方式: ${method}`);
    }

    total+=decompressed.length;
    if(decompressed.length>MAX_SINGLE_FILE_BYTES||total>MAX_TOTAL_UNCOMPRESSED_BYTES) throw appError('RESOURCE_LIMIT','ZIP 实际解压超限');
    if (decompressed.length !== uncompressedSize) {
      throw appError('BACKUP_CORRUPT', `文件 ${fileName} 解压大小与记录不符`);
    }

    const actualCrc = crc32(decompressed);
    if (expectedCrc !== 0 && actualCrc !== expectedCrc) {
      throw appError('BACKUP_CORRUPT', `文件 ${fileName} CRC 校验失败`);
    }

    files.push({
      path: fileName,
      data: decompressed
    });

    curOffset += 46 + nameLen + extraLen + commentLen;
  }

  return files;
}

module.exports = {
  writeZip,
  readZip
};
