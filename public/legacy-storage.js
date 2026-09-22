import { LedgerStore } from "./sync.js";
import { clone, normalize, merge, same } from "./core.js";

// Storage-only adapter: the pre-redesign UI and input handlers stay unchanged.
export function createLegacyStorage({ read, apply, status, repaint }) {
  const store = new LedgerStore();
  const key = "accountbook-classic-pending";
  let baseline,
    dirty = false,
    generation = 0,
    task = null,
    failure = "";
  function publish() {
    status({
      pending: dirty || store.pending,
      error: failure || store.error,
      conflicts: store.state?.conflicts || [],
      revision: store.state?.revision || 0,
    });
  }
  function receive() {
    if (!dirty && store.state) {
      const incoming = clone(store.data);
      if (!same(normalize(read()), incoming)) {
        apply(incoming);
        baseline = clone(normalize(read()));
        repaint();
      } else baseline = clone(normalize(read()));
    }
    publish();
  }
  async function flush() {
    if (task) return task;
    task = (async () => {
      while (dirty) {
        const version = generation,
          local = clone(normalize(read())),
          previous = clone(baseline);
        await store.edit((data) => {
          const result = merge(previous, local, data);
          if (result.conflicts.length)
            throw Error(
              "다른 기기의 수정과 충돌했습니다. 입력 내용은 기기에 보관했습니다.",
            );
          Object.assign(data, result.data);
        });
        baseline = clone(local);
        if (generation === version) {
          localStorage.removeItem(key);
          dirty = false;
        } else {
          localStorage.setItem(
            key,
            JSON.stringify({ base: baseline, data: normalize(read()) }),
          );
        }
      }
      failure = "";
      receive();
      await store.sync();
    })()
      .catch((error) => {
        failure = error.message;
        publish();
        return false;
      })
      .finally(() => {
        task = null;
        if (dirty && !failure) queueMicrotask(() => void flush());
      });
    return task;
  }
  return {
    async init() {
      if (!navigator.locks)
        throw Error("안전한 저장을 위해 브라우저를 업데이트해주세요.");
      await store.init();
      const pending = localStorage.getItem(key);
      if (pending) {
        const saved = JSON.parse(pending);
        await store.lock(async () => {
          const env = clone(await store.read("ledger"));
          // Keep an additional copy even if recovery meets an existing conflict.
          await store.write("classic-recovery-" + Date.now(), saved);
          if (!env.conflicts.length) {
            const result = merge(saved.base, saved.data, env.working);
            env.working = result.data;
            env.conflicts = result.conflicts;
            await store.commit(env);
          } else
            throw Error(
              "저장 충돌을 먼저 확인해야 합니다. 기기 사본은 보관되어 있습니다.",
            );
        });
        localStorage.removeItem(key);
      }
      apply(clone(store.data));
      baseline = clone(normalize(read()));
      store.addEventListener("change", receive);
      publish();
      window.addEventListener("online", () => void this.sync());
    },
    save() {
      // A synchronous recovery checkpoint precedes the classic UI's success toast.
      localStorage.setItem(
        key,
        JSON.stringify({ base: baseline, data: normalize(read()) }),
      );
      dirty = true;
      generation++;
      publish();
      void flush();
    },
    async sync() {
      if (dirty || task) await flush();
      if (dirty) return false;
      await store.sync();
      receive();
      return !store.pending && !store.error && !store.state.conflicts.length;
    },
  };
}
