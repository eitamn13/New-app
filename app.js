/* =========================================================
   קַבָּלָה · app logic
   ========================================================= */
(function () {
  "use strict";
  const CFG = window.APP_CONFIG;
  const $ = (id) => document.getElementById(id);
  const ils = (n) => "₪" + (Math.round((+n || 0) * 100) / 100).toLocaleString("he-IL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pad = (n, l) => String(n).padStart(l, "0");

  /* ---------- Supabase ---------- */
  let sb = null;
  try { if (window.supabase && CFG.SUPABASE_URL) sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY); }
  catch (e) { console.warn("Supabase init failed", e); }

  /* ---------- storage ---------- */
  const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  let deviceId = lsGet("rcpt_device", null);
  if (!deviceId) { deviceId = "dev_" + Math.random().toString(36).slice(2) + Date.now().toString(36); lsSet("rcpt_device", deviceId); }

  // פרטי עסק — ברירת מחדל לפי קבלת הדוגמה (ניתן לעריכה מלאה)
  const defaultBiz = {
    name: "ויקטורי", sub: "סופרמרקט · ירושלים", addr: "רחוב יפו 1, ירושלים",
    phone: "02-6480694", fax: "02-6480695", tax: "512293952",
    vat: 18, register: "01", pay: "מזומן",
  };
  const state = {
    cart: lsGet("rcpt_cart", []),
    biz: Object.assign({}, defaultBiz, lsGet("rcpt_biz", {})),
    seq: lsGet("rcpt_seq", 1361229),
    catalogCache: {},
    pending: null,
  };

  /* ---------- toast ---------- */
  let toastT;
  function toast(msg, kind) {
    const t = $("toast"); t.textContent = msg; t.className = "toast show" + (kind ? " " + kind : "");
    clearTimeout(toastT); toastT = setTimeout(() => (t.className = "toast"), 2800);
  }

  /* ---------- nav ---------- */
  function go(view) {
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    $("view-" + view).classList.add("active");
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
    if (view === "history") loadHistory();
    if (view === "catalog") loadCatalog();
    if (view !== "scan") stopCamera();
  }
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => go(t.dataset.view)));

  /* ============ CAMERA ============ */
  let reader = null, scanning = false, lastScan = { c: null, t: 0 };
  async function startCamera() {
    if (scanning) return;
    if (typeof ZXing === "undefined") { toast("ספריית הסריקה לא נטענה — השתמשו בהזנה ידנית", "err"); return; }
    try {
      reader = new ZXing.BrowserMultiFormatReader();
      scanning = true;
      $("startCamBtn").classList.add("hidden"); $("stopCamBtn").classList.remove("hidden");
      $("scannerIdle").style.display = "none"; $("reticle").hidden = false; $("scanPill").hidden = false;
      await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, $("video"),
        (res) => { if (res) onScan(res.getText()); });
    } catch (e) { console.error(e); toast("אין גישה למצלמה: " + (e.message || e), "err"); stopCamera(); }
  }
  function stopCamera() {
    scanning = false; try { reader && reader.reset(); } catch {} reader = null;
    $("startCamBtn") && $("startCamBtn").classList.remove("hidden");
    $("stopCamBtn") && $("stopCamBtn").classList.add("hidden");
    const idle = $("scannerIdle"); if (idle) idle.style.display = "";
    const r = $("reticle"); if (r) r.hidden = true;
    const p = $("scanPill"); if (p) p.hidden = true;
  }
  function onScan(code) {
    const now = Date.now();
    if (code === lastScan.c && now - lastScan.t < 2800) return;
    lastScan = { c: code, t: now };
    feedback();
    openItem(code, { capturedImg: grabFrame() });
  }
  function grabFrame() {
    try {
      const v = $("video"); if (!v.videoWidth) return null;
      const c = $("captureCanvas"), s = Math.min(1, 420 / v.videoWidth);
      c.width = v.videoWidth * s; c.height = v.videoHeight * s;
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.6);
    } catch { return null; }
  }
  function feedback() {
    try {
      const a = new (window.AudioContext || window.webkitAudioContext)();
      const o = a.createOscillator(), g = a.createGain(); o.connect(g); g.connect(a.destination);
      o.type = "sine"; o.frequency.value = 1180;
      g.gain.setValueAtTime(.0001, a.currentTime);
      g.gain.exponentialRampToValueAtTime(.16, a.currentTime + .01);
      g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + .16);
      o.start(); o.stop(a.currentTime + .17);
    } catch {}
    if (navigator.vibrate) navigator.vibrate(50);
  }

  /* ============ PRODUCT LOOKUP ============ */
  async function lookupCatalog(barcode) {
    if (state.catalogCache[barcode]) return state.catalogCache[barcode];
    if (!sb) return null;
    try { const { data } = await sb.from("rcpt_catalog").select("*").eq("barcode", barcode).maybeSingle();
      if (data) { state.catalogCache[barcode] = data; return data; } } catch (e) { console.warn(e); }
    return null;
  }
  async function lookupOFF(barcode) {
    try {
      const r = await fetch(CFG.OFF_API + encodeURIComponent(barcode) + ".json?fields=product_name,product_name_he,brands,image_front_small_url,image_url");
      if (!r.ok) return null;
      const j = await r.json();
      if (j.status !== 1 || !j.product) return null;
      const p = j.product;
      const name = (p.product_name_he || p.product_name || "").trim();
      if (!name) return null;
      return { name, brand: (p.brands || "").split(",")[0].trim() || null, image_url: p.image_front_small_url || p.image_url || null, source: "openfoodfacts" };
    } catch { return null; }
  }
  // זיהוי חכם עם Claude (Edge Function) מתוך תמונה
  async function identifyWithAI() {
    const img = $("fImg").value;
    if (!img) { toast("צלמו תחילה תמונה של המוצר", "err"); return; }
    if (!sb) { toast("אין חיבור לענן", "err"); return; }
    const btn = $("aiIdentifyBtn"); const prev = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = "מזהה…";
    try {
      const { data, error } = await sb.functions.invoke("identify-product", { body: { image: img, barcode: $("fBarcode").value || null } });
      if (error) throw error;
      if (data && data.name) {
        $("fName").value = data.name;
        if (data.brand) $("fBrand").value = data.brand;
        $("fSource").value = "ai";
        $("sheetTitle").textContent = data.name;
        setBadge("ai", "זוהה ע״י Claude ✦");
        toast("זוהה: " + data.name, "ok");
      } else { toast("לא זוהה מוצר — נסו שוב", "err"); }
    } catch (e) {
      console.warn(e);
      toast("זיהוי AI לא זמין (צריך מפתח Anthropic)", "err");
    } finally { btn.disabled = false; btn.innerHTML = prev; }
  }

  /* ============ ITEM SHEET ============ */
  async function openItem(barcode, opts) {
    opts = opts || {}; state.pending = { barcode };
    $("fName").value = ""; $("fPrice").value = ""; $("fQty").value = 1;
    $("fBarcode").value = barcode || ""; $("fImg").value = ""; $("fBrand").value = ""; $("fSource").value = "manual";
    $("itemBarcodeView").textContent = barcode ? "ברקוד " + barcode : "ללא ברקוד";
    setItemImage(opts.capturedImg || null);
    setBadge("new", "פריט חדש"); $("sheetTitle").textContent = barcode ? "מזהה מוצר…" : "פריט ידני";
    $("itemSheet").classList.remove("hidden");
    if (!barcode) { $("sheetTitle").textContent = "פריט ידני"; setTimeout(() => $("fName").focus(), 120); return; }

    const cat = await lookupCatalog(barcode);
    if (cat) {
      $("fName").value = cat.name || ""; $("fPrice").value = cat.price > 0 ? cat.price : "";
      $("fBrand").value = cat.brand || ""; $("fSource").value = cat.source || "cloud";
      if (cat.image_url) setItemImage(cat.image_url);
      $("sheetTitle").textContent = cat.name || "מוצר";
      setBadge("cloud", "מהקטלוג ☁ · נסרק " + (cat.scan_count || 1) + "×"); return;
    }
    const off = await lookupOFF(barcode);
    if (off) {
      $("fName").value = off.name; $("fBrand").value = off.brand || ""; $("fSource").value = "openfoodfacts";
      if (off.image_url) setItemImage(off.image_url);
      $("sheetTitle").textContent = off.name; setBadge("off", "זוהה במאגר העולמי ✓");
      setTimeout(() => $("fPrice").focus(), 120); return;
    }
    $("sheetTitle").textContent = "פריט חדש"; setBadge("new", "לא נמצא — הזינו פרטים או זהו ב-AI");
    setTimeout(() => $("fName").focus(), 120);
  }
  function setItemImage(src) {
    const img = $("itemImg"), ph = $("itemImgPlaceholder");
    if (src) { img.crossOrigin = "anonymous"; img.src = src; img.hidden = false; ph.style.display = "none"; $("fImg").value = src; }
    else { img.hidden = true; ph.style.display = ""; $("fImg").value = ""; }
  }
  function setBadge(cls, txt) { const b = $("itemBadge"); b.className = "src-badge " + cls; b.textContent = txt; b.classList.remove("hidden"); }
  function closeItem() { $("itemSheet").classList.add("hidden"); state.pending = null; }

  /* ---------- image upload ---------- */
  function dataUrlToBlob(d) {
    const [head, b64] = d.split(","); const mime = (head.match(/:(.*?);/) || [, "image/jpeg"])[1];
    const bin = atob(b64), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  async function uploadPhoto(d) {
    if (!sb || !d || !d.startsWith("data:")) return d || null;
    try {
      const path = "p/" + Date.now() + "_" + Math.random().toString(36).slice(2, 8) + ".jpg";
      const { error } = await sb.storage.from("rcpt-photos").upload(path, dataUrlToBlob(d), { contentType: "image/jpeg" });
      if (error) throw error;
      return sb.storage.from("rcpt-photos").getPublicUrl(path).data.publicUrl;
    } catch (e) { console.warn("upload failed", e); return null; }
  }

  async function saveItem() {
    const barcode = $("fBarcode").value.trim();
    const name = $("fName").value.trim() || "מוצר ללא שם";
    const price = parseFloat($("fPrice").value) || 0;
    const qty = Math.max(1, parseInt($("fQty").value) || 1);
    let image_url = $("fImg").value || null;
    const brand = $("fBrand").value || null, source = $("fSource").value || "manual";

    if (image_url && image_url.startsWith("data:")) {
      const btn = $("saveItemBtn"); btn.disabled = true; btn.textContent = "מעלה תמונה…";
      image_url = (await uploadPhoto(image_url)) || null;
      btn.disabled = false; btn.textContent = "הוספה לסל";
    }
    const ex = barcode ? state.cart.find((i) => i.barcode === barcode) : null;
    if (ex) { ex.qty += qty; ex.price = price; ex.name = name; ex.image_url = image_url; }
    else state.cart.push({ barcode, name, price, qty, image_url, brand });
    persistCart(); closeItem(); toast(name + " נוסף לסל", "ok");

    if (barcode && sb) sb.rpc("rcpt_upsert_catalog", { p_barcode: barcode, p_name: name, p_brand: brand, p_price: price, p_image_url: image_url, p_source: source })
      .then(({ error }) => { if (!error) delete state.catalogCache[barcode]; });
  }

  /* ============ CART ============ */
  function persistCart() { lsSet("rcpt_cart", state.cart); renderCartBar(); }
  function cartTotals() {
    const total = state.cart.reduce((s, i) => s + i.qty * i.price, 0);
    const count = state.cart.reduce((s, i) => s + i.qty, 0);
    const rate = (+state.biz.vat || 0) / 100;
    const vat = rate > 0 ? total - total / (1 + rate) : 0;
    return { total, count, vat, sub: total - vat };
  }
  function renderCartBar() {
    const { total, count } = cartTotals(); const bar = $("cartBar");
    if (!state.cart.length) { bar.classList.add("hidden"); return; }
    bar.classList.remove("hidden");
    $("cartBarCount").textContent = count + (count === 1 ? " פריט" : " פריטים");
    $("cartBarTotal").textContent = ils(total);
  }

  /* ============ RECEIPT ============ */
  let viewingSaved = null;
  function bizLines() {
    const b = state.biz; const L = [];
    if (b.sub) L.push(b.sub);
    if (b.addr) L.push(b.addr);
    const t = []; if (b.phone) t.push("טל׳ " + b.phone); if (b.fax) t.push("פקס " + b.fax);
    if (t.length) L.push(t.join("   "));
    if (b.tax) L.push("עוסק מורשה " + b.tax);
    return L.join("\n");
  }
  function makeBarcodeValue(no) {
    const d = new Date();
    return "" + d.getFullYear() + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2) + pad(state.biz.register || "1", 2) + pad(no, 7);
  }
  function openReceiptLive() {
    if (!state.cart.length) { toast("הסל ריק", "err"); return; }
    viewingSaved = null;
    $("receiptSheetTitle").textContent = "קבלה"; $("receiptLiveActions").classList.remove("hidden");
    const no = state.seq + 1;
    renderReceipt({ items: state.cart, ...cartTotals(), created_at: new Date().toISOString(), no }, true);
    $("receiptSheet").classList.remove("hidden");
  }
  function renderReceipt(r, live) {
    const b = state.biz;
    $("rpStore").textContent = b.name || "חנות";
    $("rpBiz").textContent = bizLines();
    const d = new Date(r.created_at);
    const no = r.no || (r.id ? parseInt(r.id.replace(/\D/g, "").slice(0, 7)) : state.seq);
    $("rpMeta").innerHTML =
      `<div class="rp-mrow"><span>${d.toLocaleDateString("he-IL")}</span><span>${d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}</span></div>` +
      `<div class="rp-mrow"><span>קופה ${esc(b.register || "01")}</span><span>עסקה ${no}</span></div>`;

    const wrap = $("rpItems"); wrap.innerHTML = "";
    (r.items || []).forEach((it, idx) => {
      const row = document.createElement("div"); row.className = "rp-item";
      const thumb = it.image_url ? `<img class="rp-thumb" src="${it.image_url}" crossorigin="anonymous" alt="">` : "";
      const del = live ? `<button class="rp-del" data-idx="${idx}">✕</button>` : "";
      row.innerHTML = thumb +
        `<div class="rp-iinfo"><div class="rp-iname">${esc(it.name)}</div>` +
        `<div class="rp-iqty">${it.qty} × ${ils(it.price)}${it.barcode ? "  ·  " + it.barcode : ""}</div></div>` +
        `<div class="rp-iprice">${ils(it.qty * it.price)}</div>` + del;
      wrap.appendChild(row);
    });

    $("rpCount").textContent = r.count != null ? r.count : (r.items || []).reduce((s, i) => s + i.qty, 0);
    $("rpSub").textContent = ils(r.sub != null ? r.sub : r.subtotal);
    $("rpVatLabel").textContent = "מע״מ " + (+b.vat || 0) + "% (כלול)";
    $("rpVat").textContent = ils(r.vat);
    $("rpTotal").textContent = ils(r.total);
    $("rpPayLabel").textContent = b.pay || "מזומן";
    $("rpPaid").textContent = ils(r.total);
    $("rpFooter").textContent = "COMAX POS · תודה ולהתראות";

    const val = makeBarcodeValue(no);
    try {
      if (window.JsBarcode) JsBarcode("#rpBarcode", val, { format: "CODE128", width: 1.6, height: 52, displayValue: true, fontSize: 13, margin: 0, background: "transparent", lineColor: "#1f1d19", font: "Heebo,monospace", textMargin: 3 });
    } catch (e) { console.warn("barcode", e); }
  }
  function rpItemDelete(idx) {
    state.cart.splice(idx, 1); persistCart();
    if (!state.cart.length) { $("receiptSheet").classList.add("hidden"); toast("הסל רוקן"); return; }
    renderReceipt({ items: state.cart, ...cartTotals(), created_at: new Date().toISOString(), no: state.seq + 1 }, true);
  }
  async function saveReceipt() {
    if (!state.cart.length) return;
    if (!sb) { toast("אין חיבור לענן", "err"); return; }
    const t = cartTotals(); const btn = $("saveReceiptBtn"); btn.disabled = true; btn.textContent = "שומר…";
    try {
      const { data: rec, error } = await sb.from("rcpt_receipts").insert({
        device_id: deviceId, store_name: state.biz.name, subtotal: t.sub, vat: t.vat, total: t.total, item_count: t.count,
      }).select().single();
      if (error) throw error;
      const items = state.cart.map((it, i) => ({ receipt_id: rec.id, barcode: it.barcode || null, name: it.name, price: it.price, qty: it.qty, image_url: it.image_url || null, position: i }));
      const { error: e2 } = await sb.from("rcpt_receipt_items").insert(items);
      if (e2) throw e2;
      state.seq += 1; lsSet("rcpt_seq", state.seq);
      state.cart = []; persistCart(); $("receiptSheet").classList.add("hidden");
      toast("הקבלה נשמרה ✓", "ok"); go("history");
    } catch (e) { console.error(e); toast("שמירה נכשלה: " + (e.message || e), "err"); }
    finally { btn.disabled = false; btn.textContent = "שמירה בענן"; }
  }

  /* ============ HISTORY ============ */
  async function loadHistory() {
    const list = $("historyList"), empty = $("historyEmpty"), stats = $("historyStats");
    empty.classList.add("hidden");
    list.innerHTML = `<div class="skl" style="height:80px"></div><div class="skl" style="height:80px"></div>`;
    if (!sb) { list.innerHTML = ""; empty.classList.remove("hidden"); return; }
    try {
      const { data, error } = await sb.from("rcpt_receipts").select("*").eq("device_id", deviceId).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      if (!data.length) { list.innerHTML = ""; stats.innerHTML = ""; empty.classList.remove("hidden"); return; }
      const spent = data.reduce((s, r) => s + (+r.total), 0), items = data.reduce((s, r) => s + r.item_count, 0);
      stats.innerHTML = statCard(data.length, "קבלות") + statCard(ils(spent), "סה״כ") + statCard(items, "פריטים");
      list.innerHTML = "";
      data.forEach((r) => {
        const d = new Date(r.created_at); const card = document.createElement("div"); card.className = "h-card";
        card.innerHTML = `<div class="h-ic">🧾</div><div class="h-main"><div class="h-store">${esc(r.store_name)}</div>` +
          `<div class="h-sub">${d.toLocaleDateString("he-IL")} · ${d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}</div></div>` +
          `<div class="h-amt"><div class="h-total">${ils(r.total)}</div><div class="h-items">${r.item_count} פריטים</div></div>`;
        card.addEventListener("click", () => openSavedReceipt(r)); list.appendChild(card);
      });
    } catch (e) { console.error(e); list.innerHTML = ""; empty.classList.remove("hidden"); toast("טעינת היסטוריה נכשלה", "err"); }
  }
  function statCard(v, l) { return `<div class="stat-card"><div class="v">${v}</div><div class="l">${l}</div></div>`; }
  async function openSavedReceipt(r) {
    viewingSaved = r; $("receiptSheetTitle").textContent = "קבלה שמורה"; $("receiptLiveActions").classList.add("hidden");
    $("receiptSheet").classList.remove("hidden");
    let items = [];
    try { const { data } = await sb.from("rcpt_receipt_items").select("*").eq("receipt_id", r.id).order("position"); items = data || []; } catch (e) { console.warn(e); }
    renderReceipt({ ...r, items, sub: r.subtotal, no: parseInt(("" + r.id).replace(/\D/g, "").slice(0, 7)) || state.seq }, false);
  }

  /* ============ CATALOG ============ */
  let catalogTimer;
  async function loadCatalog(q) {
    const list = $("catalogList"), empty = $("catalogEmpty"); empty.classList.add("hidden");
    if (!q) list.innerHTML = Array(4).fill('<div class="skl" style="height:180px"></div>').join("");
    if (!sb) { list.innerHTML = ""; empty.classList.remove("hidden"); return; }
    try {
      let query = sb.from("rcpt_catalog").select("*").order("updated_at", { ascending: false }).limit(60);
      if (q) query = sb.from("rcpt_catalog").select("*").or(`name.ilike.%${q}%,brand.ilike.%${q}%,barcode.ilike.%${q}%`).limit(60);
      const { data, error } = await query; if (error) throw error;
      renderCatalog(data || []);
    } catch (e) { console.error(e); list.innerHTML = ""; empty.classList.remove("hidden"); }
  }
  function renderCatalog(data) {
    const list = $("catalogList"), empty = $("catalogEmpty");
    if (!data.length) { list.innerHTML = ""; empty.classList.remove("hidden"); return; }
    empty.classList.add("hidden");
    list.innerHTML = data.map((c) => {
      const thumb = c.image_url ? `<img src="${c.image_url}" alt="" loading="lazy">` : "🛒";
      return `<div class="c-card" data-bc="${esc(c.barcode)}"><div class="c-thumb">${thumb}</div>` +
        `<div class="c-info"><div class="c-name">${esc(c.name)}</div>${c.brand ? `<div class="c-brand">${esc(c.brand)}</div>` : ""}` +
        `<div class="c-price">${c.price > 0 ? ils(c.price) : "— "}</div></div></div>`;
    }).join("");
    list.querySelectorAll(".c-card").forEach((el) => el.addEventListener("click", () => { go("scan"); openItem(el.dataset.bc, {}); }));
  }
  $("catalogSearch").addEventListener("input", (e) => { clearTimeout(catalogTimer); const q = e.target.value.trim(); catalogTimer = setTimeout(() => loadCatalog(q), 280); });

  /* ============ SHARE ============ */
  async function renderReceiptImage() {
    if (typeof html2canvas === "undefined") return null;
    try { const c = await html2canvas($("receiptPaper"), { backgroundColor: "#fffefb", scale: 2.5, useCORS: true, logging: false });
      return await new Promise((res) => c.toBlob((b) => res(b), "image/png", 0.95)); } catch (e) { console.warn(e); return null; }
  }
  async function shareReceipt() {
    toast("מכין תמונה…");
    const blob = await renderReceiptImage();
    if (blob) {
      const file = new File([blob], "receipt.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch {} }
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast("הקבלה הורדה כתמונה ✓", "ok"); return;
    }
    window.print();
  }

  /* ============ SETTINGS ============ */
  function openSettings() {
    const b = state.biz;
    $("bName").value = b.name || ""; $("bSub").value = b.sub || ""; $("bAddr").value = b.addr || "";
    $("bPhone").value = b.phone || ""; $("bFax").value = b.fax || ""; $("bTax").value = b.tax || "";
    $("bVat").value = b.vat != null ? b.vat : 18; $("bRegister").value = b.register || "01"; $("bPay").value = b.pay || "מזומן";
    $("settingsSheet").classList.remove("hidden");
  }
  function saveSettings() {
    state.biz = {
      name: $("bName").value.trim() || "חנות", sub: $("bSub").value.trim(), addr: $("bAddr").value.trim(),
      phone: $("bPhone").value.trim(), fax: $("bFax").value.trim(), tax: $("bTax").value.trim(),
      vat: parseFloat($("bVat").value) || 0, register: $("bRegister").value.trim() || "01", pay: $("bPay").value.trim() || "מזומן",
    };
    lsSet("rcpt_biz", state.biz); $("storeNameLabel").textContent = state.biz.name;
    $("settingsSheet").classList.add("hidden"); toast("פרטי העסק נשמרו ✓", "ok");
  }

  /* ============ helpers ============ */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  /* ============ events ============ */
  $("startCamBtn").addEventListener("click", startCamera);
  $("stopCamBtn").addEventListener("click", stopCamera);
  $("manualBtn").addEventListener("click", () => openItem("", {}));
  $("saveItemBtn").addEventListener("click", saveItem);
  $("cancelItemBtn").addEventListener("click", closeItem);
  $("itemSheet").addEventListener("click", (e) => { if (e.target === $("itemSheet")) closeItem(); });
  $("qtyMinus").addEventListener("click", () => { const f = $("fQty"); f.value = Math.max(1, (+f.value || 1) - 1); });
  $("qtyPlus").addEventListener("click", () => { const f = $("fQty"); f.value = (+f.value || 1) + 1; });
  $("capturePhotoBtn").addEventListener("click", () => $("photoInput").click());
  $("aiIdentifyBtn").addEventListener("click", identifyWithAI);
  $("photoInput").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = () => { const im = new Image(); im.onload = () => {
      const c = document.createElement("canvas"), s = Math.min(1, 700 / im.width);
      c.width = im.width * s; c.height = im.height * s; c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      setItemImage(c.toDataURL("image/jpeg", 0.72));
    }; im.src = r.result; };
    r.readAsDataURL(file); e.target.value = "";
  });

  $("viewCartBtn").addEventListener("click", openReceiptLive);
  $("closeReceiptBtn").addEventListener("click", () => $("receiptSheet").classList.add("hidden"));
  $("receiptSheet").addEventListener("click", (e) => { if (e.target === $("receiptSheet")) $("receiptSheet").classList.add("hidden"); });
  $("saveReceiptBtn").addEventListener("click", saveReceipt);
  $("shareReceiptBtn").addEventListener("click", shareReceipt);
  $("clearCartBtn").addEventListener("click", () => { if (!confirm("לרוקן את הסל?")) return; state.cart = []; persistCart(); $("receiptSheet").classList.add("hidden"); toast("הסל רוקן"); });
  $("rpItems").addEventListener("click", (e) => { const b = e.target.closest(".rp-del"); if (b) rpItemDelete(+b.dataset.idx); });

  $("settingsBtn").addEventListener("click", openSettings);
  $("closeSettingsBtn").addEventListener("click", () => $("settingsSheet").classList.add("hidden"));
  $("settingsSheet").addEventListener("click", (e) => { if (e.target === $("settingsSheet")) $("settingsSheet").classList.add("hidden"); });
  $("saveSettingsBtn").addEventListener("click", saveSettings);

  ["fName", "fPrice", "fQty"].forEach((id) => $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") saveItem(); }));

  /* ============ init ============ */
  $("storeNameLabel").textContent = state.biz.name;
  renderCartBar();
  if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  window.addEventListener("beforeunload", stopCamera);
})();
