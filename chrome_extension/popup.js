// Всплывающее окно расширения.
// Берёт ссылку текущей вкладки (и, если получится, адрес и цену со страницы)
// и оценивает дом встроенным движком engine.js — без сервера и без интернета.

const $ = (s) => document.querySelector(s);

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money = (v) => (v == null ? "—" : usd.format(v));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v, d = 0) => (v == null ? "—" : Number(v).toLocaleString("ru-RU", { maximumFractionDigits: d }));

const VERDICTS = {
  BUY: ["Выгодно", "Цена ниже максимальной, при которой остаётся целевая прибыль."],
  BORDERLINE: ["На грани", "Прибыль есть, но меньше целевой. Имеет смысл торговаться."],
  SKIP: ["Невыгодно", "По осторожной оценке сделка уходит в минус."],
};

let defaults = null;   // параметры сделки из данных
let settings = null;   // параметры с учётом сохранённых пользователем
let pageHomeType = null; // тип дома со страницы объявления, если удалось прочитать

// ---------------------------------------------------------------------------
// Чтение страницы объявления. Эта функция выполняется ВНУТРИ вкладки,
// поэтому она самодостаточна и ничего не берёт снаружи.
// Читает только то, что пользователь и так видит на открытой странице.
// ---------------------------------------------------------------------------
function readListingPage() {
  const out = { price: null, address: null, parcelId: null, homeType: null };
  const toNumber = (v) => {
    const n = Number(String(v).replace(/[^\d.]/g, ""));
    return Number.isFinite(n) && n > 10000 ? n : null;
  };

  // 1. Структурированные данные schema.org (есть у многих сайтов недвижимости)
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    let data;
    try { data = JSON.parse(script.textContent); } catch (e) { continue; }
    const items = Array.isArray(data) ? data : data["@graph"] || [data];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const entity = item.mainEntity || item;
      let offers = entity.offers || item.offers;
      if (Array.isArray(offers)) offers = offers[0];
      if (!out.price && offers && offers.price) out.price = toNumber(offers.price);
      const type = [].concat(entity["@type"] || item["@type"] || [])[0];
      if (!out.homeType && type && type !== "Product" && type !== "Offer") out.homeType = String(type);
      const a = entity.address || item.address;
      if (!out.address && a && a.streetAddress) {
        out.address = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode]
          .filter(Boolean).join(", ");
      }
    }
  }

  // 2. Известные элементы страниц Zillow и Redfin (могут меняться со временем)
  if (!out.price) {
    const selectors = [
      '[data-testid="price"]',
      '[data-testid="home-details-summary-price"]',
      '[data-rf-test-id="abp-price"] .statsValue',
      ".price-section .price",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) { out.price = toNumber(el.textContent); if (out.price) break; }
    }
  }
  if (!out.address) {
    const el = document.querySelector('h1[class*="address" i], h1[data-testid*="address" i], .street-address');
    if (el) out.address = el.textContent.replace(/\s+/g, " ").trim();
  }
  // 3. Номер участка и тип дома из текста страницы
  //    (Zillow: «Parcel number: …», «Home type: …»; Redfin: «APN: …», «Property Type: …»).
  const text = document.body ? document.body.innerText : "";
  const pm = text.match(/(?:parcel\s*(?:number|#|id)|apn|tax\s*id)\s*[:#]?\s*(\d{6})\s*-?\s*(\d{4})(?!\d)/i);
  if (pm) out.parcelId = pm[1] + pm[2];
  const tm = text.match(/(?:home\s*type|property\s*type)\s*[:\n]\s*([A-Za-z][A-Za-z /-]{2,40})/i);
  if (tm) out.homeType = tm[1].split("\n")[0].trim();
  return out;
}

// ---------------------------------------------------------------------------

function fillSettingsForm(st) {
  $("#s-fixed").value = Math.round(st.closing_and_holding_cost);
  $("#s-selling").value = +(st.selling_cost_rate * 100).toFixed(2);
  $("#s-profit").value = +(st.target_profit_rate * 100).toFixed(2);
}

async function loadSettings() {
  const info = await HouseEngine.info();
  defaults = info.settings;
  let saved = {};
  try { saved = (await chrome.storage.local.get("settings")).settings || {}; } catch (e) {}
  settings = Object.assign({}, defaults, saved);
  fillSettingsForm(settings);
  $("#data-date").textContent = `Данные о продажах по ${info.latest_sale_date}.`;
}

$("#save-settings").addEventListener("click", async () => {
  const fixed = HouseEngine.parseMoney($("#s-fixed").value);
  const selling = parseFloat($("#s-selling").value.replace(",", "."));
  const profit = parseFloat($("#s-profit").value.replace(",", "."));
  if (fixed == null || !(selling >= 0) || !(profit >= 0)) {
    $("#save-settings").textContent = "Проверьте числа";
    setTimeout(() => ($("#save-settings").textContent = "Сохранить"), 1500);
    return;
  }
  settings = { closing_and_holding_cost: fixed, selling_cost_rate: selling / 100, target_profit_rate: profit / 100 };
  try { await chrome.storage.local.set({ settings }); } catch (e) {}
  $("#save-settings").textContent = "Сохранено";
  setTimeout(() => ($("#save-settings").textContent = "Сохранить"), 1200);
});

$("#reset-settings").addEventListener("click", async () => {
  settings = Object.assign({}, defaults);
  fillSettingsForm(settings);
  try { await chrome.storage.local.remove("settings"); } catch (e) {}
});

async function prefillFromTab() {
  let tab;
  try { [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); } catch (e) { return; }
  if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
    $("#source").textContent = "Откройте объявление Zillow, Redfin или страницу King County.";
    return;
  }

  const host = new URL(tab.url).hostname;
  const isListing = /zillow\.|redfin\./.test(host);
  const isKingCounty = /kingcounty\.(gov|com)$/.test(host);

  $("#query").value = tab.url;
  $("#source").textContent = isListing || isKingCounty ? `Со страницы ${host}` : "Эта страница не похожа на объявление";

  if (!isListing) return;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readListingPage });
    const page = res && res.result;
    pageHomeType = page && page.homeType;
    if (page && page.parcelId) {
      // Номер участка однозначно определяет дом — поиск по адресу не нужен.
      $("#query").value = page.parcelId + (page.address ? `  (${page.address})` : "");
      $("#source").textContent = `Номер участка и цена взяты со страницы ${host}. Проверьте их.`;
    } else if (page && page.address) {
      // Адрес со страницы надёжнее ссылки: у коротких ссылок Zillow адреса нет.
      $("#query").value = page.address;
      $("#source").textContent = `Адрес и цена взяты со страницы ${host}. Проверьте их.`;
    }
    if (page && page.price && !$("#price").value) {
      $("#price").value = String(Math.round(page.price));
    }
  } catch (e) {
    // Нет доступа к странице — остаётся ссылка, цену введут вручную.
  }
}

// ---------------------------------------------------------------------------

$("#form").addEventListener("submit", (e) => { e.preventDefault(); evaluate(); });

async function evaluate() {
  const btn = $("#go");
  btn.disabled = true;
  btn.textContent = "Считаю…";
  try {
    const query = $("#query").value.trim();
    if (!query) return renderNotice("Вставьте ссылку на дом, номер участка или адрес.");
    const price = HouseEngine.parseMoney($("#price").value);
    if (!(price > 0)) return renderNotice("Укажите цену продавца, например 650000 или 650k.");
    let repair = null;
    if ($("#repair").value.trim()) {
      repair = HouseEngine.parseMoney($("#repair").value);
      if (repair == null || repair < 0) return renderNotice("Не понял сумму ремонта. Пример: 40000 или 40k. Можно оставить пустым.");
    }

    const found = await HouseEngine.find(query);
    if (found.error) {
      const t = (pageHomeType || "").toLowerCase();
      if (found.error.includes("не входит в King County")) return renderNotice(esc(found.error));
      if (/condo|townho|apartment|multi|co-op|manufactured|mobile|land|lot/.test(t)) {
        return renderNotice(
          `На странице указан тип «${esc(pageHomeType)}». Модель оценивает только частные дома ` +
          `на одну семью, поэтому этот объект в базе не найден и оценить его нельзя.`
        );
      }
      return renderNotice(esc(found.error));
    }
    if (found.candidates) return renderChoices(found.candidates, found.message);
    renderResult(await HouseEngine.evaluate(found.house, price, repair, settings));
  } catch (e) {
    console.error(e);
    renderNotice("Не удалось посчитать: " + esc(e.message || e));
  } finally {
    btn.disabled = false;
    btn.textContent = "Оценить дом";
  }
}

function renderNotice(html) {
  $("#out").innerHTML = `<div class="notice">${html}</div>`;
}

function renderChoices(list, message) {
  $("#out").innerHTML = `
    <div class="notice choose">${esc(message)}
      <div class="choices">
        ${list.map((c) => `<button type="button" data-pid="${esc(c.ParcelId)}">${esc(c.Address)}
          <small>${esc(c.ZipCode || "")}, участок ${esc(c.ParcelId)}</small></button>`).join("")}
      </div>
    </div>`;
  document.querySelectorAll(".choices button").forEach((b) =>
    b.addEventListener("click", () => { $("#query").value = b.dataset.pid; evaluate(); })
  );
}

function rulerHTML(r) {
  const ask = r.asking_price, maxp = r.max_profitable_price, be = r.break_even_price;
  const lo = Math.max(0, Math.min(ask, maxp) * 0.85);
  let hi = Math.max(ask, be) * 1.12;
  if (hi - lo < 1) hi = lo + 1;
  const pos = (v) => Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));
  const pMax = pos(maxp), pBe = pos(be), pAsk = pos(ask);
  const edge = (p) => (p < 15 ? "edge-l" : p > 85 ? "edge-r" : "");
  const tick = (p, label, v, extra = "") => `<div class="tick ${edge(p)} ${extra}" style="left:${p}%"><b>${money(v)}</b>${label}</div>`;
  // Если отметки рядом, вторую подпись опускаем ниже, чтобы они не слипались.
  const close = pMax > 0 && pBe - pMax < 30;
  return `
    <div class="ruler">
      <h3>Сколько можно заплатить</h3>
      <div class="pin-row"><div class="pin ${edge(pAsk)}" style="left:${pAsk}%"><b>${money(ask)}</b>цена продавца</div></div>
      <div class="track"><div class="z-buy" style="width:${pMax}%"></div><div class="z-edge" style="width:${pBe - pMax}%"></div><div class="z-skip"></div></div>
      <div class="scale ${close ? "two-rows" : ""}">${pMax > 0 ? tick(pMax, "макс. выгодная", maxp) : ""}${tick(pBe, "безубыток", be, close ? "low" : "")}</div>
    </div>`;
}

function renderResult(r) {
  const h = r.house;
  const [title, text] = VERDICTS[r.verdict];
  const c = r.comps || {};
  const place = [h.DistrictName, h.ZipCode].filter(Boolean).join(", ");
  const year = h.YrBuilt ? Math.round(h.YrBuilt) : "—";

  $("#out").innerHTML = `
    <div class="verdict" data-v="${r.verdict}">
      <h2>${title}</h2>
      <p>${text}</p>
      <div class="address">${esc(h.Address || "Адрес неизвестен")} <span>${esc(place)}</span></div>
    </div>
    ${rulerHTML(r)}
    <div class="block">
      <dl class="numbers">
        <div><dt>Ожидаемая прибыль</dt><dd class="${r.estimated_profit < 0 ? "neg" : ""}">${money(r.estimated_profit)}
          <small>ROI ${(r.estimated_roi * 100).toFixed(1)}%</small></dd></div>
        <div><dt>Осторожная перепродажа</dt><dd>${money(r.conservative_value)}
          <small>в среднем ${money(r.predicted_value)}</small></dd></div>
        <div><dt>Похожие продажи</dt><dd>${c.count >= 3 ? money(c.estimate) : "мало данных"}
          <small>${c.count >= 3 ? `${c.count} сделок за год` : "не с чем сравнить"}</small></dd></div>
        <div><dt>Ремонт</dt><dd>${money(r.repair_cost)}
          <small>${r.repair_is_estimate ? "грубая оценка" : "ваша сумма"}</small></dd></div>
      </dl>
    </div>
    ${r.warnings.length ? `<div class="block"><ul class="warnings">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
    <div class="block facts">
      <b>${num(h.SqFtTotLiving)}</b> кв. фт, спален <b>${num(h.Bedrooms)}</b>, ванных <b>${num(h.Bathrooms, 2)}</b>,
      построен в <b>${year}</b>, участок <b>${esc(h.ParcelId)}</b>
    </div>`;
}

// ---------------------------------------------------------------------------

function showNoData() {
  $("#form").hidden = true;
  $("#settings").hidden = true;
  renderNotice(
    "В расширении ещё нет модели и данных. На компьютере выполните " +
    "<code>python run_project.py</code> (или <code>python export_extension.py</code>, " +
    "если модель уже обучена), затем обновите расширение на странице " +
    "<code>chrome://extensions</code>."
  );
}

(async function init() {
  try {
    await loadSettings();
  } catch (e) {
    showNoData();
    return;
  }
  await prefillFromTab();
  if ($("#price").value) $("#go").focus();
  else $("#price").focus();
})();
