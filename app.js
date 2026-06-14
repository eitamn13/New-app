/* ===== סורק קבלות — לוגיקת אפליקציה ===== */
(function () {
  "use strict";

  // --- מצב ---
  const state = {
    cart: [],                 // {barcode, name, price, qty, img}
    catalog: load("catalog", {}),  // barcode -> {name, price, img}
    storeName: load("storeName", "חנות שלי"),
    pending: null,            // פריט שנסרק וממתין לאישור {barcode, img}
  };

  // --- אלמנטים ---
  const $ = (id) => document.getElementById(id);
  const el = {
    video: $("video"),
    canvas: $("captureCanvas"),
    scanStatus: $("scanStatus"),
    startCam: $("startCamBtn"),
    stopCam: $("stopCamBtn"),
    manual: $("manualBtn"),
    cartCount: $("cartCount"),
    cartTotal: $("cartTotal"),
    goReceipt: $("goReceiptBtn"),
    scannerScreen: $("scannerScreen"),
    receiptScreen: $("receiptScreen"),
    backToScan: $("backToScanBtn"),
    print: $("printBtn"),
    newReceipt: $("newReceiptBtn"),
    storeTag: $("storeName"),
    // modal
    modal: $("itemModal"),
    modalTitle: $("modalTitle"),
    capturedPreview: $("capturedPreview"),
    capturedImg: $("capturedImg"),
    fBarcode: $("fBarcode"),
    fName: $("fName"),
    fPrice: $("fPrice"),
    fQty: $("fQty"),
    saveItem: $("saveItemBtn"),
    cancelItem: $("cancelItemBtn"),
    // receipt
    rStore: $("rStore"),
    rMeta: $("rMeta"),
    rItems: $("rItems"),
    rCount: $("rCount"),
    rVat: $("rVat"),
    rTotal: $("rTotal"),
    rBarcode: $("rBarcode"),
  };

  // --- אחסון ---
  function load(key, def) {
    try { return JSON.parse(localStorage.getItem("rcpt_" + key)) ?? def; }
    catch { return def; }
  }
  function save(key, val) {
    try { localStorage.setItem("rcpt_" + key, JSON.stringify(val)); } catch {}
  }

  // --- עזרי כסף ---
  const ils = (n) => "₪" + (Math.round(n * 100) / 100).toFixed(2);

  // ===== ZXing scanner =====
  let codeReader = null;
  let scanning = false;

  async function startCamera() {
    if (scanning) return;
    if (!("mediaDevices" in navigator)) {
      setStatus("המצלמה לא נתמכת בדפדפן זה");
      alert("הדפדפן לא תומך בגישה למצלמה. השתמש בהזנה ידנית.");
      return;
    }
    if (typeof ZXing === "undefined") {
      setStatus("ספריית הסריקה לא נטענה");
      alert("ספריית הסריקה לא נטענה (אין חיבור לרשת?). השתמש בהזנה ידנית.");
      return;
    }
    try {
      codeReader = new ZXing.BrowserMultiFormatReader();
      scanning = true;
      el.startCam.classList.add("hidden");
      el.stopCam.classList.remove("hidden");
      setStatus("מחפש ברקוד…");

      await codeReader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } },
        el.video,
        (result, err) => {
          if (result) onBarcode(result.getText());
        }
      );
    } catch (e) {
      console.error(e);
      setStatus("שגיאה בהפעלת המצלמה");
      alert("לא ניתן לגשת למצלמה: " + (e && e.message ? e.message : e));
      stopCamera();
    }
  }

  function stopCamera() {
    scanning = false;
    try { if (codeReader) codeReader.reset(); } catch {}
    codeReader = null;
    el.startCam.classList.remove("hidden");
    el.stopCam.classList.add("hidden");
    setStatus("המצלמה כבויה");
  }

  function setStatus(t) { el.scanStatus.textContent = t; }

  // מניעת סריקה כפולה רצופה
  let lastScan = { code: null, t: 0 };
  function onBarcode(code) {
    const now = Date.now();
    if (code === lastScan.code && now - lastScan.t < 2500) return;
    lastScan = { code, t: now };

    // צילום פריים מהמצלמה
    const img = captureFrame();
    beep();
    setStatus("נסרק: " + code);
    openItemModal(code, img);
  }

  function captureFrame() {
    try {
      const v = el.video;
      if (!v.videoWidth) return null;
      const c = el.canvas;
      const maxW = 480;
      const scale = Math.min(1, maxW / v.videoWidth);
      c.width = v.videoWidth * scale;
      c.height = v.videoHeight * scale;
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.6);
    } catch { return null; }
  }

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880; o.type = "square";
      g.gain.setValueAtTime(0.1, ctx.currentTime);
      o.start();
      o.stop(ctx.currentTime + 0.12);
      if (navigator.vibrate) navigator.vibrate(60);
    } catch {}
  }

  // ===== מודאל פריט =====
  function openItemModal(barcode, img) {
    state.pending = { barcode, img };
    const known = state.catalog[barcode];

    el.fBarcode.value = barcode || "";
    el.fName.value = known ? known.name : "";
    el.fPrice.value = known ? known.price : "";
    el.fQty.value = 1;
    el.modalTitle.textContent = known ? "מוצר מוכר ✓" : "פריט חדש";

    // תמונה: שמורה בקטלוג או מהפריים
    const showImg = img || (known && known.img);
    if (showImg) {
      el.capturedImg.src = showImg;
      el.capturedPreview.classList.remove("hidden");
    } else {
      el.capturedPreview.classList.add("hidden");
    }
    el.capturedImg.dataset.src = showImg || "";

    el.modal.classList.remove("hidden");
    if (!known) setTimeout(() => el.fName.focus(), 100);
  }

  function closeItemModal() {
    el.modal.classList.add("hidden");
    state.pending = null;
  }

  function saveItem() {
    const barcode = el.fBarcode.value.trim();
    const name = el.fName.value.trim() || "מוצר ללא שם";
    const price = parseFloat(el.fPrice.value) || 0;
    const qty = Math.max(1, parseInt(el.fQty.value) || 1);
    const img = el.capturedImg.dataset.src || null;

    if (price <= 0) {
      if (!confirm("המחיר הוא 0. להוסיף בכל זאת?")) return;
    }

    // שמירה לקטלוג ללמידה עתידית
    if (barcode) {
      state.catalog[barcode] = { name, price, img };
      save("catalog", state.catalog);
    }

    // אם המוצר כבר בעגלה — הגדל כמות
    const existing = barcode ? state.cart.find((i) => i.barcode === barcode) : null;
    if (existing) {
      existing.qty += qty;
      existing.price = price;
      existing.name = name;
    } else {
      state.cart.push({ barcode, name, price, qty, img });
    }

    renderCart();
    closeItemModal();
  }

  // ===== עגלה =====
  function renderCart() {
    const count = state.cart.reduce((s, i) => s + i.qty, 0);
    const total = state.cart.reduce((s, i) => s + i.qty * i.price, 0);
    el.cartCount.textContent = count;
    el.cartTotal.textContent = ils(total);
    el.goReceipt.disabled = state.cart.length === 0;
  }

  // ===== קבלה =====
  function buildReceipt() {
    el.rStore.textContent = state.storeName;
    el.storeTag.textContent = state.storeName;

    const now = new Date();
    const dt = now.toLocaleDateString("he-IL") + "  " +
      now.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
    const num = "מס׳ " + String(Date.now()).slice(-6);
    el.rMeta.textContent = dt + "\n" + num;

    el.rItems.innerHTML = "";
    let total = 0, count = 0;
    state.cart.forEach((item, idx) => {
      const lineTotal = item.qty * item.price;
      total += lineTotal;
      count += item.qty;

      const wrap = document.createElement("div");
      const line = document.createElement("div");
      line.className = "r-item-line";
      line.innerHTML =
        '<span class="r-item-name">' + escapeHtml(item.name) +
        ' <button class="r-item-del" data-idx="' + idx + '" title="הסר">✕</button></span>' +
        "<span>" + ils(lineTotal) + "</span>";
      wrap.appendChild(line);

      if (item.qty > 1 || item.barcode) {
        const sub = document.createElement("div");
        sub.className = "r-item-sub";
        sub.textContent =
          (item.qty > 1 ? item.qty + " × " + ils(item.price) + "   " : "") +
          (item.barcode ? "ברקוד: " + item.barcode : "");
        wrap.appendChild(sub);
      }
      if (item.img) {
        const im = document.createElement("img");
        im.className = "r-item-img";
        im.src = item.img;
        wrap.appendChild(im);
      }
      el.rItems.appendChild(wrap);
    });

    const vat = total - total / 1.18; // מע"מ 18% כלול
    el.rCount.textContent = count;
    el.rVat.textContent = ils(vat);
    el.rTotal.textContent = ils(total);
    el.rBarcode.textContent = "*" + String(Date.now()).slice(-12) + "*";
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ===== ניווט מסכים =====
  function showReceipt() {
    buildReceipt();
    el.scannerScreen.classList.remove("active");
    el.receiptScreen.classList.add("active");
    window.scrollTo(0, 0);
  }
  function showScanner() {
    el.receiptScreen.classList.remove("active");
    el.scannerScreen.classList.add("active");
  }

  // ===== אירועים =====
  el.startCam.addEventListener("click", startCamera);
  el.stopCam.addEventListener("click", stopCamera);
  el.manual.addEventListener("click", () => openItemModal("", null));
  el.saveItem.addEventListener("click", saveItem);
  el.cancelItem.addEventListener("click", closeItemModal);
  el.modal.addEventListener("click", (e) => { if (e.target === el.modal) closeItemModal(); });

  el.goReceipt.addEventListener("click", showReceipt);
  el.backToScan.addEventListener("click", showScanner);
  el.print.addEventListener("click", () => window.print());

  el.newReceipt.addEventListener("click", () => {
    if (!confirm("לנקות את העגלה ולהתחיל קבלה חדשה?")) return;
    state.cart = [];
    renderCart();
    showScanner();
  });

  // הסרת פריט מתוך הקבלה
  el.rItems.addEventListener("click", (e) => {
    const btn = e.target.closest(".r-item-del");
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx);
    state.cart.splice(idx, 1);
    renderCart();
    if (state.cart.length === 0) { showScanner(); }
    else { buildReceipt(); }
  });

  // שינוי שם חנות
  el.storeTag.addEventListener("click", () => {
    const n = prompt("שם החנות / העסק:", state.storeName);
    if (n && n.trim()) {
      state.storeName = n.trim();
      save("storeName", state.storeName);
      el.storeTag.textContent = state.storeName;
      el.rStore.textContent = state.storeName;
    }
  });

  // Enter בשדה ברקוד/מחיר -> שמירה
  [el.fBarcode, el.fName, el.fPrice, el.fQty].forEach((inp) =>
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") saveItem(); }));

  // אתחול
  el.storeTag.textContent = state.storeName;
  el.rStore.textContent = state.storeName;
  renderCart();

  // ניקוי בעת יציאה
  window.addEventListener("beforeunload", stopCamera);

  // רישום Service Worker (PWA / offline)
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();
