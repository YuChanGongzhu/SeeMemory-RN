/**
 * MD5 工具单测（RFC 1321 标准向量）——固件下载完整性校验依赖它正确。
 */
import {md5} from '../src/utils/md5';

function toBytes(s: string): Uint8Array {
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) {
    a[i] = s.charCodeAt(i) & 0xff;
  }
  return a;
}

describe('md5', () => {
  it('标准测试向量', () => {
    expect(md5(new Uint8Array(0))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5(toBytes('a'))).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(md5(toBytes('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5(toBytes('message digest'))).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5(toBytes('The quick brown fox jumps over the lazy dog'))).toBe(
      '9e107d9d372bb6826bd81d3542a419d6',
    );
  });

  it('补位/跨块边界', () => {
    // 55/56 字节正好卡在「长度域是否需要多一个块」的边界；80 字节跨两个 512bit 块。
    expect(md5(toBytes('a'.repeat(55)))).toBe('ef1772b6dff9a122358552954ad0df65');
    expect(md5(toBytes('a'.repeat(56)))).toBe('3b0c8ac703f828b04c6c197006d17218');
    expect(md5(toBytes('a'.repeat(80)))).toBe('b15af9cdabbaea0516866a33d8fd0f98');
  });
});
