// Движок оценки внутри расширения: перенос valuation.py на JavaScript.
// Данные и модель лежат в папке data/ (их создаёт export_extension.py).

(function (root) {
  "use strict";

  // ---------------------------------------------------------------- загрузка
  let loader = async (path) => {
    const res = await fetch(chrome.runtime.getURL(path));
    if (!res.ok) throw new Error(`not found: ${path}`);
    return res.json();
  };
  const cache = new Map();
  function load(path) {
    if (!cache.has(path)) cache.set(path, loader(path).catch((e) => { cache.delete(path); throw e; }));
    return cache.get(path);
  }

  // ---------------------------------------------------------------- разбор ввода
  const URL_RE = /https?:\/\/\S+/i;

  function extractParcelId(text) {
    const patterns = [
      /(?:parcelnbr|pin|parcel)\s*[=:]?\s*(\d{6})-?(\d{4})(?!\d)/i,
      /(?<!\d)(\d{6})-(\d{4})(?!\d)/,
      /(?<!\d)(\d{10})(?!\d)/,
    ];
    for (const re of patterns) {
      const m = text.match(re);
      if (m) return m.slice(1).join("");
    }
    return null;
  }

  function extractAddressFromListingUrl(text) {
    const m = text.match(URL_RE);
    if (!m) return [null, null];
    let url;
    try { url = new URL(m[0]); } catch (e) { return [null, null]; }
    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split("/").filter(Boolean).map((s) => {
      try { return decodeURIComponent(s); } catch (e) { return s; }
    });
    if (host.includes("zillow.")) {
      const i = segments.indexOf("homedetails");
      if (i >= 0 && i + 1 < segments.length && !segments[i + 1].endsWith("_zpid")) {
        return ["Zillow", segments[i + 1].replace(/-/g, " ")];
      }
      return ["Zillow", null];
    }
    if (host.includes("redfin.")) {
      for (const seg of segments) if (/^\d+-.+-\d{5}$/.test(seg)) return ["Redfin", seg.replace(/-/g, " ")];
      return ["Redfin", null];
    }
    return [null, null];
  }

  function joinThousands(text) {
    return text.replace(/(?<![\d.,])\d{1,3}(?:[ \u00a0]\d{3})+(?!\d)/g, (m) => m.replace(/[ \u00a0]/g, ""));
  }

  function parseMoney(token) {
    token = String(token).trim().replace(/_/g, "");
    token = joinThousands(token).replace(/\s/g, "");
    if (/^\$?\d{1,3}(,\d{3})+$/.test(token)) token = token.replace(/,/g, "");
    const m = token.match(/^\$?(\d+(?:[.,]\d+)?)(k|к|тыс|m|м|млн)?\.?$/i);
    if (!m) return null;
    let value = parseFloat(m[1].replace(",", "."));
    const suffix = (m[2] || "").toLowerCase();
    if (["k", "к", "тыс"].includes(suffix)) value *= 1e3;
    else if (["m", "м", "млн"].includes(suffix)) value *= 1e6;
    return value;
  }

  // ---------------------------------------------------------------- адреса
  const STREET_WORDS = {
    STREET: "ST", AVENUE: "AVE", AV: "AVE", ROAD: "RD", DRIVE: "DR", PLACE: "PL",
    COURT: "CT", LANE: "LN", BOULEVARD: "BLVD", TERRACE: "TER", CIRCLE: "CIR",
    PARKWAY: "PKWY", HIGHWAY: "HWY", NORTHEAST: "NE", NORTHWEST: "NW",
    SOUTHEAST: "SE", SOUTHWEST: "SW", NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W",
  };
  const NOISE = new Set(["WA", "USA", "UNIT", "APT"]); // не WASHINGTON: бывает S Washington St
  const DIRECTIONS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);
  const SUFFIXES = new Set(["ST", "AVE", "RD", "DR", "PL", "CT", "LN", "BLVD", "TER", "CIR",
    "PKWY", "HWY", "WAY", "LOOP", "SQ", "TRL", "ALY"]);
  const ZIP_TOKEN = /^98\d{3}$/;

  function addressTokens(text) {
    return String(text || "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/)
      .filter(Boolean).map((t) => STREET_WORDS[t] || t).filter((t) => !NOISE.has(t));
  }
  function streetNameTokens(tokens) {
    return new Set([...tokens].filter((t) => !DIRECTIONS.has(t) && !SUFFIXES.has(t) && !ZIP_TOKEN.test(t)));
  }
  const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

  // ---------------------------------------------------------------- данные
  async function loadZip(zip) {
    const data = await load(`data/zips/${zip}.json`);
    if (!data._houses) {
      data._houses = data.rows.map((row) => {
        const h = {};
        data.columns.forEach((c, i) => (h[c] = row[i]));
        h._addr = addressTokens(h.Address);
        h._number = /^\d+$/.test(h._addr[0] || "") ? h._addr[0] : null;
        h.ZipCode = h.Zip === "none" ? null : h.Zip; // без ZIP модель берёт самый частый, как при обучении
        return h;
      });
      data._byParcel = new Map(data._houses.map((h) => [h.ParcelId, h]));
    }
    return data;
  }

  async function houseByParcel(pid) {
    let shard;
    try { shard = await load(`data/parcels/${pid.slice(0, 3)}.json`); } catch (e) { return null; }
    const zip = shard[pid];
    if (!zip) return null;
    return (await loadZip(zip))._byParcel.get(pid) || null;
  }

  // ---------------------------------------------------------------- поиск
  async function find(text) {
    text = String(text || "").trim();
    const [site, address] = extractAddressFromListingUrl(text);
    if (address) return findByAddress(address);
    if (site) return { error: `В этой ссылке ${site} нет адреса. Скопируйте адрес дома со страницы объявления.` };

    const pid = extractParcelId(text);
    if (pid) {
      const house = await houseByParcel(pid);
      if (house) return { house };
      // Номер мог прийти со страницы другого округа: если рядом есть адрес, проверим его.
      const rest = text.replace(/\d{6}-?\d{4}/, " ").trim().replace(/^[\s(]+|[\s)]+$/g, "");
      if (/^\s*\(?\s*\d+\s+\w/.test(rest)) {
        const byAddress = await findByAddress(rest);
        if (byAddress.house || byAddress.candidates || (byAddress.error || "").includes("не входит в King County")) return byAddress;
      }
      return { error: `Участок ${pid} не найден среди жилых домов King County. Возможно, это кондо, коммерция или пустой участок.` };
    }
    if (URL_RE.test(text)) {
      return { error: "Не понял ссылку. Подходят ссылки Zillow, Redfin и King County, номер участка или адрес дома." };
    }
    return findByAddress(text);
  }

  const candidate = (e) => ({ ParcelId: e[0], Address: e[1], ZipCode: e[2] === "none" ? "" : e[2] });

  // Токены только улицы: город отрезаем ('Federal Way' содержит WAY, 'North Bend' — NORTH).
  function streetPartTokens(text) {
    text = String(text || "").split(/\b(?:APT|UNIT|STE|SUITE)\b|#/i)[0];
    if (text.includes(",")) return addressTokens(text.split(",")[0]);
    const tokens = addressTokens(text);
    for (let i = 2; i < tokens.length; i++) {
      if (SUFFIXES.has(tokens[i]) && tokens.slice(1, i).some((t) => !DIRECTIONS.has(t))) {
        let j = i + 1;
        // После типа улицы — максимум одно направление (Blvd SW), дальше город (North Bend).
        if (j < tokens.length && DIRECTIONS.has(tokens[j])) j++;
        return tokens.slice(0, j);
      }
    }
    return tokens.filter((t) => !ZIP_TOKEN.test(t));
  }

  // ZIP из запроса: последнее 5-значное число, кроме номера дома в начале.
  function findZip(text) {
    text = String(text || "").trim();
    const matches = [...text.matchAll(/(?<!\d)(\d{5})(?:-\d{4})?(?!\d)/g)].filter((m) => m.index > 0);
    return matches.length ? matches[matches.length - 1][1] : null;
  }

  // Основной вариант улицы и, для ссылок без запятых, всё более короткие (NW-Esplanade-Seattle).
  function queryVariants(text) {
    const tokens = streetPartTokens(text);
    const variants = [tokens.slice(1)];
    if (!String(text).includes(",")) {
      const clean = String(text).split(/\b(?:APT|UNIT|STE|SUITE)\b|#/i)[0];
      const full = addressTokens(clean).filter((t) => !ZIP_TOKEN.test(t));
      for (let k = full.length - 1; k > 1; k--) {
        const v = full.slice(1, k);
        if (!variants.some((x) => x.join(" ") === v.join(" "))) variants.push(v);
      }
    }
    return [tokens, variants];
  }

  // Улица без номера -> направления, тип, название. 'S LN ST': Lane — название, а не тип.
  function parseStreet(tokens) {
    tokens = tokens.filter((t) => !ZIP_TOKEN.test(t));
    const dirs = new Set(tokens.filter((t) => DIRECTIONS.has(t)));
    let rest = tokens.filter((t) => !DIRECTIONS.has(t));
    let suffix = null;
    if (rest.length >= 2 && SUFFIXES.has(rest[rest.length - 1])) {
      suffix = rest[rest.length - 1];
      rest = rest.slice(0, -1);
    }
    return { dirs, suffix, names: new Set(rest) };
  }

  const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

  // Совпадение адреса из базы с улицей запроса (0 — другой дом). Как address_match_score в valuation.py.
  function addressMatchScore(candTokens, queryTokens) {
    const c = parseStreet(candTokens.slice(1)), q = parseStreet(queryTokens);
    if (!c.names.size || !setEq(c.names, q.names)) return 0;
    if (c.dirs.size && q.dirs.size && !setEq(c.dirs, q.dirs)) return 0; // NE 48th St ≠ N 48th St
    if (c.suffix && q.suffix && c.suffix !== q.suffix) return 0;        // 48th St ≠ 48th Ave
    return 1 + 0.1 * setEq(c.dirs, q.dirs) + 0.1 * (c.suffix === q.suffix);
  }

  function prettyAddress(tokens) {
    const out = [];
    for (const t of tokens) {
      if (ZIP_TOKEN.test(t)) break;
      out.push(t);
      if (SUFFIXES.has(t) && out.length > 2) break;
    }
    return out.map((t) => (DIRECTIONS.has(t) ? t : titleCase(t))).join(" ");
  }

  function notFoundMessage(pretty) {
    return `Дома ${pretty} нет в базе жилых домов King County. Чаще всего это кондо, таунхаус, многоквартирный дом или новая постройка — такие дома модель не оценивает. Если это обычный частный дом, вставьте его 10-значный номер участка (на Zillow — «Parcel number», на Redfin — «APN»).`;
  }

  // ZIP King County: 98001–98199, плюс Baring (98224), Skykomish (98288), Milton (98354), часть Federal Way (98422).
  // Как is_king_county_zip в valuation.py.
  function isKingCountyZip(zip) {
    const z = parseInt(zip, 10);
    return (z >= 98001 && z <= 98199) || [98224, 98288, 98354, 98422].includes(z);
  }

  function outsideMessage(zip) {
    return `ZIP ${zip} не входит в King County. Модель знает только дома King County (Сиэтл, Беллвью, Редмонд, Киркленд, Кент, Рентон, Оберн, Federal Way и окрестности), поэтому этот дом оценить нельзя.`;
  }

  async function findByAddress(text) {
    const [tokens, variants] = queryVariants(text);
    if (!tokens.length || !/^\d+$/.test(tokens[0])) {
      return { error: "Не понял запрос. Нужна ссылка Zillow, Redfin или King County, номер участка или адрес вида '12345 NE 85th St, Redmond 98052'." };
    }
    const number = tokens[0];
    const zip = findZip(text);
    // ZIP явно не из King County: похожий адрес в округе — это другой дом.
    if (zip && !isKingCountyZip(zip)) return { error: outsideMessage(zip) };
    const query = tokens.slice(1);
    if (!parseStreet(query).names.size) return { error: "В адресе нет названия улицы." };

    let entries = [];
    try { entries = await load(`data/addr/${number.slice(-2).padStart(2, "0")}.json`); } catch (e) { entries = []; }

    const sameNumber = entries.map((e) => [e, addressTokens(e[1])]).filter(([, t]) => t[0] === number);
    let scored = [];
    for (const variant of variants) {
      scored = sameNumber.map(([e, t]) => [e, addressMatchScore(t, variant)]).filter(([, sc]) => sc > 0);
      if (scored.length) break;
    }
    if (zip && scored.some(([e]) => e[2] === zip)) scored = scored.filter(([e]) => e[2] === zip);
    scored.sort((a, b) => b[1] - a[1]);

    if (!scored.length) return { error: notFoundMessage(prettyAddress(tokens)) };
    const best = scored[0][1];
    const top = scored.filter(([, sc]) => sc >= best - 1e-9);
    if (top.length === 1) {
      const [pid, , z] = top[0][0];
      const house = (await loadZip(z))._byParcel.get(pid);
      if (house) return { house };
    }
    return { candidates: top.slice(0, 5).map(([e]) => candidate(e)), message: "По этому адресу в базе несколько домов. Выберите нужный:" };
  }

  // ---------------------------------------------------------------- модель
  const toNum = (v) => (v === null || v === undefined || v === "" || isNaN(+v) ? NaN : +v);

  async function predictValue(house) {
    const [meta, model] = await Promise.all([load("data/meta.json"), load("data/model.json")]);
    const raw = {};
    for (const f of meta.numeric) raw[f.name] = toNum(house[f.name]);
    raw.SaleYear = meta.latest_sale_year;
    raw.SaleMonth = meta.latest_sale_month;
    raw.PropertyAge = raw.SaleYear - raw.YrBuilt;
    raw.YearsSinceRenovation = raw.YrRenovated > 0 ? raw.SaleYear - raw.YrRenovated : raw.PropertyAge;

    const x = new Float64Array(model.layers[0].in);
    meta.numeric.forEach((f, i) => {
      const v = Number.isNaN(raw[f.name]) ? f.median : raw[f.name];
      x[i] = (v - f.mean) / f.scale;
    });
    for (const c of meta.categorical) {
      const value = house[c.name] == null ? c.fill : String(house[c.name]);
      const col = c.index[value];
      if (col !== undefined) x[col] = 1;
    }

    let h = x;
    for (const L of model.layers) {
      const out = new Float64Array(L.out);
      for (let o = 0; o < L.out; o++) {
        let s = L.b[o];
        const off = o * L.in;
        for (let i = 0; i < L.in; i++) s += L.W[off + i] * h[i];
        out[o] = L.leaky !== null && s < 0 ? s * L.leaky : s;
      }
      h = out;
    }
    const logPred = h[0] * meta.target_std + meta.target_mean;
    const conservative = logPred - meta.risk_sigma * meta.residual_std;
    return [Math.expm1(logPred), Math.expm1(conservative)];
  }

  // ---------------------------------------------------------------- сравнение
  function quantile(sorted, q) {
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  async function comparableSales(house) {
    const sqft = toNum(house.SqFtTotLiving), grade = toNum(house.BldgGrade);
    if (!(sqft > 0) || !house.Zip || house.Zip === "none") return { count: 0 };
    const data = await loadZip(house.Zip);
    const recent = data.sales.filter((s) => s[0] !== house.ParcelId);

    let comps = [];
    for (const [tol, gtol] of [[0.25, 1], [0.4, 2], [0.6, null]]) {
      comps = recent.filter((s) => s[1] >= sqft * (1 - tol) && s[1] <= sqft * (1 + tol));
      if (gtol !== null && !Number.isNaN(grade)) comps = comps.filter((s) => s[2] != null && Math.abs(s[2] - grade) <= gtol);
      if (comps.length >= 5) break;
    }
    if (comps.length < 3) return { count: comps.length };
    const ppsf = comps.map((s) => s[3] / s[1]).sort((a, b) => a - b);
    const median = quantile(ppsf, 0.5);
    return {
      count: comps.length, median_ppsf: median, estimate: median * sqft,
      low: quantile(ppsf, 0.25) * sqft, high: quantile(ppsf, 0.75) * sqft,
    };
  }

  // ---------------------------------------------------------------- оценка
  async function evaluate(house, askingPrice, repairCost, settings) {
    const meta = await load("data/meta.json");
    const st = Object.assign({}, meta.settings, settings || {});
    const warnings = [];

    const repairIsEstimate = repairCost == null;
    if (repairIsEstimate) {
      let cond = toNum(house.Condition), sqft = toNum(house.SqFtTotLiving);
      if (Number.isNaN(sqft)) sqft = 1800;
      if (Number.isNaN(cond)) cond = 3;
      const rate = meta.repair_rates[String(Math.trunc(cond))] ?? 20;
      repairCost = Math.round((rate * sqft) / 1000) * 1000;
    }

    const [predicted, conservative] = await predictValue(house);
    const comps = await comparableSales(house);

    if (comps.count >= 3) {
      const gap = Math.abs(predicted - comps.estimate) / comps.estimate;
      if (gap > meta.comps_warning) warnings.push(`Модель и сравнимые продажи расходятся на ${Math.round(gap * 100)}%. Оценке доверять осторожно.`);
    } else {
      warnings.push("Мало похожих продаж рядом — не с чем сверить модель.");
    }
    if (house.LastSalePrice && house.LastSaleDate) {
      const months = (new Date(meta.latest_sale_date) - new Date(house.LastSaleDate)) / 864e5 / 30.4;
      if (months < 18) warnings.push(`Дом уже продавался ${house.LastSaleDate} за $${Math.round(house.LastSalePrice).toLocaleString("en-US")}.`);
    }
    const units = toNum(house.NbrLivingUnits), bldg = toNum(house.BldgNbr);
    if (units > 1) warnings.push(`По данным оценщика жилых единиц в доме: ${units}. Модель обучена на домах на одну семью, поэтому оценка может быть неточной.`);
    if (!Number.isNaN(bldg) && bldg !== 1) warnings.push("На участке несколько зданий, взято не главное. Проверьте характеристики.");
    if (askingPrice < 0.5 * conservative) warnings.push("Цена подозрительно низкая относительно оценки: проверьте, не кондо ли это, нет ли обременений или серьёзных дефектов.");

    const sellingCost = conservative * st.selling_cost_rate;
    const requiredProfit = conservative * st.target_profit_rate;
    const breakEven = conservative - repairCost - st.closing_and_holding_cost - sellingCost;
    const maxPrice = breakEven - requiredProfit;
    const profit = conservative - askingPrice - repairCost - st.closing_and_holding_cost - sellingCost;
    const invested = askingPrice + repairCost + st.closing_and_holding_cost;

    return {
      house, asking_price: askingPrice, repair_cost: repairCost, repair_is_estimate: repairIsEstimate,
      predicted_value: predicted, conservative_value: conservative, comps,
      max_profitable_price: maxPrice, break_even_price: breakEven, estimated_profit: profit,
      estimated_roi: invested > 0 ? profit / invested : NaN,
      verdict: askingPrice <= maxPrice ? "BUY" : profit > 0 ? "BORDERLINE" : "SKIP",
      warnings, settings: st,
    };
  }

  async function info() {
    const meta = await load("data/meta.json");
    return { latest_sale_date: meta.latest_sale_date, settings: meta.settings };
  }

  root.HouseEngine = {
    setLoader: (fn) => { loader = fn; cache.clear(); },
    extractParcelId, extractAddressFromListingUrl, parseMoney,
    find, predictValue, evaluate, info,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
