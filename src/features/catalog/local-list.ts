/**
 * Browser-persisted product lists.
 *
 * Wishlist, compare and recently-viewed are the same problem three times: an
 * ordered, capped, de-duplicated list of product ids that survives a reload and
 * is shared by every component on the page. One store factory rather than three
 * near-identical hooks.
 *
 * Built on `useSyncExternalStore` so a header badge and a card button always agree,
 * and so there is a correct server snapshot for hydration — `localStorage` does not
 * exist during SSR, and reading it in an effect causes a flash of the wrong count.
 *
 * ## Why local rather than the database
 *
 * A guest has no user row to hang a wishlist off, and asking someone to register
 * before they can save an item loses the save. Signed-in customers additionally
 * get server persistence (`Wishlist` / `RecentlyViewed`); this is the layer that
 * works for everyone, and the merge on sign-in is a later phase.
 */

export interface LocalListStore {
  key: string;
  limit: number;
  subscribe: (onChange: () => void) => () => void;
  /** Cached snapshot — `useSyncExternalStore` requires referential stability. */
  getSnapshot: () => readonly string[];
  getServerSnapshot: () => readonly string[];
  add: (id: string) => void;
  remove: (id: string) => void;
  toggle: (id: string) => boolean;
  clear: () => void;
  has: (id: string) => boolean;
}

const EMPTY: readonly string[] = Object.freeze([]);

export function createLocalListStore(key: string, limit: number): LocalListStore {
  const listeners = new Set<() => void>();
  let snapshot: readonly string[] | null = null;

  function read(): readonly string[] {
    if (typeof window === 'undefined') return EMPTY;

    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return EMPTY;

      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return EMPTY;

      return Object.freeze(parsed.filter((entry): entry is string => typeof entry === 'string'));
    } catch {
      // Corrupt JSON, or storage blocked in private mode. Degrade to empty
      // rather than throwing inside a render.
      return EMPTY;
    }
  }

  function write(next: readonly string[]): void {
    // Freeze and cache before notifying, so every subscriber reads the same array
    // identity and React does not re-render in a loop.
    snapshot = Object.freeze(next.slice(0, limit));

    try {
      window.localStorage.setItem(key, JSON.stringify(snapshot));
    } catch {
      // Quota exceeded or storage disabled — keep the in-memory list working.
    }

    for (const listener of listeners) listener();
  }

  const store: LocalListStore = {
    key,
    limit,

    subscribe(onChange) {
      listeners.add(onChange);

      // Another tab changing the list must be reflected here, or a wishlist
      // opened in two tabs silently diverges.
      const onStorage = (event: StorageEvent) => {
        if (event.key !== key) return;
        snapshot = null;
        onChange();
      };
      window.addEventListener('storage', onStorage);

      return () => {
        listeners.delete(onChange);
        window.removeEventListener('storage', onStorage);
      };
    },

    getSnapshot() {
      snapshot ??= read();
      return snapshot;
    },

    getServerSnapshot() {
      return EMPTY;
    },

    add(id) {
      const current = store.getSnapshot();
      // Newest first, and re-adding an existing id moves it to the front, which
      // is exactly the behaviour recently-viewed needs.
      write([id, ...current.filter((entry) => entry !== id)]);
    },

    remove(id) {
      write(store.getSnapshot().filter((entry) => entry !== id));
    },

    toggle(id) {
      const present = store.has(id);
      if (present) store.remove(id);
      else store.add(id);
      return !present;
    },

    clear() {
      write([]);
    },

    has(id) {
      return store.getSnapshot().includes(id);
    },
  };

  return store;
}

/**
 * The three lists.
 *
 * Caps are deliberate. Compare above four columns is unreadable; recently-viewed
 * beyond twenty is not "recent"; a wishlist cap keeps the payload sane when it is
 * hydrated into cards.
 */
export const wishlistStore = createLocalListStore('gt.wishlist', 100);
export const compareStore = createLocalListStore('gt.compare', 4);
export const recentlyViewedStore = createLocalListStore('gt.recently-viewed', 20);

export const COMPARE_LIMIT = compareStore.limit;
