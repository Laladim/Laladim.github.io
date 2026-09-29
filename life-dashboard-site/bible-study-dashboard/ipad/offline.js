/* Store personal study data on this device. Nothing in an imported file is uploaded. */
(() => {
  "use strict";
  const FORMAT = "esv-study-offline-v1";
  const scope = new URL("./", location.href).pathname;
  const databaseName = `esv-study:${scope}`;
  let payload = null;
  let rawData = null;
  let saved = false;
  let shellReady = false;
  let acceptData;
  let operation = false;
  let databasePromise;
  const el = (id) => document.getElementById(id);

  function validate(data) {
    if (data?.format !== FORMAT || data.bible?.version !== "ESV" ||
        !data.bible.books || Object.keys(data.bible.books).length !== 66 ||
        typeof data.bible.versionName !== "string" ||
        typeof data.bible.meta?.copyright !== "string") {
      throw new Error("Choose the ESV-Study-Data.json file prepared for this dashboard.");
    }
    const books = Object.values(data.bible.books);
    if (books.some((chapters) => !Array.isArray(chapters)) ||
        books.reduce((count, chapters) => count + chapters.length, 0) !== 1189 ||
        !books.every((chapters) => chapters.every((verses) => Array.isArray(verses) &&
          verses.length > 0 && verses.every((tokens) => Array.isArray(tokens) &&
            tokens.every((token) => Array.isArray(token) && typeof token[0] === "string" &&
              (token[1] === undefined || typeof token[1] === "string")))))) {
      throw new Error("The study file is incomplete. Choose the original ESV-Study-Data.json file.");
    }
    const refs = data.crossrefs;
    if (!refs?.refs || typeof refs.source !== "string" || typeof refs.license !== "string" ||
        !Number.isInteger(refs.source_verses) || refs.source_verses < 1 ||
        Object.keys(refs.refs).length !== refs.source_verses ||
        !Object.values(refs.refs).every((rows) => Array.isArray(rows) && rows.every((row) =>
          typeof row.to === "string" && Number.isFinite(row.votes)))) {
      throw new Error("The cross-reference data is incomplete. Choose the original study file.");
    }
    return data;
  }

  function database() {
    if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("study");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Close other dashboard tabs, then try again."));
    }).catch((error) => { databasePromise = null; throw error; });
    return databasePromise;
  }

  async function readSaved() {
    const db = await database();
    return new Promise((resolve, reject) => {
      const request = db.transaction("study", "readonly").objectStore("study").get("data");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function writeSaved(raw) {
    const db = await database();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction("study", "readwrite");
      transaction.objectStore("study").put(raw, "data");
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error || new Error("The save was interrupted."));
      transaction.onerror = () => reject(transaction.error);
    });
    if (await readSaved() !== raw) throw new Error("The saved data could not be verified. Try saving again.");
  }

  function report() {
    el("offlineState").textContent = saved && shellReady ? "Offline ready" :
      saved ? "Study data saved. App download needed." : "Offline setup needed";
    el("offlineDetail").textContent = saved && shellReady
      ? "The app and all 66 ESV books are saved in this browser. Keep the original file as your backup."
      : "Import ESV-Study-Data.json to load the Bible and cross-references into this browser. Nothing is uploaded.";
    el("saveOffline").disabled = !payload || operation;
  }

  async function prepareShell(repair = false) {
    if (!window.isSecureContext || !("serviceWorker" in navigator)) {
      throw new Error("Open the iPad installation page in Safari using its HTTPS address to enable offline use.");
    }
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error("The app download took too long. Reconnect and tap Save for offline use.")), 15000))
    ]);
    shellReady = await new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => { channel.port1.close(); reject(new Error("Could not verify the app download. Try saving again.")); }, 8000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timeout);
        channel.port1.close();
        resolve(event.data?.ready === true);
      };
      registration.active.postMessage({ type: repair ? "SAVE_OFFLINE" : "CHECK_OFFLINE" }, [channel.port2]);
    });
    if (!shellReady) throw new Error("The app download is incomplete. Reconnect and tap Save for offline use.");
  }

  async function storeCurrent() {
    await writeSaved(rawData);
    saved = true;
    try { await navigator.storage?.persist?.(); } catch (_) { /* Saving works without persistent mode. */ }
  }

  function showData(data, raw) {
    payload = data;
    rawData = raw;
    acceptData([data.bible, data.crossrefs]);
    el("offlineSetup").open = false;
  }

  async function importFile() {
    const file = el("studyDataFile").files[0];
    if (!file || operation) return;
    operation = true;
    el("studyDataFile").disabled = true;
    el("saveOffline").disabled = true;
    el("offlineState").textContent = "Checking your study file...";
    try {
      if (file.size > 80 * 1024 * 1024) throw new Error("This file is too large. Choose ESV-Study-Data.json.");
      const raw = await file.text();
      let data;
      try { data = JSON.parse(raw); } catch (_) { throw new Error("This is not a valid study file. Choose ESV-Study-Data.json."); }
      validate(data);
      // Validate before replacing the current passage or any saved data.
      saved = false;
      showData(data, raw);
      el("offlineState").textContent = "Saving all 66 books...";
      await storeCurrent();
      await prepareShell(true);
      report();
    } catch (error) {
      el("offlineSetup").open = true;
      el("offlineState").textContent = saved && shellReady ? "Offline ready; import not completed" : "Offline setup not complete";
      el("offlineDetail").textContent = error.name === "QuotaExceededError"
        ? "There is not enough space to save the study data. Free some iPad storage, then try again."
        : error.message;
    } finally {
      operation = false;
      el("studyDataFile").disabled = false;
      el("studyDataFile").value = "";
      el("saveOffline").disabled = !payload;
    }
  }

  async function retrySave() {
    if (!payload || operation) return;
    operation = true;
    el("saveOffline").disabled = true;
    el("offlineState").textContent = "Saving for offline use...";
    try {
      await storeCurrent();
      await prepareShell(true);
      report();
    } catch (error) {
      el("offlineState").textContent = "Offline setup not complete";
      el("offlineDetail").textContent = error.message;
    } finally {
      operation = false;
      el("saveOffline").disabled = false;
    }
  }

  async function start(onData) {
    acceptData = onData;
    el("studyDataFile").addEventListener("change", importFile);
    el("saveOffline").addEventListener("click", retrySave);
    const shell = prepareShell().then(() => { report(); return null; }).catch((error) => error);
    try {
      // The Mac reads its canonical files; the iPad reads only its private saved copy.
      if (document.documentElement.dataset.localData === "true") {
        try {
          const paths = ["bible/esv-text/json/ESV.json", "bible/cross-references/openbible-cross-references.json"];
          const [bible, crossrefs] = await Promise.all(paths.map(async (path) => {
            const response = await fetch(path);
            if (!response.ok) throw new Error("The local Bible files could not be loaded.");
            return response.json();
          }));
          const data = validate({ format: FORMAT, bible, crossrefs });
          showData(data, JSON.stringify(data));
          await storeCurrent();
        } catch (error) {
          const raw = await readSaved();
          if (!raw) throw error;
          saved = true;
          showData(validate(JSON.parse(raw)), raw);
        }
      } else {
        const raw = await readSaved();
        if (raw) {
          const data = validate(JSON.parse(raw));
          saved = true;
          showData(data, raw);
        }
      }
      if (!payload) {
        el("loading").classList.add("hidden");
        el("offlineSetup").open = true;
        el("dataStatus").textContent = "Import your ESV study file to begin.";
        el("rangeLabel").textContent = "ESV file needed";
        el("passageBoard").innerHTML = `<div class="workspace-empty">Choose ESV-Study-Data.json below. The file will stay in this browser and will not be added to the public site.</div>`;
        el("cards").innerHTML = `<div class="empty">Cross-references will appear after your ESV file is loaded.</div>`;
      }
      const shellError = await shell;
      report();
      if (shellError) {
        el("offlineDetail").textContent = shellError.message;
        el("offlineSetup").open = true;
      }
    } catch (error) {
      el("loading").classList.add("hidden");
      el("offlineSetup").open = true;
      el("offlineState").textContent = "Offline setup not complete";
      el("offlineDetail").textContent = error.message;
      if (!payload) el("dataStatus").textContent = "Choose your study file to begin.";
      await shell;
    }
  }

  window.ESVOffline = { start };
})();
