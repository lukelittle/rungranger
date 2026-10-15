import { describe, expect, it } from 'vitest';
import { addressesOverlap, AddressError, formatAddress, isValidSymbolName, normalizeAddress, parseAddress, resolveAddress } from './address';
import { defaultDataFiles } from './project';

const files = defaultDataFiles();

describe('parseAddress', () => {
  it('parses I/O bit addresses with and without word selector', () => {
    expect(parseAddress('I:1/0')).toMatchObject({ type: 'I', file: 1, element: 1, bit: 0, kind: 'bit' });
    expect(parseAddress('i:1.0/5')).toMatchObject({ type: 'I', element: 1, bit: 5 });
    expect(parseAddress('O:2/15')).toMatchObject({ type: 'O', file: 0, element: 2, bit: 15 });
    expect(parseAddress('O0:2/3')).toMatchObject({ type: 'O', file: 0, element: 2, bit: 3 });
    expect(parseAddress('I:3')).toMatchObject({ type: 'I', element: 3, bit: null, kind: 'word' });
  });

  it('parses binary flat and element bit addresses', () => {
    expect(parseAddress('B3/21')).toMatchObject({ element: 1, bit: 5, kind: 'bit' });
    expect(parseAddress('B3:1/5')).toMatchObject({ element: 1, bit: 5, kind: 'bit' });
    expect(parseAddress('B3:2')).toMatchObject({ element: 2, bit: null, kind: 'word' });
  });

  it('parses timer, counter and control members', () => {
    expect(parseAddress('T4:0')).toMatchObject({ kind: 'element', element: 0 });
    expect(parseAddress('T4:3.ACC')).toMatchObject({ kind: 'word', wordOffset: 2, member: 'ACC' });
    expect(parseAddress('T4:3.PRE')).toMatchObject({ kind: 'word', wordOffset: 1 });
    expect(parseAddress('T4:3/DN')).toMatchObject({ kind: 'bit', wordOffset: 0, bit: 13 });
    expect(parseAddress('T4:3.EN')).toMatchObject({ kind: 'bit', bit: 15 });
    expect(parseAddress('C5:1/CU')).toMatchObject({ bit: 15 });
    expect(parseAddress('C5:1/OV')).toMatchObject({ bit: 12 });
    expect(parseAddress('R6:0.POS')).toMatchObject({ wordOffset: 2 });
    expect(parseAddress('N7:4/3')).toMatchObject({ type: 'N', element: 4, bit: 3 });
    expect(parseAddress('F8:2')).toMatchObject({ type: 'F', element: 2, kind: 'word' });
    expect(parseAddress('S:1/15')).toMatchObject({ type: 'S', file: 2, element: 1, bit: 15 });
  });

  it('rejects malformed addresses', () => {
    for (const bad of ['', 'X1:0', 'N7', 'N:0', 'B3:0/16', 'F8:0/1', 'T4:0/XX', 'I2:1/0', 'N2:0', 'C5:0.LEN', 'N7:0.1', 'I:1.1/0', 'N7/3']) {
      expect(() => parseAddress(bad), bad).toThrow(AddressError);
    }
  });
});

describe('resolveAddress', () => {
  it('computes word offsets for structured files', () => {
    expect(resolveAddress('T4:2.ACC', files).word).toBe(8);
    expect(resolveAddress('C5:1/DN', files).word).toBe(3);
    expect(resolveAddress('N7:5', files).word).toBe(5);
  });

  it('checks file existence and element range', () => {
    expect(() => resolveAddress('N9:0', files)).toThrow(/does not exist/);
    expect(() => resolveAddress('N7:32', files)).toThrow(/out of range/);
    expect(() => resolveAddress('I:4/0', files)).toThrow(/out of range/);
    expect(resolveAddress('I:3/15', files).key).toBe('I1');
  });
});

describe('formatting and helpers', () => {
  it('formats canonically', () => {
    expect(normalizeAddress('t4:0.dn')).toBe('T4:0/DN');
    expect(normalizeAddress('b3/17')).toBe('B3:1/1');
    expect(normalizeAddress('i1:1.0/2')).toBe('I:1/2');
    expect(formatAddress(parseAddress('c5:0.acc'))).toBe('C5:0.ACC');
  });

  it('detects overlapping addresses', () => {
    const r = (s: string) => resolveAddress(s, files);
    expect(addressesOverlap(r('T4:0'), r('T4:0/DN'))).toBe(true);
    expect(addressesOverlap(r('T4:0.ACC'), r('T4:0'))).toBe(true);
    expect(addressesOverlap(r('T4:1'), r('T4:0/DN'))).toBe(false);
    expect(addressesOverlap(r('B3:0'), r('B3/5'))).toBe(true);
    expect(addressesOverlap(r('B3:0/4'), r('B3/5'))).toBe(false);
  });

  it('validates symbol names', () => {
    expect(isValidSymbolName('START_PB')).toBe(true);
    expect(isValidSymbolName('N7:0')).toBe(false);
    expect(isValidSymbolName('1ABC')).toBe(false);
    expect(isValidSymbolName('B3')).toBe(false); // too address-like to be unambiguous
    expect(isValidSymbolName('Motor1')).toBe(true);
  });
});
