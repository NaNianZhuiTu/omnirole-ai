/* 极简 ZIP 读取（仅用 Node 内置 zlib），用于解析 .xlsx / .docx。
 * 不引入第三方依赖，保证安装包自包含、离线可用。
 * 支持 store(0) 与 deflate(8)，足够覆盖 Office Open XML。
 */
'use strict';
const zlib = require('zlib');

function u16(b, o) { return b.readUInt16LE(o); }
function u32(b, o) { return b.readUInt32LE(o); }

function findEOCD(buf) {
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (u32(buf, i) === 0x06054b50) return i;
  }
  throw new Error('不是有效的 ZIP 文件（未找到 EOCD）');
}

function readZipEntries(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const eocd = findEOCD(buf);
  const count = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  const out = Object.create(null);

  for (let i = 0; i < count; i++) {
    if (u32(buf, p) !== 0x02014b50) break;
    const method = u16(buf, p + 10);
    const compSize = u32(buf, p + 20);
    const nameLen = u16(buf, p + 28);
    const extraLen = u16(buf, p + 30);
    const commentLen = u16(buf, p + 32);
    const localOff = u32(buf, p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    if (u32(buf, localOff) === 0x04034b50) {
      const lNameLen = u16(buf, localOff + 26);
      const lExtraLen = u16(buf, localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(dataStart, dataStart + compSize);
      try {
        if (method === 0) out[name] = Buffer.from(raw);
        else if (method === 8) out[name] = zlib.inflateRawSync(raw);
      } catch (e) {
        // 单个条目损坏不应让整份资料无法读取
      }
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

module.exports = { readZipEntries };
