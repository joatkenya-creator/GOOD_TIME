import { afterEach, describe, expect, it } from 'vitest';

import { createLocalListStore } from '@/features/catalog/local-list';

/**
 * Wishlist, compare and recently-viewed all run on this store, and none of it is
 * reachable by a type-check: the ordering, the cap, the de-duplication and the
 * corrupt-storage handling are all runtime behaviour.
 */
afterEach(() => {
  localStorage.clear();
});

describe('local list store', () => {
  it('persists to localStorage under its own key', () => {
    const store = createLocalListStore('test.list', 10);
    store.add('a');

    expect(JSON.parse(localStorage.getItem('test.list')!)).toEqual(['a']);
  });

  it('starts empty and reports membership', () => {
    const store = createLocalListStore('test.empty', 10);

    expect(store.getSnapshot()).toEqual([]);
    expect(store.has('a')).toBe(false);
  });

  it('keeps newest first', () => {
    const store = createLocalListStore('test.order', 10);
    store.add('a');
    store.add('b');
    store.add('c');

    expect(store.getSnapshot()).toEqual(['c', 'b', 'a']);
  });

  it('never duplicates, and re-adding moves to the front', () => {
    // This is what recently-viewed depends on: revisiting a product promotes it.
    const store = createLocalListStore('test.dupe', 10);
    store.add('a');
    store.add('b');
    store.add('a');

    expect(store.getSnapshot()).toEqual(['a', 'b']);
  });

  it('enforces the cap by dropping the oldest', () => {
    const store = createLocalListStore('test.cap', 3);
    for (const id of ['a', 'b', 'c', 'd', 'e']) store.add(id);

    expect(store.getSnapshot()).toEqual(['e', 'd', 'c']);
  });

  it('toggles and reports the resulting state', () => {
    const store = createLocalListStore('test.toggle', 10);

    expect(store.toggle('a')).toBe(true);
    expect(store.has('a')).toBe(true);
    expect(store.toggle('a')).toBe(false);
    expect(store.has('a')).toBe(false);
  });

  it('removes and clears', () => {
    const store = createLocalListStore('test.remove', 10);
    store.add('a');
    store.add('b');

    store.remove('a');
    expect(store.getSnapshot()).toEqual(['b']);

    store.clear();
    expect(store.getSnapshot()).toEqual([]);
  });

  it('returns a stable snapshot identity between reads', () => {
    // `useSyncExternalStore` re-renders forever if the snapshot identity changes
    // on every call. This is the check that catches that.
    const store = createLocalListStore('test.identity', 10);
    store.add('a');

    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it('gives an empty server snapshot so hydration matches', () => {
    const store = createLocalListStore('test.ssr', 10);
    store.add('a');

    expect(store.getServerSnapshot()).toEqual([]);
  });

  it('notifies subscribers on change, and stops after unsubscribe', () => {
    const store = createLocalListStore('test.subs', 10);
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });

    store.add('a');
    expect(calls).toBe(1);

    store.remove('a');
    expect(calls).toBe(2);

    unsubscribe();
    store.add('b');
    expect(calls).toBe(2);
  });

  it('survives corrupt stored JSON', () => {
    // Private-mode storage, a truncated write, or a value from an older version.
    localStorage.setItem('test.corrupt', '{not json');
    const store = createLocalListStore('test.corrupt', 10);

    expect(store.getSnapshot()).toEqual([]);
    expect(() => store.add('a')).not.toThrow();
  });

  it('discards a stored value of the wrong shape', () => {
    localStorage.setItem('test.shape', '{"a":1}');
    const store = createLocalListStore('test.shape', 10);

    expect(store.getSnapshot()).toEqual([]);
  });

  it('filters non-string entries out of a stored array', () => {
    localStorage.setItem('test.mixed', '["a", 3, null, "b"]');
    const store = createLocalListStore('test.mixed', 10);

    expect(store.getSnapshot()).toEqual(['a', 'b']);
  });

  it('keeps separate keys isolated', () => {
    const wishlist = createLocalListStore('test.wishlist', 10);
    const compare = createLocalListStore('test.compare', 10);

    wishlist.add('a');

    expect(compare.getSnapshot()).toEqual([]);
    expect(wishlist.getSnapshot()).toEqual(['a']);
  });
});
