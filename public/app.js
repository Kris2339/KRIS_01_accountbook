import { LedgerStore } from "./sync.js";
import {
  clone,
  normalize,
  merge,
  same,
  localDate,
  monthRows,
  totals,
} from "./core.js";
const $ = (s) => document.querySelector(s),
  store = new LedgerStore();
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (n) => new Intl.NumberFormat("ko-KR").format(n || 0);
const won = (n) => `${money(n)}원`;
const dateLabel = (s) => {
  const d = new Date(s + "T12:00:00");
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${"일월화수목금토"[d.getDay()]}요일`;
};
const paths = {
  tag: "M20 13l-7 7L3 10V3h7z M7 7h.01",
  food: "M4 3v6c0 3 6 3 6 0V3 M7 3v18 M18 3c-4 3-4 9 0 9h2 M20 3v18",
  coffee:
    "M4 7h12v9a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z M16 8h2a3 3 0 0 1 0 6h-2 M7 3v1 M12 3v1",
  home: "M3 11l9-8 9 8 M5 10v11h14V10 M9 21v-7h6v7",
  bag: "M4 7h16l1 14H3z M8 8V6a4 4 0 0 1 8 0v2",
  car: "M5 6h14l3 9v5h-3v-3H5v3H2v-5z M3 13h18 M6 16h.01 M18 16h.01",
  heart: "M12 21L3 12C-3 4 7-1 12 6c5-7 15-2 9 6z",
  gift: "M3 8h18v4H3z M5 12v9h14v-9 M12 8v13 M12 8C2 8 5-1 10 4z M12 8c10 0 7-9 2-4z",
  card: "M3 5h18v14H3z M3 10h18 M7 15h3",
  bank: "M2 8l10-5 10 5z M5 10v9 M10 10v9 M15 10v9 M20 10v9 M2 21h20",
  wallet: "M3 6h17v14H3z M3 6V3h15 M15 11h7v5h-7z",
  user: "M8 6a4 4 0 1 0 8 0 4 4 0 1 0-8 0 M4 22v-3c0-7 16-7 16 0v3",
  note: "M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5",
  chart: "M4 20V10 M10 20V4 M16 20v-7 M22 20H2",
  transfer: "M3 7h17l-4-4 M21 17H4l4 4",
  dots: "M5 12h.01 M12 12h.01 M19 12h.01",
};
const iconNames = {
  tag: "분류",
  food: "식사",
  coffee: "카페",
  home: "주거",
  bag: "쇼핑",
  car: "교통",
  heart: "건강",
  gift: "선물",
  card: "카드",
  bank: "계좌",
  wallet: "지갑",
  user: "사람",
  note: "메모",
  chart: "분석",
  transfer: "이체",
  dots: "기타",
};
function suggested(name = "") {
  return /식|외식|간식/.test(name)
    ? "food"
    : /카페|커피/.test(name)
      ? "coffee"
      : /교통|차량|자동차/.test(name)
        ? "car"
        : /주거|생활|통신/.test(name)
          ? "home"
          : /쇼핑|의류/.test(name)
            ? "bag"
            : /의료|건강|미용/.test(name)
              ? "heart"
              : /경조|선물/.test(name)
                ? "gift"
                : "tag";
}
function icon(key = "tag", color) {
  key = paths[key] ? key : "tag";
  color = /^#[0-9a-f]{6}$/i.test(color || "") ? color : "#287d73";
  return `<span class="tile" style="color:${color};background:${color}12"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[key]}"/></svg></span>`;
}
const find = (key, id) => store.data[key]?.find((x) => x.id === id);
const name = (key, id) => find(key, id)?.name || "미지정";
const active = (key) =>
  store.data[key]
    .filter((x) => !x.archived)
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
function options(key, selected, blank = "", filter = () => true) {
  return (
    (blank ? `<option value="">${esc(blank)}</option>` : "") +
    store.data[key]
      .filter((x) => (!x.archived || x.id === selected) && filter(x))
      .map(
        (x) =>
          `<option value="${esc(x.id)}" ${x.id === selected ? "selected" : ""}>${esc(x.name)}${x.archived ? " (보관)" : ""}</option>`,
      )
      .join("")
  );
}
let prefs = { userId: "", methodId: "", assetId: "", snippets: [] };
try {
  prefs = {
    ...prefs,
    ...JSON.parse(localStorage.getItem("accountbook-preferences") || "{}"),
  };
  const old = JSON.parse(
    localStorage.getItem("household_ui_preferences_v1") || "{}",
  );
  prefs.userId ||= old.deviceUserId || "";
  prefs.methodId ||= old.lastPaymentMethodId || "";
} catch {}
function persistPrefs() {
  localStorage.setItem("accountbook-preferences", JSON.stringify(prefs));
}
const ui = {
  month: localDate().slice(0, 7),
  user: "all",
  type: "all",
  category: "all",
  query: "",
  view: "list",
  day: "",
  limit: 80,
  scroll: {},
};
let page = "ledger",
  lastData = "",
  toastTimer,
  editorRecord = null,
  editorOriginal = null,
  saving = false;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 3500);
}
function download(filename, data) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function run(fn) {
  return async (e) => {
    try {
      await fn(e);
    } catch (error) {
      toast(error.message || "작업을 완료하지 못했습니다.");
    }
  };
}
function header(title, sub) {
  title =
    page === "ledger"
      ? "거래 내역"
      : page === "reports"
        ? "지출 리포트"
        : "설정";
  return `<div class="page-head"><div><div class="eyebrow">${sub}</div><h1>${title}</h1></div>${page !== "settings" ? `<div class="month-nav"><button class="icon-button" data-month-step="-1" aria-label="이전 달">‹</button><input type="month" id="month" aria-label="조회 월" value="${ui.month}"><button class="icon-button" data-month-step="1" aria-label="다음 달">›</button></div>` : ""}</div>`;
}
function summary(rows) {
  const t = totals(rows);
  return `<div class="summary-grid"><div class="card"><div class="muted">${ui.user === "all" ? "이번 달 지출" : esc(name("users", ui.user)) + " 지출"}</div><div class="big-number">${money(t.expense)} <span>원</span></div></div><div class="card"><div class="muted">수입</div><div class="big-number">${money(t.income)} <span>원</span></div></div><div class="card"><div class="muted">수입 − 지출</div><div class="big-number">${money(t.income - t.expense)} <span>원</span></div></div></div>`;
}
function transactionRow(t) {
  const c = find("categories", t.categoryId),
    title =
      t.merchant ||
      t.memo?.split("\n")[0] ||
      (t.type === "transfer" ? "항목 간 이동" : c?.name) ||
      "거래";
  return `<button class="transaction" data-transaction="${esc(t.id)}">${icon(t.type === "transfer" ? "transfer" : c?.iconKey || suggested(c?.name), c?.color)}<div class="transaction-copy"><div class="transaction-title">${esc(title)}</div><div class="transaction-meta">${esc(t.type === "transfer" ? "이동" : c?.name || "미분류")} · ${esc(name("paymentMethods", t.paymentMethodId))} · ${esc(name("users", t.userId))}</div>${t.memo ? `<div class="transaction-memo">${esc(t.memo)}</div>` : ""}</div><div class="amount ${t.type === "income" ? "income" : t.type === "transfer" ? "neutral" : ""}">${t.type === "income" ? "+" : t.type === "transfer" ? "" : "−"}${money(t.amount)}</div></button>`;
}
function filteredRows() {
  const query = ui.query.trim().toLocaleLowerCase();
  return monthRows(store.data, ui.month, ui.user)
    .filter(
      (t) =>
        (ui.type === "all" || t.type === ui.type) &&
        (ui.category === "all" || (t.categoryId || "") === ui.category) &&
        (!ui.day || t.transactionDate === ui.day) &&
        (!query ||
          [
            t.memo,
            t.merchant,
            name("categories", t.categoryId),
            name("paymentMethods", t.paymentMethodId),
            name("users", t.userId),
            String(t.amount),
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(query)),
    )
    .sort(
      (a, b) =>
        b.transactionDate.localeCompare(a.transactionDate) ||
        (b.createdAt || "").localeCompare(a.createdAt || ""),
    );
}
function renderList() {
  const rows = filteredRows();
  let last = "";
  $("#rows").innerHTML = rows.length
    ? rows
        .slice(0, ui.limit)
        .map((t) => {
          const heading =
            t.transactionDate !== last
              ? `<div class="day-heading"><span>${dateLabel(t.transactionDate)}</span><span>${won(totals(rows.filter((x) => x.transactionDate === t.transactionDate)).expense)}</span></div>`
              : "";
          last = t.transactionDate;
          return heading + transactionRow(t);
        })
        .join("") +
      (rows.length > ui.limit
        ? '<div class="more-row"><button class="secondary" id="more">더 보기</button></div>'
        : "")
    : `<div class="empty"><strong>${ui.query ? "검색 결과가 없어요" : "아직 내역이 없어요"}</strong>${ui.query ? "메모·사용처·금액으로 다시 찾아보세요." : "아래 입력 버튼으로 첫 기록을 남겨보세요."}</div>`;
  $("#result-count").textContent =
    `${rows.length}건 · 지출 ${won(totals(rows).expense)}`;
  $("#more")?.addEventListener("click", () => {
    ui.limit += 80;
    renderList();
  });
}
function calendar() {
  const [y, m] = ui.month.split("-").map(Number),
    days = new Date(y, m, 0).getDate(),
    offset = new Date(y, m - 1, 1).getDay(),
    rows = monthRows(store.data, ui.month, ui.user);
  return `<div class="calendar">${[..."일월화수목금토"].map((d) => `<div class="weekday">${d}</div>`).join("")}${"<div></div>".repeat(offset)}${Array.from(
    { length: days },
    (_, i) => {
      const date = `${ui.month}-${String(i + 1).padStart(2, "0")}`,
        spent = totals(rows.filter((t) => t.transactionDate === date)).expense;
      return `<button data-day="${date}" class="${ui.day === date ? "selected" : ""}"><span>${i + 1}</span><small>${spent ? money(spent) : "·"}</small></button>`;
    },
  ).join("")}</div>`;
}
function renderLedger() {
  return (
    header("하루하루의 기록", "내역") +
    summary(monthRows(store.data, ui.month, ui.user)) +
    `<div class="toolbar"><input class="search" id="search" type="search" placeholder="메모, 사용처, 금액 검색" aria-label="내역 검색" value="${esc(ui.query)}"><select id="user-filter" aria-label="사용자 필터"><option value="all">모든 사용자</option>${options("users", ui.user)}</select><select id="type-filter" aria-label="거래 종류"><option value="all">모든 내역</option>${["expense", "income", "transfer"].map((k, i) => `<option value="${k}" ${ui.type === k ? "selected" : ""}>${["지출", "수입", "이동"][i]}</option>`).join("")}</select><div class="segmented"><button data-view="list" class="${ui.view === "list" ? "active" : ""}">목록</button><button data-view="calendar" class="${ui.view === "calendar" ? "active" : ""}">달력</button></div></div><div class="section-head"><small id="result-count"></small>${ui.day || ui.category !== "all" ? '<button class="text-button" id="clear-filter">선택 해제</button>' : ""}</div><div class="list-card">${ui.view === "calendar" ? calendar() : ""}<div id="rows"></div></div>`
  );
}
function budgetForMonth() {
  return store.data.monthlyBudgets[ui.month] || null;
}
function renderReports() {
  const rows = monthRows(store.data, ui.month, ui.user),
    spent = totals(rows).expense,
    expense = rows.filter((t) => t.type === "expense");
  const groups = new Map();
  for (const t of expense)
    groups.set(t.categoryId, (groups.get(t.categoryId) || 0) + t.amount);
  const sorted = [...groups].sort((a, b) => b[1] - a[1]);
  const b = budgetForMonth(),
    total = b?.total || 0,
    allSpent = totals(monthRows(store.data, ui.month)).expense;
  const months = Array.from({ length: 6 }, (_, i) => {
      const [y, m] = ui.month.split("-").map(Number),
        d = new Date(y, m - 6 + i, 1),
        key = localDate(d).slice(0, 7);
      return {
        key,
        label: `${d.getMonth() + 1}월`,
        amount: totals(monthRows(store.data, key, ui.user)).expense,
      };
    }),
    max = Math.max(...months.map((m) => m.amount), 1);
  return (
    header("한눈에 보는 흐름", "리포트") +
    `<div class="toolbar"><select id="user-filter" aria-label="리포트 사용자"><option value="all">모든 사용자</option>${options("users", ui.user)}</select><small>지출 기준 · 항목 간 이동 제외</small></div>` +
    summary(rows) +
    `<div class="two-col"><div class="stack"><section class="card"><div class="section-head"><h2>어디에 많이 썼을까요</h2><small>분류별 지출</small></div>${
      sorted.length
        ? sorted
            .map(([id, n]) => {
              const c = find("categories", id);
              return `<button class="breakdown" data-category="${esc(id || "")}" aria-label="${esc(c?.name || "미분류")} 내역 보기"><div class="breakdown-line"><span class="breakdown-label">${icon(c?.iconKey || suggested(c?.name), c?.color)}${esc(c?.name || "미분류")}</span><strong>${won(n)}</strong><small>${Math.round((n / spent) * 100)}%</small></div><div class="progress"><i style="width:${(n / spent) * 100}%"></i></div></button>`;
            })
            .join("")
        : '<p class="muted">지출을 기록하면 분류별로 모아드려요.</p>'
    }</section><section class="card"><div class="section-head"><h2>최근 6개월</h2><small>월 전체 지출</small></div><div class="trend">${months.map((m, i) => `<div class="trend-col ${i === 5 ? "current" : ""}"><small>${won(m.amount)}</small><i style="height:${Math.max(2, (m.amount / max) * 95)}px"></i><span>${m.label}</span></div>`).join("")}</div></section></div><div class="stack"><section class="card"><div class="section-head"><h2>이번 달 예산</h2><button class="text-button" id="budget-edit">${b ? "수정" : "설정"}</button></div><p class="muted">모든 사용자 합산</p>${total ? `<div class="big-number ${allSpent > total ? "expense" : ""}">${won(Math.abs(total - allSpent))}</div><p class="muted">${allSpent > total ? "예산보다 더 썼어요" : "남아 있어요"}</p><div class="progress ${allSpent > total ? "over" : ""}" style="margin:18px 0"><i style="width:${Math.min(100, (allSpent / total) * 100)}%"></i></div><p class="muted">${won(allSpent)} 사용 / ${won(total)} 한도</p>` : '<p style="margin:16px 0">원할 때 한도만 정해보세요.</p><p class="muted">예산 없이도 모든 거래를 기록할 수 있어요.</p>'}${Object.entries(
      b?.categories || {},
    )
      .filter(([, n]) => n > 0)
      .map(([id, n]) => {
        const used = totals(
          monthRows(store.data, ui.month).filter((t) => t.categoryId === id),
        ).expense;
        return `<div class="breakdown"><div class="breakdown-line"><span>${esc(name("categories", id))}</span><small>${won(used)} / ${won(n)}</small></div><div class="progress ${used > n ? "over" : ""}"><i style="width:${Math.min(100, (used / n) * 100)}%"></i></div></div>`;
      })
      .join(
        "",
      )}</section><section class="card"><div class="section-head"><h2>사용자별 지출</h2></div>${store.data.users.map((u) => `<div class="breakdown-line" style="padding:12px 0"><span>${esc(u.name)}</span><strong>${won(totals(monthRows(store.data, ui.month, u.id)).expense)}</strong></div>`).join("")}<small>기록에 지정한 사용자 기준</small></section></div></div>`
  );
}
const entityTitles = {
  users: "사용자",
  paymentMethods: "계좌·카드",
  categories: "분류",
  assets: "기존 예산 항목",
};
function settingRow(key, title, description) {
  return `<button class="setting-row" data-setting="${key}">${icon({ users: "user", paymentMethods: "card", categories: "tag", assets: "wallet", snippets: "note", backup: "bank", recoveries: "transfer", import: "note" }[key] || "dots")}<div><strong>${title}</strong><small>${description}</small></div><span class="chevron">›</span></button>`;
}
function renderSettings() {
  return (
    header("필요한 것만, 내 방식으로", "설정") +
    `<div class="settings-grid"><section class="card"><h2>기록 관리</h2>${settingRow("categories", "분류와 아이콘", "이름·색상·아이콘을 자유롭게")}${settingRow("paymentMethods", "계좌·카드", "자주 쓰는 결제수단 관리")}${settingRow("users", "사용자", `${store.data.users.length}명 · 이름과 기본 사용자 설정`)}${settingRow("assets", "기존 예산 항목", "기존 기록의 연결을 보존합니다")}</section><section class="card"><h2>입력 편의</h2>${settingRow("snippets", "자주 쓰는 메모", `${prefs.snippets.length}개 문구 · 입력 중 바로 붙여넣기`)}<label style="margin-top:18px">이 기기의 기본 사용자<select id="default-user">${options("users", prefs.userId)}</select></label><p class="field-help" style="margin-top:12px">마지막 결제수단을 기억합니다. 메모는 줄바꿈과 긴 내용을 그대로 보관합니다.</p></section><section class="card"><h2>데이터 보관</h2>${settingRow("backup", "전체 내보내기", `${store.data.transactions.length}건 · 미전송 기록도 포함`)}${settingRow("recoveries", "이전 기기 사본", "이전 앱의 복구 사본을 개별 내보내기")}${settingRow("import", "파일에서 합치기", "현재 기록을 유지하고 차이를 확인")}</section><section class="card"><h2>연결 상태</h2><p style="margin:16px 0">${esc(store.status)}</p><p class="field-help">이 기기에 먼저 저장하고 연결되면 서버에 반영합니다. 같은 내용을 서로 다르게 수정한 경우 선택할 수 있도록 보관합니다.</p><button class="secondary" id="sync-now" style="margin-top:18px">다시 동기화</button><a class="text-button" href="/login.html">로그인 화면</a><p class="muted" style="margin-top:24px">가계부 · 2.0.0</p></section></div>`
  );
}
function render() {
  if (!store.state) return;
  $("#main").innerHTML =
    page === "reports"
      ? renderReports()
      : page === "settings"
        ? renderSettings()
        : renderLedger();
  document.querySelectorAll("[data-tab]").forEach((x) => {
    const selected = x.dataset.tab === page;
    x.classList.toggle("active", selected);
    if (selected) x.setAttribute("aria-current", "page");
    else x.removeAttribute("aria-current");
  });
  $("#month")?.addEventListener("change", (e) => {
    if (/^\d{4}-\d{2}$/.test(e.target.value)) {
      ui.month = e.target.value;
      ui.day = "";
      render();
    }
  });
  document.querySelectorAll("[data-month-step]").forEach(
    (x) =>
      (x.onclick = () => {
        const [y, m] = ui.month.split("-").map(Number);
        ui.month = localDate(
          new Date(y, m - 1 + Number(x.dataset.monthStep), 1),
        ).slice(0, 7);
        ui.day = "";
        render();
      }),
  );
  $("#user-filter")?.addEventListener("change", (e) => {
    ui.user = e.target.value;
    render();
  });
  $("#type-filter")?.addEventListener("change", (e) => {
    ui.type = e.target.value;
    renderList();
  });
  $("#search")?.addEventListener("input", (e) => {
    ui.query = e.target.value;
    ui.limit = 80;
    renderList();
  });
  document.querySelectorAll("[data-view]").forEach(
    (x) =>
      (x.onclick = () => {
        ui.view = x.dataset.view;
        ui.day = "";
        render();
      }),
  );
  document.querySelectorAll("[data-day]").forEach(
    (x) =>
      (x.onclick = () => {
        ui.day = ui.day === x.dataset.day ? "" : x.dataset.day;
        render();
      }),
  );
  $("#clear-filter")?.addEventListener("click", () => {
    ui.day = "";
    ui.category = "all";
    render();
  });
  document.querySelectorAll("[data-category]").forEach(
    (x) =>
      (x.onclick = () => {
        ui.category = x.dataset.category;
        ui.day = "";
        ui.query = "";
        ui.type = "expense";
        location.hash = "ledger";
      }),
  );
  $("#budget-edit")?.addEventListener("click", budgetEditor);
  $("#sync-now")?.addEventListener("click", () => void store.sync());
  $("#default-user")?.addEventListener(
    "change",
    run((e) => {
      prefs.userId = e.target.value;
      persistPrefs();
      toast("기본 사용자를 바꿨어요.");
    }),
  );
  if (page === "ledger") renderList();
}
function notice() {
  const conflicts = store.state?.conflicts || [];
  $("#sync").textContent = store.status;
  $("#notice").innerHTML = conflicts.length
    ? `<div class="banner"><span>같은 기록에 서로 다른 변경 ${conflicts.length}건이 있어요. 두 내용을 보관하고 있습니다.</span><button id="review-conflicts">확인</button></div>`
    : store.error
      ? `<div class="banner"><span>${esc(store.error)}</span><a href="/login.html">로그인</a></div>`
      : "";
  $("#review-conflicts")?.addEventListener("click", reviewConflicts);
}
store.addEventListener("change", () => {
  notice();
  const signature = JSON.stringify(store.data);
  if (signature !== lastData) {
    lastData = signature;
    const y = scrollY;
    render();
    window.scrollTo(0, y);
  }
});
function utility(title, body, footer = "") {
  const d = $("#utility");
  d.innerHTML = `<div class="dialog-head"><h2 id="utility-title">${title}</h2><button class="icon-button" data-close="utility" aria-label="닫기">×</button></div><div class="dialog-body">${body}</div>${footer ? `<div class="dialog-footer">${footer}</div>` : ""}`;
  if (!d.open) d.showModal();
  d.querySelector(".dialog-body").scrollTop = 0;
}
function detail(id) {
  const t = find("transactions", id);
  if (!t) return;
  utility(
    "거래 상세",
    `<p class="muted">${dateLabel(t.transactionDate)}</p><div class="big-number ${t.type === "income" ? "income" : ""}">${won(t.amount)}</div><h2 style="margin-top:14px">${esc(t.merchant || name("categories", t.categoryId))}</h2><div class="detail-grid"><div><small>사용자</small>${esc(name("users", t.userId))}</div><div><small>결제수단</small>${esc(name("paymentMethods", t.paymentMethodId))}</div><div><small>분류</small>${esc(name("categories", t.categoryId))}</div>${t.assetId ? `<div><small>기존 예산 항목</small>${esc(name("assets", t.assetId))}</div>` : ""}</div><div class="detail-memo">${esc(t.memo || "메모가 없습니다.")}</div><div class="danger-zone"><button class="danger" id="delete-record">거래 삭제</button><button class="text-button" id="duplicate-record">복사해서 입력</button></div>`,
    '<button class="primary" id="edit-record">수정하기</button>',
  );
  $("#edit-record").onclick = () => {
    $("#utility").close();
    openEditor(t, false, true);
  };
  $("#duplicate-record").onclick = () => {
    $("#utility").close();
    openEditor({ ...t, id: null, transactionDate: localDate() }, true);
  };
  $("#delete-record").onclick = () => {
    utility(
      "이 기록을 삭제할까요?",
      `<p>${won(t.amount)} · ${esc(t.merchant || t.memo || "거래")}</p><p class="muted" style="margin-top:12px">삭제 후에도 서버 변경 이력에 보관됩니다.</p>`,
      '<button class="secondary" data-close="utility">취소</button><button class="danger" id="confirm-delete">삭제</button>',
    );
    $("#confirm-delete").onclick = run(async () => {
      await store.edit((d) => {
        const current = d.transactions.find((x) => x.id === id);
        if (!same(current, t))
          throw Error(
            "다른 변경이 있어 삭제를 중단했습니다. 다시 확인해주세요.",
          );
        d.transactions = d.transactions.filter((x) => x.id !== id);
      });
      $("#utility").close();
      toast("삭제했어요.");
      void store.sync();
    });
  };
}
let draftKey = "accountbook-draft";
function draft() {
  try {
    return JSON.parse(localStorage.getItem(draftKey) || "null");
  } catch {
    return null;
  }
}
function formValue() {
  const f = $("#transaction-form");
  if (!f) return null;
  return {
    ...editorRecord,
    amount: f.elements.amount.value,
    merchant: f.elements.merchant.value,
    memo: f.elements.memo.value,
    transactionDate: f.elements.date.value,
    userId: f.elements.user.value,
    paymentMethodId: f.elements.method.value || null,
    categoryId: f.elements.category.value || null,
    assetId: f.elements.asset?.value || null,
    toAssetId: f.elements.toAsset?.value || null,
  };
}
function rememberDraft() {
  const value = formValue();
  if (!value) return;
  try {
    localStorage.setItem(
      draftKey,
      JSON.stringify({ value, original: editorOriginal }),
    );
    $("#draft-state").textContent = "초안 보관됨";
  } catch {
    $("#draft-state").textContent = "초안 저장 실패 · 화면을 닫지 마세요";
  }
}
function openEditor(record = null, copy = false, resume = false) {
  draftKey =
    record?.id && !copy
      ? "accountbook-draft-edit-" + record.id
      : "accountbook-draft";
  const saved = resume ? draft() : null;
  if (saved) {
    record = saved.value;
    editorOriginal = saved.original;
  } else editorOriginal = record?.id ? clone(record) : null;
  editorRecord = {
    id: null,
    type: "expense",
    amount: "",
    merchant: "",
    memo: "",
    transactionDate: ui.day || localDate(),
    userId: prefs.userId || active("users")[0]?.id || "",
    paymentMethodId: prefs.methodId || active("paymentMethods")[0]?.id || null,
    categoryId: null,
    assetId: null,
    ...record,
  };
  if (copy) {
    editorRecord.id = null;
    editorOriginal = null;
  }
  const t = editorRecord,
    isEdit = !!t.id,
    formType = t.type === "transfer";
  const recent = [
    ...new Set(
      [...store.data.transactions]
        .sort((a, b) =>
          (b.createdAt || b.transactionDate).localeCompare(
            a.createdAt || a.transactionDate,
          ),
        )
        .map((x) => x.memo?.trim())
        .filter(Boolean),
    ),
  ].slice(0, 4);
  const merchants = [
    ...new Set(store.data.transactions.map((x) => x.merchant).filter(Boolean)),
  ].slice(-300);
  const el = $("#editor");
  el.innerHTML = `<div class="dialog-head"><div><h2 id="editor-title">${isEdit ? "거래 수정" : "새 기록"}</h2><small id="draft-state">메모도 자동으로 초안에 보관해요</small></div><button class="icon-button" data-close="editor" aria-label="입력 닫기">×</button></div><div class="dialog-body"><form id="transaction-form"><div class="editor-type">${["expense", "income", "transfer"].map((k, i) => `<button type="button" data-entry-type="${k}" class="${t.type === k ? "active" : ""}">${["지출", "수입", "항목 이동"][i]}</button>`).join("")}</div><label class="money-field">금액<input id="amount" name="amount" type="text" inputmode="numeric" autocomplete="off" enterkeyhint="next" placeholder="0" value="${esc(t.amount ? money(Number(String(t.amount).replaceAll(",", ""))) : "")}" required><span>원</span></label><label>사용처 <small>선택</small><input name="merchant" maxlength="200" list="merchants" autocomplete="off" placeholder="어디에 썼나요?" value="${esc(t.merchant)}"></label><datalist id="merchants">${merchants.map((m) => `<option value="${esc(m)}"></option>`).join("")}</datalist><div><div class="memo-header"><label for="memo">메모</label><button type="button" class="text-button" id="save-snippet">자주 쓰는 문구로 저장</button></div><textarea name="memo" id="memo" rows="4" maxlength="10000" placeholder="무엇을 샀는지, 누구와 함께했는지 자유롭게 적어보세요.">${esc(t.memo)}</textarea><div class="memo-tools">${prefs.snippets
    .slice(0, 6)
    .map(
      (s, i) =>
        `<button type="button" data-snippet="${i}" title="${esc(s)}">${esc(s.slice(0, 25))}</button>`,
    )
    .join(
      "",
    )}<button type="button" id="recent-memo">최근 메모 불러오기</button></div><div id="recent-memos" hidden class="memo-tools">${recent.map((s, i) => `<button type="button" data-recent="${i}" title="${esc(s)}">${esc(s.slice(0, 30))}</button>`).join("") || "<small>아직 메모가 없어요.</small>"}</div><small id="memo-count">${(t.memo || "").length.toLocaleString()} / 10,000자</small></div><div class="form-grid"><label>날짜<input type="date" name="date" value="${esc(t.transactionDate)}" required></label><label>사용자<select name="user" required>${options("users", t.userId)}</select></label>${!formType ? `<label>분류<select name="category">${options("categories", t.categoryId, "미분류", (x) => x.type === t.type)}</select></label><label>계좌·카드<select name="method">${options("paymentMethods", t.paymentMethodId, "선택 안 함")}</select></label>` : `<input type="hidden" name="category" value=""><input type="hidden" name="method" value=""><label>출발 항목<select name="asset" required>${options("assets", t.assetId, "선택")}</select></label><label>도착 항목<select name="toAsset" required>${options("assets", t.toAssetId, "선택")}</select></label>`}</div>${!formType ? `<details ${t.assetId ? "open" : ""}><summary class="muted">기존 예산 항목 · 선택</summary><label style="margin-top:12px">연결 항목<select name="asset">${options("assets", t.assetId, "연결하지 않음")}</select></label></details>` : '<p class="field-help">기존 항목 사이의 금액 이동입니다. 지출과 월 예산 한도에는 포함되지 않습니다.</p>'}<div class="form-error" id="editor-error" role="alert"></div><div><button type="button" class="text-button" id="discard-draft">초안 지우고 새로 입력</button></div></form></div><div class="dialog-footer">${!isEdit ? '<button class="secondary" id="save-next">저장 후 계속 입력</button>' : ""}<button class="primary" id="save-record">${isEdit ? "수정 저장" : "저장"}</button></div>`;
  if (!el.open) {
    history.pushState({ editor: true }, "", location.href);
    el.showModal();
  }
  el.querySelector(".dialog-body").scrollTop = 0;
  const f = $("#transaction-form");
  f.addEventListener("input", () => {
    rememberDraft();
    $("#memo-count").textContent =
      `${f.elements.memo.value.length.toLocaleString()} / 10,000자`;
  });
  f.addEventListener("change", rememberDraft);
  f.elements.amount.addEventListener("blur", () => {
    const raw = f.elements.amount.value.replaceAll(",", "");
    if (/^\d+$/.test(raw)) f.elements.amount.value = money(Number(raw));
    rememberDraft();
  });
  f.elements.merchant.addEventListener("change", () => {
    const match = [...store.data.transactions]
      .reverse()
      .find(
        (x) =>
          x.merchant === f.elements.merchant.value &&
          x.type === t.type &&
          x.categoryId,
      );
    if (match && !f.elements.category.value) {
      f.elements.category.value = match.categoryId;
      rememberDraft();
    }
  });
  const append = (s) => {
    const m = f.elements.memo,
      start = m.selectionStart,
      end = m.selectionEnd;
    m.setRangeText(s, start, end, "end");
    m.dispatchEvent(new Event("input", { bubbles: true }));
    m.focus({ preventScroll: true });
  };
  document
    .querySelectorAll("[data-snippet]")
    .forEach(
      (b) =>
        (b.onclick = () => append(prefs.snippets[Number(b.dataset.snippet)])),
    );
  document
    .querySelectorAll("[data-recent]")
    .forEach(
      (b) => (b.onclick = () => append(recent[Number(b.dataset.recent)])),
    );
  $("#recent-memo").onclick = () => {
    $("#recent-memos").hidden = !$("#recent-memos").hidden;
  };
  $("#save-snippet").onclick = run(() => {
    const m = f.elements.memo,
      s = m.value.slice(m.selectionStart, m.selectionEnd) || m.value.trim();
    if (!s) throw Error("먼저 메모를 입력하거나 저장할 부분을 선택해주세요.");
    if (!prefs.snippets.includes(s)) prefs.snippets.push(s);
    persistPrefs();
    toast("자주 쓰는 문구에 추가했어요. 다음 입력부터 표시돼요.");
  });
  document.querySelectorAll("[data-entry-type]").forEach(
    (b) =>
      (b.onclick = () => {
        const v = formValue();
        v.type = b.dataset.entryType;
        v.categoryId = null;
        const original = editorOriginal;
        openEditor(v);
        editorOriginal = original;
        rememberDraft();
      }),
  );
  $("#discard-draft").onclick = () => {
    utility(
      "초안을 지울까요?",
      "<p>저장하지 않은 현재 입력 내용이 지워집니다.</p>",
      '<button class="secondary" data-close="utility">취소</button><button class="danger" id="confirm-discard">초안 지우기</button>',
    );
    $("#confirm-discard").onclick = () => {
      localStorage.removeItem(draftKey);
      $("#utility").close();
      openEditor();
    };
  };
  $("#save-record").onclick = () => void saveEntry(false);
  $("#save-next")?.addEventListener("click", () => void saveEntry(true));
  f.onsubmit = (e) => {
    e.preventDefault();
    void saveEntry(false);
  };
  requestAnimationFrame(() => {
    el.querySelector(".dialog-body").scrollTop = 0;
    $("#amount").focus({ preventScroll: true });
  });
}
async function saveEntry(next) {
  if (saving) return;
  const f = $("#transaction-form");
  if (!f.reportValidity()) return;
  const v = formValue(),
    raw = String(v.amount).replaceAll(",", "").trim();
  if (
    !/^\d+$/.test(raw) ||
    !Number.isSafeInteger(Number(raw)) ||
    Number(raw) <= 0
  ) {
    $("#editor-error").textContent = "금액은 0보다 큰 정수로 입력해주세요.";
    return;
  }
  v.amount = Number(raw);
  if (
    v.type === "transfer" &&
    (!v.assetId || !v.toAssetId || v.assetId === v.toAssetId)
  ) {
    $("#editor-error").textContent = "서로 다른 출발·도착 항목을 선택해주세요.";
    return;
  }
  saving = true;
  document
    .querySelectorAll("#editor .dialog-footer button")
    .forEach((b) => (b.disabled = true));
  try {
    const original = editorOriginal;
    v.id ||= crypto.randomUUID();
    v.createdAt ||= new Date().toISOString();
    await store.edit((d) => {
      const at = d.transactions.findIndex((t) => t.id === v.id);
      if (original) {
        if (at < 0)
          throw Error(
            "다른 기기에서 삭제한 거래입니다. 초안을 보관했으니 복사해서 새 기록으로 남겨주세요.",
          );
        const result = merge(
          normalize({ transactions: [original] }),
          normalize({ transactions: [v] }),
          normalize({ transactions: [d.transactions[at]] }),
        );
        if (result.conflicts.length)
          throw Error(
            "입력 중 다른 기기가 같은 내용을 수정했습니다. 초안이 보관돼 있으니 최신 내용을 확인해주세요.",
          );
        d.transactions[at] = result.data.transactions[0];
      } else {
        if (at >= 0) throw Error("이미 저장한 거래입니다.");
        d.transactions.push(v);
      }
    });
    prefs.userId = v.userId;
    prefs.methodId = v.paymentMethodId;
    try {
      persistPrefs();
      localStorage.removeItem(draftKey);
    } catch {
      toast("거래는 저장됐지만 입력 환경 저장에 실패했습니다.");
    }
    toast("기기에 저장했어요.");
    if (next) {
      openEditor({
        transactionDate: v.transactionDate,
        userId: v.userId,
        paymentMethodId: v.paymentMethodId,
        categoryId: v.categoryId,
        type: v.type,
      });
    } else closeEditor();
    void store.sync();
  } catch (error) {
    $("#editor-error").textContent = error.message;
    rememberDraft();
  } finally {
    saving = false;
    document
      .querySelectorAll("#editor .dialog-footer button")
      .forEach((b) => (b.disabled = false));
  }
}
function closeEditor() {
  if ($("#editor").open) {
    $("#editor").close();
    if (history.state?.editor) history.back();
  }
}
function entityList(key) {
  utility(
    entityTitles[key],
    `<p class="field-help">이름을 바꿔도 기존 기록은 유지됩니다. 보관한 항목은 새 입력에서 숨겨집니다.</p>${store.data[key].map((x) => `<button class="setting-row" data-entity="${esc(x.id)}">${icon(x.iconKey || (key === "categories" ? suggested(x.name) : key === "users" ? "user" : "card"), x.color)}<div><strong>${esc(x.name)}${x.archived ? '<span class="label-chip">보관됨</span>' : ""}</strong><small>이름 · 아이콘 · 색상 수정</small></div><span class="chevron">›</span></button>`).join("")}`,
    '<button class="primary" id="new-entity">새 항목 추가</button>',
  );
  document
    .querySelectorAll("[data-entity]")
    .forEach(
      (b) => (b.onclick = () => entityEditor(key, find(key, b.dataset.entity))),
    );
  $("#new-entity").onclick = () => entityEditor(key);
}
function entityEditor(key, item) {
  const original = item ? clone(item) : null;
  let chosen =
    item?.iconKey ||
    (key === "categories"
      ? suggested(item?.name)
      : key === "users"
        ? "user"
        : "card");
  utility(
    item ? "항목 수정" : "항목 추가",
    `<form id="entity-form"><label>이름<input name="name" value="${esc(item?.name || "")}" maxlength="80" required></label>${key === "categories" ? `<label>종류<select name="type"><option value="expense">지출</option><option value="income" ${item?.type === "income" ? "selected" : ""}>수입</option></select></label>` : ""}<div><label>아이콘</label><div class="icon-picker">${Object.keys(
      paths,
    )
      .map(
        (k) =>
          `<button type="button" data-icon="${k}" aria-label="${iconNames[k]}" class="${k === chosen ? "active" : ""}">${icon(k)}</button>`,
      )
      .join(
        "",
      )}</div></div><label class="palette">색상<input type="color" name="color" value="${/^#[0-9a-f]{6}$/i.test(item?.color || "") ? item.color : "#287d73"}"></label><p class="field-help">이름을 변경해도 선택한 아이콘은 바뀌지 않습니다.</p><div id="entity-error" class="form-error"></div>${item ? `<button type="button" class="secondary" id="archive-entity">${item.archived ? "보관 해제" : "보관하기"}</button>` : ""}</form>`,
    '<button class="primary" id="save-entity">저장</button>',
  );
  document.querySelectorAll("[data-icon]").forEach(
    (b) =>
      (b.onclick = () => {
        chosen = b.dataset.icon;
        document
          .querySelectorAll("[data-icon]")
          .forEach((x) => x.classList.toggle("active", x === b));
      }),
  );
  const save = async (archived) => {
    const f = $("#entity-form");
    if (!f.reportValidity()) return;
    try {
      const title = f.elements.name.value.trim();
      if (!title) throw Error("이름을 입력해주세요.");
      await store.edit((d) => {
        if (
          original &&
          !same(
            d[key].find((x) => x.id === original.id),
            original,
          )
        )
          throw Error("다른 변경이 있습니다. 항목을 다시 열어주세요.");
        const next = {
          ...item,
          id: item?.id || crypto.randomUUID(),
          name: title,
          iconKey: chosen,
          color: f.elements.color.value,
          archived: archived ?? item?.archived ?? false,
        };
        if (key === "categories") next.type = f.elements.type.value;
        const at = d[key].findIndex((x) => x.id === next.id);
        if (at >= 0) d[key][at] = next;
        else d[key].push(next);
      });
      entityList(key);
      void store.sync();
    } catch (error) {
      $("#entity-error").textContent = error.message;
    }
  };
  $("#save-entity").onclick = () => void save();
  $("#entity-form").onsubmit = (e) => {
    e.preventDefault();
    void save();
  };
  $("#archive-entity")?.addEventListener(
    "click",
    () => void save(!item.archived),
  );
}
function budgetEditor() {
  const existing = clone(budgetForMonth() || { total: 0, categories: {} });
  utility(
    `${ui.month.replace("-", "년 ")}월 예산`,
    `<form id="budget-form"><p class="field-help">선택한 월에만 적용됩니다. 0원은 한도 없음입니다.</p><label>월 전체 한도<input name="total" type="number" inputmode="numeric" min="0" step="1" value="${existing.total}" required></label><details><summary>분류별 한도 · 선택</summary><div class="stack" style="margin-top:18px">${active(
      "categories",
    )
      .filter((c) => c.type === "expense")
      .map(
        (c) =>
          `<label>${esc(c.name)}<input data-budget="${esc(c.id)}" type="number" inputmode="numeric" min="0" step="1" value="${existing.categories[c.id] || 0}"></label>`,
      )
      .join(
        "",
      )}</div></details><p class="field-help">분류별 한도는 월 전체 한도와 별개입니다. 합산해 중복 계산하지 않습니다.</p><div id="budget-error" class="form-error"></div></form>`,
    '<button class="primary" id="budget-save">예산 저장</button>',
  );
  const save = async () => {
    const f = $("#budget-form");
    if (!f.reportValidity()) return;
    try {
      const month = ui.month;
      const b = {
        total: Number(f.elements.total.value),
        categories: { ...existing.categories },
      };
      document
        .querySelectorAll("[data-budget]")
        .forEach((x) => (b.categories[x.dataset.budget] = Number(x.value)));
      await store.edit((d) => {
        if (
          !same(
            d.monthlyBudgets[month] || { total: 0, categories: {} },
            existing,
          )
        )
          throw Error("다른 기기에서 예산을 변경했습니다. 다시 열어주세요.");
        d.monthlyBudgets[month] = b;
      });
      $("#utility").close();
      toast("이 달의 예산을 저장했어요.");
      void store.sync();
    } catch (error) {
      $("#budget-error").textContent = error.message;
    }
  };
  $("#budget-save").onclick = () => void save();
  $("#budget-form").onsubmit = (e) => {
    e.preventDefault();
    void save();
  };
}
function snippetsEditor() {
  utility(
    "자주 쓰는 메모",
    `<p class="field-help">자주 적는 내용을 저장해 입력 중 한 번에 붙여넣으세요.</p>${prefs.snippets.map((s, i) => `<div class="setting-row"><div class="transaction-copy"><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(s)}</p></div><button class="text-button" data-remove-snippet="${i}">삭제</button></div>`).join("")}<label style="margin-top:18px">새 문구<textarea id="new-snippet" maxlength="10000" placeholder="자주 쓰는 메모를 적어주세요"></textarea></label>`,
    '<button class="primary" id="add-snippet">문구 추가</button>',
  );
  document.querySelectorAll("[data-remove-snippet]").forEach(
    (b) =>
      (b.onclick = run(() => {
        prefs.snippets.splice(Number(b.dataset.removeSnippet), 1);
        persistPrefs();
        snippetsEditor();
        render();
      })),
  );
  $("#add-snippet").onclick = run(() => {
    const s = $("#new-snippet").value.trim();
    if (!s) throw Error("문구를 입력해주세요.");
    if (!prefs.snippets.includes(s)) prefs.snippets.push(s);
    persistPrefs();
    snippetsEditor();
    render();
  });
}
async function recoveries() {
  const keys = Object.keys(localStorage).filter((k) =>
    /^household_(recovery|backup|data_corrupt)/.test(k),
  );
  const copies = [
    ...keys.map((key) => ({ key, source: "legacy" })),
    ...(await store.savedCopies()).map((key) => ({ key, source: "current" })),
  ];
  utility(
    "기기 보관 사본",
    `<p class="field-help">이전 앱의 기록과 가져오기·충돌 확인 전 사본입니다. 원본을 바꾸지 않고 내려받습니다.</p>${copies.length ? copies.map((c, i) => `<button class="setting-row" data-recovery="${i}"><div><strong>보관 사본 ${i + 1}</strong><small>${esc(c.key)}</small></div><span>↓</span></button>`).join("") : '<div class="empty">이 기기에 별도 보관 사본이 없습니다.</div>'}`,
  );
  document.querySelectorAll("[data-recovery]").forEach(
    (b) =>
      (b.onclick = run(async () => {
        const c = copies[Number(b.dataset.recovery)];
        let value;
        if (c.source === "current") value = await store.read(c.key);
        else {
          const raw = localStorage.getItem(c.key);
          try {
            value = JSON.parse(raw);
          } catch {
            value = { raw };
          }
        }
        download(`household-recovery-${Date.now()}.json`, {
          source: c.key,
          exportedAt: new Date().toISOString(),
          data: value?.working || value?.local || value?.data || value,
          original: value,
        });
      })),
  );
}
function reviewConflicts() {
  const c = store.state.conflicts[0];
  if (!c) {
    $("#utility").close();
    void store.sync();
    return;
  }
  const labels = {
    transactions: "거래",
    users: "사용자",
    assets: "기존 예산 항목",
    paymentMethods: "결제수단",
    categories: "분류",
    monthlyBudgets: "월 예산",
    amount: "금액",
    memo: "메모",
    merchant: "사용처",
    name: "이름",
    transactionDate: "날짜",
  };
  const describe = (v) =>
    v === undefined
      ? "삭제됨"
      : typeof v === "object"
        ? JSON.stringify(v, null, 2)
        : String(v);
  utility(
    "어떤 내용을 사용할까요?",
    `<p class="muted">${esc(c.path.map((x) => labels[x] || x).join(" · "))}</p><p style="margin:12px 0">두 사본은 별도로 보관했습니다. 선택 후 나머지 충돌을 확인합니다.</p><div class="conflict-options"><div class="conflict"><h3>이 기기 / 가져온 파일</h3><pre>${esc(describe(c.local))}</pre></div><div class="conflict"><h3>서버 / 현재 기록</h3><pre>${esc(describe(c.remote))}</pre></div></div>`,
    '<button class="secondary" id="choose-local">기기 내용 사용</button><button class="primary" id="choose-remote">서버 내용 사용</button>',
  );
  $("#choose-local").onclick = run(async () => {
    await store.resolveOne(0, "local", c);
    reviewConflicts();
  });
  $("#choose-remote").onclick = run(async () => {
    await store.resolveOne(0, "remote", c);
    reviewConflicts();
  });
}
document.addEventListener(
  "click",
  run(async (e) => {
    const close = e.target.closest("[data-close]");
    if (close) {
      if (close.dataset.close === "editor") closeEditor();
      else $("#utility").close();
      return;
    }
    const row = e.target.closest("[data-transaction]");
    if (row) {
      detail(row.dataset.transaction);
      return;
    }
    const setting = e.target.closest("[data-setting]");
    if (setting) {
      const k = setting.dataset.setting;
      if (entityTitles[k]) entityList(k);
      else if (k === "snippets") snippetsEditor();
      else if (k === "backup")
        download(`household-data-${localDate()}.json`, await store.backup());
      else if (k === "recoveries") await recoveries();
      else if (k === "import") $("#import-file").click();
    }
  }),
);
$("#import-file").addEventListener(
  "change",
  run(async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 2_000_000) throw Error("파일은 2MB 이내로 선택해주세요.");
    const parsed = JSON.parse(await file.text()),
      data = parsed.data || parsed;
    if (!Array.isArray(data.transactions))
      throw Error("거래 목록이 없는 파일입니다.");
    utility(
      "현재 기록과 합치기",
      `<p>파일의 ${data.transactions.length}건을 현재 기록과 비교합니다.</p><p class="muted" style="margin-top:12px">현재 기록을 삭제하지 않습니다. 동일 ID의 다른 내용은 확인 후 선택합니다.</p>`,
      '<button class="secondary" data-close="utility">취소</button><button class="primary" id="confirm-import">합치기</button>',
    );
    $("#confirm-import").onclick = run(async () => {
      await store.importData(data);
      $("#utility").close();
      toast("파일을 합쳤어요.");
      void store.sync();
    });
  }),
);
$("#add").onclick = () => {
  draftKey = "accountbook-draft";
  openEditor(null, false, !!draft());
};
$("#sync").onclick = () => {
  if (store.state?.conflicts.length) reviewConflicts();
  else void store.sync();
};
$("#editor").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeEditor();
});
window.addEventListener("popstate", () => {
  if ($("#editor").open) $("#editor").close();
});
window.addEventListener("hashchange", () => {
  ui.scroll[page] = scrollY;
  page = ["ledger", "reports", "settings"].includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : "ledger";
  render();
  window.scrollTo(0, ui.scroll[page] || 0);
});
window.addEventListener("online", () => void store.sync());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void store.sync();
});
// One viewport adjustment, no scroll coercion or drag handlers competing with the keyboard.
if (window.visualViewport) {
  const resize = () => {
    if (innerWidth <= 700) {
      $("#editor").style.height = visualViewport.height + "px";
      $("#editor").style.top = visualViewport.offsetTop + "px";
    } else {
      $("#editor").style.height = "";
      $("#editor").style.top = "";
    }
  };
  visualViewport.addEventListener("resize", resize);
  resize();
}
try {
  await store.init();
  if (!navigator.locks)
    throw Error("안전한 동시 저장을 위해 최신 브라우저로 업데이트해주세요.");
  page = ["ledger", "reports", "settings"].includes(location.hash.slice(1))
    ? location.hash.slice(1)
    : "ledger";
  render();
  void store.sync();
  setInterval(() => {
    if (document.visibilityState === "visible") void store.sync();
  }, 30000);
} catch (error) {
  $("#main").innerHTML =
    `<div class="card"><h2>기기 저장소를 확인해주세요</h2><p style="margin-top:14px">${esc(error.message)}</p><p class="muted">사이트 데이터를 지우지 마세요. 기존 사본을 보존한 상태에서 확인이 필요합니다.</p></div>`;
  $("#add").disabled = true;
}
if ("serviceWorker" in navigator)
  navigator.serviceWorker
    .register("/service-worker.js")
    .catch(() => toast("오프라인 화면 준비를 완료하지 못했습니다."));
