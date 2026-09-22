import {
  clone,
  normalize,
  merge,
  same,
  substantive,
  resolve,
  validate,
} from "./core.js";
const request = (r) =>
  new Promise((yes, no) => {
    r.onsuccess = () => yes(r.result);
    r.onerror = () => no(r.error);
  });
export class LedgerStore extends EventTarget {
  constructor() {
    super();
    this.status = "기기 저장소 여는 중";
    this.error = "";
    this.busy = false;
    this.state = null;
    this.serial = Promise.resolve();
  }
  async init() {
    this.db = await new Promise((yes, no) => {
      const r = indexedDB.open("accountbook-v2", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("data");
      r.onsuccess = () => yes(r.result);
      r.onerror = () => no(r.error);
    });
    await this.lock(async () => {
      let env = await this.read("ledger");
      if (!env) {
        let legacy = null;
        const raw = localStorage.getItem("household_data");
        if (raw) {
          try {
            legacy = JSON.parse(raw);
          } catch {
            await this.write("legacy-corrupt", raw);
            throw Error(
              "이전 기기 데이터가 손상되었습니다. 원본을 먼저 보관해주세요.",
            );
          }
        }
        if (legacy) await this.write("legacy-original", legacy);
        env = {
          base: null,
          working: normalize(legacy || {}),
          revision: 0,
          conflicts: [],
          clientId: crypto.randomUUID(),
          hasLocal: !!legacy,
        };
        await this.write("ledger", env);
      }
      this.state = env;
    });
    this.channel =
      typeof BroadcastChannel === "function"
        ? new BroadcastChannel("accountbook-updates")
        : null;
    if (this.channel) this.channel.onmessage = () => void this.refresh();
    this.status = "기기에 저장됨";
    this.emit();
  }
  read(key) {
    return request(this.db.transaction("data").objectStore("data").get(key));
  }
  write(key, value) {
    return new Promise((yes, no) => {
      const tx = this.db.transaction("data", "readwrite");
      tx.objectStore("data").put(value, key);
      tx.oncomplete = yes;
      tx.onerror = () => no(tx.error);
      tx.onabort = () => no(tx.error || Error("저장을 완료하지 못했습니다."));
    });
  }
  lock(fn) {
    const run = () =>
      navigator.locks ? navigator.locks.request("accountbook-write", fn) : fn();
    const p = this.serial.then(run, run);
    this.serial = p.catch(() => {});
    return p;
  }
  emit() {
    this.dispatchEvent(new Event("change"));
  }
  get data() {
    return this.state?.working || normalize();
  }
  get pending() {
    return (
      !!this.state &&
      (!this.state.base ||
        !same(substantive(this.state.working), substantive(this.state.base)))
    );
  }
  async refresh() {
    this.state = await this.read("ledger");
    this.emit();
  }
  async commit(env) {
    await this.write("ledger", env);
    this.state = env;
    this.channel?.postMessage("saved");
    this.emit();
  }
  async edit(fn) {
    return this.lock(async () => {
      const env = clone(await this.read("ledger"));
      if (env.conflicts.length)
        throw Error("먼저 저장 충돌을 확인해주세요. 입력 초안은 보관됩니다.");
      fn(env.working);
      const problem = validate(env.working);
      if (problem) throw Error(problem);
      await this.commit(env);
      this.status = "기기 저장 완료 · 동기화 대기";
      this.error = "";
      this.emit();
    });
  }
  async resolveOne(index, choice, expected) {
    await this.lock(async () => {
      const env = clone(await this.read("ledger"));
      const conflict = env.conflicts[index];
      if (!conflict) return;
      if (expected && !same(expected, conflict))
        throw Error("다른 탭에서 내용을 변경했습니다. 다시 확인해주세요.");
      env.working = resolve(env.working, conflict, choice);
      env.conflicts.splice(index, 1);
      const problem = validate(env.working);
      if (problem) throw Error(problem);
      await this.commit(env);
    });
  }
  async api(method = "GET", payload) {
    const response = await fetch("/api/data", {
      method,
      headers: {
        "content-type": "application/json",
        "x-accountbook-protocol": "2",
      },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json();
    if (!response.ok) {
      const e = Error(result.error || "연결을 확인해주세요.");
      e.status = response.status;
      throw e;
    }
    return result;
  }
  async sync() {
    if (this.busy || !this.state) return;
    this.busy = true;
    this.status = "동기화 중";
    this.emit();
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const remote = await this.api();
        await this.lock(async () => {
          const env = clone(await this.read("ledger"));
          if (env.conflicts.length || env.revision > remote.revision) return;
          if (!remote.initialized) {
            if (!env.base) env.base = normalize();
            env.revision = remote.revision;
            await this.commit(env);
            return;
          }
          const result =
            env.base || env.hasLocal
              ? merge(env.base, env.working, remote.data)
              : { data: normalize(remote.data), conflicts: [] };
          if (result.conflicts.length)
            await this.write("conflict-" + Date.now(), {
              local: env.working,
              remote: remote.data,
              base: env.base,
            });
          env.working = result.data;
          env.conflicts = result.conflicts;
          env.base = normalize(remote.data);
          env.revision = remote.revision;
          env.hasLocal = true;
          await this.commit(env);
        });
        if (this.state.conflicts.length) {
          this.status = "변경 내용 확인 필요";
          break;
        }
        if (!this.pending) {
          this.status = "동기화 완료";
          this.error = "";
          break;
        }
        const sent = clone(this.state);
        try {
          const response = await this.api("PUT", {
            baseRevision: sent.revision,
            data: sent.working,
            clientId: sent.clientId,
          });
          await this.lock(async () => {
            const current = clone(await this.read("ledger"));
            if (current.revision <= response.revision) {
              current.base = sent.working;
              current.revision = response.revision;
              await this.commit(current);
            }
          });
          this.status = this.pending
            ? "기기 저장 완료 · 동기화 대기"
            : "동기화 완료";
          this.error = "";
          if (!this.pending) break;
        } catch (error) {
          if (error.status === 409) continue;
          throw error;
        }
      }
    } catch (error) {
      this.error =
        error.status === 401
          ? "로그인이 만료됐습니다. 기기 기록은 보관돼 있습니다."
          : error.message;
      this.status = "기기에 보관됨 · 연결 확인 필요";
    } finally {
      this.busy = false;
      if (this.status === "동기화 중" && this.pending)
        this.status = "기기 저장 완료 · 동기화 대기";
      this.emit();
    }
  }
  async backup() {
    const env = await this.read("ledger");
    return {
      exportedAt: new Date().toISOString(),
      data: env.working,
      revision: env.revision,
      base: env.base,
      conflicts: env.conflicts,
    };
  }
  async savedCopies() {
    const keys = await request(
      this.db.transaction("data").objectStore("data").getAllKeys(),
    );
    return keys.filter((k) => k !== "ledger");
  }
  async importData(data) {
    const normalized = normalize(data);
    const problem = validate(normalized);
    if (problem) throw Error(problem);
    await this.lock(async () => {
      const env = clone(await this.read("ledger"));
      if (env.conflicts.length)
        throw Error("먼저 기존 변경 충돌을 확인해주세요.");
      await this.write("before-import-" + Date.now(), clone(env));
      const result = merge(null, normalized, env.working);
      env.working = result.data;
      env.conflicts = result.conflicts;
      env.hasLocal = true;
      await this.commit(env);
    });
  }
}
