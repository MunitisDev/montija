import { describe, expect, it } from 'vitest';
import { SeededRandom, deriveSeed } from '@/shared/math/random';

describe('SeededRandom', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new SeededRandom(1234);
    const b = new SeededRandom(1234);

    const first = Array.from({ length: 32 }, () => a.next());
    const second = Array.from({ length: 32 }, () => b.next());

    expect(first).toEqual(second);
  });

  it('produces different sequences for different seeds', () => {
    const a = new SeededRandom(1);
    const b = new SeededRandom(2);

    expect(a.next()).not.toBe(b.next());
  });

  it('stays within [0, 1)', () => {
    const random = new SeededRandom(99);

    for (let i = 0; i < 2000; i += 1) {
      const value = random.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('restores an exact position in the sequence', () => {
    const random = new SeededRandom(777);
    random.next();
    random.next();

    const state = random.getState();
    const expected = [random.next(), random.next(), random.next()];

    random.setState(state);
    expect([random.next(), random.next(), random.next()]).toEqual(expected);
  });

  it('rewinds to the beginning on reset', () => {
    const random = new SeededRandom(42);
    const first = random.next();

    random.next();
    random.reset();

    expect(random.next()).toBe(first);
  });

  describe('int', () => {
    it('stays inside the requested half-open range', () => {
      const random = new SeededRandom(5);

      for (let i = 0; i < 1000; i += 1) {
        const value = random.int(3, 7);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(3);
        expect(value).toBeLessThan(7);
      }
    });

    it('covers every value in a small range', () => {
      const random = new SeededRandom(11);
      const seen = new Set<number>();

      for (let i = 0; i < 500; i += 1) {
        seen.add(random.int(0, 4));
      }

      expect([...seen].sort()).toEqual([0, 1, 2, 3]);
    });

    it('returns the lower bound for an empty range', () => {
      const random = new SeededRandom(1);
      expect(random.int(5, 5)).toBe(5);
      expect(random.int(5, 2)).toBe(5);
    });
  });

  describe('pick', () => {
    it('returns undefined for an empty list', () => {
      expect(new SeededRandom(1).pick([])).toBeUndefined();
    });

    it('only returns members of the list', () => {
      const random = new SeededRandom(8);
      const items = ['oak', 'birch', 'pine'] as const;

      for (let i = 0; i < 200; i += 1) {
        expect(items).toContain(random.pick(items));
      }
    });
  });

  describe('float', () => {
    it('stays inside the requested range', () => {
      const random = new SeededRandom(3);

      for (let i = 0; i < 500; i += 1) {
        const value = random.float(-2, 5);
        expect(value).toBeGreaterThanOrEqual(-2);
        expect(value).toBeLessThan(5);
      }
    });
  });
});

describe('deriveSeed', () => {
  it('is deterministic', () => {
    expect(deriveSeed(100, 'world')).toBe(deriveSeed(100, 'world'));
  });

  it('separates streams by label', () => {
    expect(deriveSeed(100, 'world')).not.toBe(deriveSeed(100, 'villagers'));
  });

  it('separates streams by parent seed', () => {
    expect(deriveSeed(100, 'world')).not.toBe(deriveSeed(101, 'world'));
  });

  it('returns an unsigned 32-bit integer', () => {
    const seed = deriveSeed(0xdeadbeef, 'weather');
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(2 ** 32);
  });
});
