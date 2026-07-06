const firms = ["Fion", "Motoexpress", "Byron", "MTPRO"];
    const storageKey = "video-planner-tr-v13-day-highlight-sound";
    const previousStorageKeys = ["video-planner-tr-v12-mode-deadline-radar", "video-planner-tr-v11-deadline-radar-slots", "video-planner-tr-v10-deadline-radar", "video-planner-tr-v9-category-date-fix", "video-planner-tr-v6", "video-planner-tr-v5", "video-planner-tr-v4", "video-planner-tr-v3", "video-planner-tr-v2", "video-planner-local-v2"];
    const monthNames = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
    const dayNames = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
    const projectTypes = ["Video", "Statik"];
    const roleModes = {
      manager: { label: "Yönetici", projectType: null, filterLabel: "Tümü", hint: "Tüm deadline’lar", description: "Video ve statik tüm deadline’ları gösterir. Filtre serbesttir; takvim ve bildirim tüm açık deadline’ları kapsar." },
      videographer: { label: "Videographer", projectType: "Video", filterLabel: "Sadece Video", hint: "Sadece video deadline’ları", description: "Sadece Reels / Video işleri görünür. Statik / Story / Post işleri tablo, radar, bildirim ve takvimden gizlenir." },
      designer: { label: "Grafik Tasarım", projectType: "Statik", filterLabel: "Sadece Statik", hint: "Sadece statik deadline’ları", description: "Sadece Story / Post / Statik işler görünür. Reels / Video işleri tablo, radar, bildirim ve takvimden gizlenir." }
    };
    let xlsxLoaderPromise = null;
    let reminderTimerHandles = [];
    let reminderFallbackInterval = null;
    let reminderAudioContext = null;
    let reminderAudioUnlocked = false;
    let titleFlashTimer = null;
    const baseDocumentTitle = document.title;
    const reminderSlots = [
      { key: "09", hour: 9, minute: 0, label: "09:00" },
      { key: "12", hour: 12, minute: 0, label: "12:00" },
      { key: "15", hour: 15, minute: 0, label: "15:00" }
    ];

    const julySeedDeadlines = {
      Fion: [11, 15, 18, 22, 24, 25, 29],
      Motoexpress: [],
      Byron: [8, 11, 18, 19, 21, 25, 29, 31],
      MTPRO: [8, 12, 14, 17, 21, 24, 28, 31]
    };

    function defaultState() {
      const state = {
        settings: { hideClosed: false, filterType: "all", roleMode: "manager", showModeSettings: false, clearBeforeImport: true, notificationsEnabled: false, lastNotifyDate: "", lastNotifySlots: {}, shrink: {} },
        months: [{ id: "2026-07", year: 2026, month: 7, startDay: 1, endDay: 31, collapsed: false, closed: false }],
        cells: {}
      };

      Object.entries(julySeedDeadlines).forEach(([firm, days]) => {
        days.forEach(day => {
          const key = cellKey("2026-07", day, firm);
          state.cells[key] = { hasProject: false, projectType: "Video", deadline: true, note: "" };
        });
      });

      return state;
    }

    function loadState() {
      try {
        let raw = localStorage.getItem(storageKey);
        if (!raw) {
          const oldKey = previousStorageKeys.find(key => localStorage.getItem(key));
          if (oldKey) raw = localStorage.getItem(oldKey);
        }
        if (!raw) return defaultState();
        const parsed = JSON.parse(raw);
        if (!parsed.months || !parsed.cells) return defaultState();
        parsed.settings = Object.assign({ hideClosed: false, filterType: "all", roleMode: "manager", showModeSettings: false, clearBeforeImport: true, notificationsEnabled: false, lastNotifyDate: "", lastNotifySlots: {}, shrink: {} }, parsed.settings || {});
        parsed.months.forEach(month => {
          month.startDay = 1;
          month.endDay = daysInMonth(month.year, month.month);
        });
        Object.keys(parsed.cells).forEach(key => normalizeCell(parsed.cells[key]));
        return parsed;
      } catch (err) {
        return defaultState();
      }
    }

    let state = loadState();

    function saveState() {
      localStorage.setItem(storageKey, JSON.stringify(state));
    }

    function cellKey(monthId, day, firm) {
      return `${monthId}:${day}:${firm}`;
    }

    function normalizeCell(cell) {
      if (typeof cell.hasProject !== "boolean") cell.hasProject = !!cell.video;
      if (!projectTypes.includes(cell.projectType)) cell.projectType = "Video";
      if (typeof cell.deadline !== "boolean") cell.deadline = false;
      if (typeof cell.note !== "string") cell.note = "";
      delete cell.video;
      return cell;
    }

    function getCell(monthId, day, firm) {
      const key = cellKey(monthId, day, firm);
      if (!state.cells[key]) state.cells[key] = { hasProject: false, projectType: "Video", deadline: false, note: "" };
      return normalizeCell(state.cells[key]);
    }

    function getActiveModeConfig() {
      const key = state.settings.roleMode || "manager";
      return roleModes[key] || roleModes.manager;
    }

    function modeAllowsProjectType(projectType) {
      const mode = getActiveModeConfig();
      return !mode.projectType || projectType === mode.projectType;
    }

    function enforceModeFilter() {
      const mode = getActiveModeConfig();
      if (mode.projectType) state.settings.filterType = mode.projectType;
      if (!mode.projectType && !projectTypes.includes(state.settings.filterType) && state.settings.filterType !== "all") state.settings.filterType = "all";
    }

    function updateModeUi() {
      enforceModeFilter();
      const mode = getActiveModeConfig();
      const roleModeEl = document.getElementById("roleMode");
      const modeHintEl = document.getElementById("modeHint");
      const typeFilterEl = document.getElementById("typeFilter");
      const filterNoteEl = document.getElementById("modeFilterNote");
      const modeSettingsEl = document.getElementById("modeSettings");
      const modeSettingsSummaryEl = document.getElementById("modeSettingsSummary");
      const modeSettingsContentEl = document.getElementById("modeSettingsContent");

      if (roleModeEl) roleModeEl.value = state.settings.roleMode || "manager";
      if (modeHintEl) modeHintEl.textContent = mode.hint;

      if (typeFilterEl) {
        typeFilterEl.value = state.settings.filterType || "all";
        typeFilterEl.disabled = !!mode.projectType;
        typeFilterEl.title = mode.projectType ? `${mode.label} modunda filtre ${mode.filterLabel} olarak kilitli.` : "Yönetici modunda filtre serbest.";
      }

      if (filterNoteEl) {
        filterNoteEl.textContent = mode.projectType ? `${mode.label} modunda ${mode.filterLabel.toLocaleLowerCase("tr-TR")} görünür.` : "Yönetici modunda tüm tipler açılabilir.";
        filterNoteEl.classList.toggle("visible", true);
      }

      if (modeSettingsEl) modeSettingsEl.open = !!state.settings.showModeSettings;
      if (modeSettingsSummaryEl) modeSettingsSummaryEl.textContent = mode.description;
      if (modeSettingsContentEl) {
        modeSettingsContentEl.innerHTML = Object.entries(roleModes).map(([key, item]) => `
          <div class="mode-rule ${key === (state.settings.roleMode || "manager") ? "active" : ""}">
            <strong>${item.label}</strong>
            ${item.description}<br>
            <b>Kapsam:</b> ${item.filterLabel}
          </div>
        `).join("");
      }
    }


    function shrinkOpenAttr(key, defaultOpen = true) {
      const shrink = state.settings.shrink || {};
      const hasValue = Object.prototype.hasOwnProperty.call(shrink, key);
      return hasValue ? (shrink[key] ? "open" : "") : (defaultOpen ? "open" : "");
    }

    function applyStaticShrinkState() {
      const shrink = state.settings.shrink || {};
      document.querySelectorAll("details[data-shrink-key]").forEach(detail => {
        const key = detail.dataset.shrinkKey;
        if (Object.prototype.hasOwnProperty.call(shrink, key)) {
          detail.open = !!shrink[key];
        }
      });
    }

    function escapeHtml(value) {
      return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    function formatDate(day, month, year) {
      return `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year}`;
    }

    function getDayLabel(day, month, year) {
      return dayNames[new Date(year, month - 1, day).getDay()];
    }

    function daysInMonth(year, month) {
      return new Date(year, month, 0).getDate();
    }

    function monthLabel(monthData) {
      return `${monthNames[monthData.month - 1]} ${monthData.year}`;
    }

    function dayHasAnyVisibleDeadline(monthId, day) {
      const filter = state.settings.filterType || "all";
      const mode = getActiveModeConfig();
      return firms.some(firm => {
        const cell = getCell(monthId, day, firm);
        if (!cell.deadline) return false;
        const matchesFilter = filter === "all" || cell.projectType === filter;
        const matchesMode = !mode.projectType || cell.projectType === mode.projectType;
        return matchesFilter && matchesMode;
      });
    }

    function render() {
      state.months.sort((a, b) => a.id.localeCompare(b.id));
      enforceModeFilter();
      document.getElementById("hideClosed").checked = !!state.settings.hideClosed;
      document.getElementById("typeFilter").value = state.settings.filterType || "all";
      document.getElementById("clearBeforeImport").checked = state.settings.clearBeforeImport !== false;
      updateModeUi();
      const container = document.getElementById("monthList");
      container.innerHTML = "";

      if (!state.months.length) {
        container.innerHTML = `<div class="empty-state">Henüz ay yok. Üstteki kontrolden bir ay ekleyebilirsin.</div>`;
        updateTotals();
        applyStaticShrinkState();
        return;
      }

      state.months.forEach(monthData => {
        monthData.startDay = 1;
        monthData.endDay = daysInMonth(monthData.year, monthData.month);

        const section = document.createElement("section");
        section.className = `month-panel ${monthData.closed ? "closed" : ""} ${state.settings.hideClosed && monthData.closed ? "hidden-closed" : ""}`;
        section.dataset.monthId = monthData.id;

        const rows = [];
        for (let day = 1; day <= monthData.endDay; day++) {
          const dayLabel = getDayLabel(day, monthData.month, monthData.year);
          const weekend = dayLabel === "Cmt" || dayLabel === "Paz";
          const hasAnyDeadline = dayHasAnyVisibleDeadline(monthData.id, day);
          rows.push(`
            <tr class="${weekend ? "weekend" : ""} ${hasAnyDeadline ? "day-has-deadline" : ""}">
              <td class="date-cell ${hasAnyDeadline ? "has-deadline-day" : ""}">${formatDate(day, monthData.month, monthData.year)}<span class="day">${dayLabel}</span></td>
              ${firms.map(firm => renderCell(monthData.id, day, firm)).join("")}
            </tr>
          `);
        }

        const bulkOpen = shrinkOpenAttr(`${monthData.id}:bulk`, false);
        const importOpen = shrinkOpenAttr(`${monthData.id}:import`, false);
        const statsOpen = shrinkOpenAttr(`${monthData.id}:stats`, true);
        const tableOpen = shrinkOpenAttr(`${monthData.id}:table`, true);
        const isManagerMode = (state.settings.roleMode || "manager") === "manager";
        const bulkToolbarHtml = isManagerMode ? `
            <details class="shrink-subsection" data-shrink-key="${monthData.id}:bulk" ${bulkOpen}>
              <summary>Toplu Proje Tipi</summary>
              <div class="bulk-toolbar">
                <div class="bulk-title">
                  <strong>Toplu proje tipi</strong>
                  <span>Bu ayın tamamını veya tek bir firmayı hızlıca Video / Statik yap.</span>
                </div>
                <div class="bulk-actions">
                  <button class="small blue" data-action="bulk-month-type" data-month="${monthData.id}" data-value="Video">Tüm Ayı Video Yap</button>
                  <button class="small orange" data-action="bulk-month-type" data-month="${monthData.id}" data-value="Statik">Tüm Ayı Statik Yap</button>
                </div>
              </div>
            </details>
        ` : "";

        section.innerHTML = `
          <div class="month-header">
            <div class="month-title">
              <h2>${monthLabel(monthData)}</h2>
              <span class="badge">01-${String(monthData.endDay).padStart(2, "0")}</span>
              ${monthData.closed ? `<span class="badge">Kapalı</span>` : `<span class="badge">Açık</span>`}
            </div>
            <div class="month-actions">
              <button class="small" data-action="collapse" data-month="${monthData.id}">${monthData.collapsed ? "Aç" : "Daralt"}</button>
              <button class="small" data-action="close" data-month="${monthData.id}">${monthData.closed ? "Ayı Geri Aç" : "Ayı Kapat"}</button>
              <button class="small" data-action="remove" data-month="${monthData.id}">Sil</button>
            </div>
          </div>
          <div class="month-body ${monthData.collapsed ? "collapsed" : ""}">
            ${bulkToolbarHtml}
            <details class="shrink-subsection" data-shrink-key="${monthData.id}:import" ${importOpen}>
              <summary>Excel / Numbers Yükleme</summary>
              <div class="import-panel">
              <div class="import-title">
                <div>
                  <strong>Excel / Numbers ile deadline doldur</strong><br>
                  <span>Excel, CSV veya Apple Numbers dosyası yükle. Dosyadaki TARİH / PLATFORM / KATEGORİ / KONU / DURUM / NOT formatı okunur; satırlar tamamlandı değil deadline olarak işlenir.</span>
                </div>
                <span class="badge">Marka bazlı yükleme</span>
              </div>
              <div class="upload-grid">
                ${firms.map(firm => `
                  <label class="upload-btn">
                    ${firm} Dosya Yükle
                    <input type="file" accept=".xlsx,.xls,.xlsm,.xlsb,.csv,.numbers" data-action="excel-import" data-month="${monthData.id}" data-firm="${firm}">
                  </label>
                `).join("")}
              </div>
                <div class="import-result" id="${monthData.id}-import-result">Henüz dosya yüklenmedi.</div>
              </div>
            </details>
            <details class="shrink-subsection" data-shrink-key="${monthData.id}:stats" ${statsOpen}>
              <summary>Marka İstatistikleri</summary>
              <div class="month-stats">
              ${firms.map(firm => `
                <div class="mini-card">
                  ${firm}
                  <span id="${monthData.id}-${firm}-count">Toplam 0 • Video 0 • Statik 0</span>
                  ${isManagerMode ? `
                    <div class="mini-actions">
                      <button class="tiny ghost" data-action="bulk-firm-type" data-month="${monthData.id}" data-firm="${firm}" data-value="Video">Firma Video</button>
                      <button class="tiny ghost" data-action="bulk-firm-type" data-month="${monthData.id}" data-firm="${firm}" data-value="Statik">Firma Statik</button>
                    </div>
                  ` : ""}
                </div>
              `).join("")}
              </div>
            </details>
            <details class="shrink-subsection table-shrink" data-shrink-key="${monthData.id}:table" ${tableOpen}>
              <summary>Takvim Tablosu</summary>
              <div class="table-wrap">
                <table aria-label="${monthLabel(monthData)} içerik planı tablosu">
                <thead>
                  <tr>
                    <th style="width:132px;">Tarih</th>
                    ${firms.map(firm => `<th>${firm}</th>`).join("")}
                  </tr>
                </thead>
                <tbody>${rows.join("")}</tbody>
                </table>
              </div>
            </details>
          </div>
        `;
        container.appendChild(section);
      });

      updateTotals();
      applyTypeFilter();
      applyStaticShrinkState();
    }

    function renderCell(monthId, day, firm) {
      const cell = getCell(monthId, day, firm);
      const key = cellKey(monthId, day, firm);
      const safeNote = escapeHtml(cell.note);
      const typeClass = cell.projectType === "Video" ? "video-type" : "static-type";

      if (!cell.deadline) {
        return `
          <td class="firm-cell empty-slot" data-cell="${key}" data-project-type="${cell.projectType}" data-has-project="${cell.hasProject ? "true" : "false"}" data-deadline="false" data-has-note="${cell.note ? "true" : "false"}" aria-label="${firm} ${day}. gün boş"></td>
        `;
      }

      return `
        <td class="firm-cell deadline ${cell.hasProject ? "has-project" : ""}" data-cell="${key}" data-project-type="${cell.projectType}" data-has-project="${cell.hasProject ? "true" : "false"}" data-deadline="true" data-has-note="${cell.note ? "true" : "false"}">
          <div class="deadline-card">
            <div class="toprow">
              <label class="checkline">
                <input type="checkbox" data-type="hasProject" data-key="${key}" ${cell.hasProject ? "checked" : ""}>
                <span>Tamamlandı</span>
              </label>
              <label class="checkline deadline-toggle">
                <input type="checkbox" data-type="deadline" data-key="${key}" ${cell.deadline ? "checked" : ""}>
                <span>Deadline</span>
              </label>
            </div>
            <div class="type-row">
              <span>Tip</span>
              <select class="type-select ${typeClass}" data-type="projectType" data-key="${key}">
                ${projectTypes.map(type => `<option value="${type}" ${cell.projectType === type ? "selected" : ""}>${type}</option>`).join("")}
              </select>
            </div>
            <textarea class="idea" data-type="note" data-key="${key}" placeholder="Konu / not">${safeNote}</textarea>
          </div>
        </td>
      `;
    }

    function updateTotals() {
      const totals = Object.fromEntries(firms.map(f => [f, { total: 0, Video: 0, Statik: 0 }]));

      state.months.forEach(monthData => {
        const monthCounts = Object.fromEntries(firms.map(f => [f, { completed: 0, deadline: 0, Video: 0, Statik: 0 }]));
        const endDay = daysInMonth(monthData.year, monthData.month);

        for (let day = 1; day <= endDay; day++) {
          firms.forEach(firm => {
            const cell = getCell(monthData.id, day, firm);
            if (!modeAllowsProjectType(cell.projectType)) return;
            if (cell.deadline) {
              monthCounts[firm].deadline++;
              monthCounts[firm][cell.projectType]++;
            }
            if (cell.hasProject) {
              monthCounts[firm].completed++;
              if (!monthData.closed) {
                totals[firm].total++;
                totals[firm][cell.projectType]++;
              }
            }
          });
        }

        firms.forEach(firm => {
          const el = document.getElementById(`${monthData.id}-${firm}-count`);
          if (el) el.textContent = `Tamamlandı ${monthCounts[firm].completed} • Deadline ${monthCounts[firm].deadline} • Video ${monthCounts[firm].Video} • Statik ${monthCounts[firm].Statik}`;
        });
      });

      firms.forEach(firm => {
        document.getElementById(`total-${firm}`).textContent = totals[firm].total;
        document.getElementById(`split-${firm}`).textContent = `Video ${totals[firm].Video} • Statik ${totals[firm].Statik}`;
      });

      renderDeadlineRadar();
    }

    function addMonth(value) {
      if (!value) return alert("Önce bir ay seç.");
      const [yearText, monthText] = value.split("-");
      const year = Number(yearText);
      const month = Number(monthText);
      const id = `${yearText}-${monthText}`;
      const existing = state.months.find(m => m.id === id);
      if (existing) {
        existing.startDay = 1;
        existing.endDay = daysInMonth(year, month);
        existing.collapsed = false;
        existing.closed = false;
        saveState();
        render();
        return;
      }
      state.months.push({ id, year, month, startDay: 1, endDay: daysInMonth(year, month), collapsed: false, closed: false });
      saveState();
      render();
    }

    function setMonthType(monthId, value) {
      const monthData = state.months.find(m => m.id === monthId);
      if (!monthData || !projectTypes.includes(value)) return;
      const endDay = daysInMonth(monthData.year, monthData.month);
      for (let day = 1; day <= endDay; day++) {
        firms.forEach(firm => {
          const key = cellKey(monthId, day, firm);
          const cell = getCell(monthId, day, firm);
          cell.projectType = value;
          state.cells[key] = cell;
        });
      }
      saveState();
      render();
    }

    function setFirmType(monthId, firm, value) {
      const monthData = state.months.find(m => m.id === monthId);
      if (!monthData || !firms.includes(firm) || !projectTypes.includes(value)) return;
      const endDay = daysInMonth(monthData.year, monthData.month);
      for (let day = 1; day <= endDay; day++) {
        const key = cellKey(monthId, day, firm);
        const cell = getCell(monthId, day, firm);
        cell.projectType = value;
        state.cells[key] = cell;
      }
      saveState();
      render();
    }


    function applyTypeFilter() {
      const filter = state.settings.filterType || "all";
      const mode = getActiveModeConfig();
      const activeModeType = mode.projectType;
      const shouldFilter = filter !== "all" || !!activeModeType;

      document.querySelectorAll("tbody tr").forEach(row => {
        row.querySelectorAll(".firm-cell").forEach(cell => {
          const hasContent = cell.dataset.hasProject === "true" || cell.dataset.deadline === "true" || cell.dataset.hasNote === "true";

          // Boş hücreler her zaman görünür kalmalı. Aksi halde dosya yükleme veya rol filtresi
          // sonrası yalnızca içerik olan günler görünür ve ayın boş günleri kaybolmuş gibi durur.
          const matchesTypeFilter = filter === "all" || !hasContent || cell.dataset.projectType === filter;
          const matchesMode = !activeModeType || !hasContent || cell.dataset.projectType === activeModeType;
          const matches = matchesTypeFilter && matchesMode;

          cell.classList.toggle("filtered-out", shouldFilter && hasContent && !matches);
        });

        // Gün satırlarını filtreyle gizleme; ay 01'den son güne kadar her zaman tam kalsın.
        row.classList.remove("filter-hidden");
      });
    }

    function setImportResult(monthId, message, status = "ok") {
      const el = document.getElementById(`${monthId}-import-result`);
      if (!el) return;
      el.textContent = message;
      el.className = `import-result ${status}`;
    }

    async function handleFirmPlanUpload(file, monthId, firm) {
      if (!file) return;
      const monthData = state.months.find(m => m.id === monthId);
      if (!monthData || !firms.includes(firm)) return;

      try {
        setImportResult(monthId, `${firm}: Dosya taranıyor…`, "warn");
        const detected = await detectPlanItemsFromFile(file, monthData);

        if (!detected.size) {
          setImportResult(monthId, `${firm}: İçerik bulunamadı. Dosyada TARİH / GÜN / PLATFORM / KATEGORİ / KONU formatı veya tarih + içerik satırları görünür olmalı.`, "warn");
          return;
        }

        if (state.settings.clearBeforeImport !== false) {
          clearFirmMonth(monthId, firm);
        }

        let videoCount = 0;
        let staticCount = 0;
        let deadlineCount = 0;

        detected.forEach((entry, day) => {
          const key = cellKey(monthId, day, firm);
          const cell = getCell(monthId, day, firm);
          const type = entry.projectType || (entry.hasVideo ? "Video" : "Statik");

          // Dosyadan gelen satırlar plan/deadline bilgisidir; tamamlandı kutusunu asla otomatik işaretleme.
          cell.deadline = true;
          cell.projectType = type;
          cell.note = Array.from(entry.notes || []).filter(Boolean).join(" | ").slice(0, 320);

          if (type === "Video") videoCount++; else staticCount++;
          deadlineCount++;
          state.cells[key] = cell;
        });

        saveState();
        render();
        const sheetText = detected._sheetInfo ? ` • Sayfa: ${detected._sheetInfo}` : "";
        setImportResult(monthId, `${firm}: ${deadlineCount} deadline eklendi. Video ${videoCount} • Statik ${staticCount}${sheetText}. Tamamlandı kutuları işaretlenmedi.`, "ok");
      } catch (err) {
        setImportResult(monthId, `${firm}: Dosya okunamadı. Excel / CSV / Numbers dosyasını daha sade bir tablo olarak kaydetmeyi dene. Detay: ${err.message || "bilinmeyen hata"}`, "error");
      }
    }

    function clearFirmMonth(monthId, firm) {
      const monthData = state.months.find(m => m.id === monthId);
      if (!monthData) return;
      const endDay = daysInMonth(monthData.year, monthData.month);
      for (let day = 1; day <= endDay; day++) {
        state.cells[cellKey(monthId, day, firm)] = { hasProject: false, projectType: "Video", deadline: false, note: "" };
      }
    }

    function ensureXlsxLibrary() {
      if (typeof XLSX !== "undefined") return Promise.resolve();
      if (xlsxLoaderPromise) return xlsxLoaderPromise;
      xlsxLoaderPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("Tablo okuma kütüphanesi yüklenemedi."));
        document.head.appendChild(script);
        setTimeout(() => {
          if (typeof XLSX === "undefined") reject(new Error("Tablo okuma kütüphanesi zaman aşımına uğradı."));
        }, 12000);
      });
      return xlsxLoaderPromise;
    }

    async function detectPlanItemsFromFile(file, monthData) {
      const ext = file.name.split(".").pop().toLowerCase();
      const sheets = [];
      const sheetMeta = [];

      if (ext === "csv") {
        const text = await file.text();
        sheets.push(parseCsv(text));
        sheetMeta.push({ name: file.name.replace(/\.[^.]+$/, ""), index: 0, source: "csv" });
      } else {
        await ensureXlsxLibrary();
        if (typeof XLSX === "undefined") {
          throw new Error("Tablo okuma kütüphanesi yüklenemedi.");
        }

        const data = await file.arrayBuffer();
        let workbook;
        try {
          workbook = XLSX.read(data, { type: "array", cellDates: true, cellNF: true, cellText: false });
        } catch (err) {
          throw new Error("Bu dosya formatı okunamadı.");
        }

        const chosenSheetNames = chooseWorkbookSheetsForImport(workbook, monthData, ext);
        chosenSheetNames.forEach(name => {
          const sheet = workbook.Sheets[name];
          if (!sheet) return;
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "", blankrows: false });
          sheets.push(rows);
          sheetMeta.push({ name, index: workbook.SheetNames.indexOf(name), source: ext });
        });
      }

      const detected = new Map();
      sheets.forEach(rows => scanRowsForPlanItems(rows, monthData, detected));
      detected._sheetInfo = sheetMeta.map(item => item.name).join(", ");
      return detected;
    }

    function chooseWorkbookSheetsForImport(workbook, monthData, ext) {
      const primary = chooseWorkbookSheets(workbook, monthData);

      // Numbers dosyalarında SheetJS bazen tek bir sayfayı/tabloyu eksik döndürebiliyor.
      // Bu yüzden önce doğru ay sayfasını, sonra kalan tabloları da tarıyoruz. Tarih filtresi seçili ay dışında kalanları zaten eliyor.
      if (ext === "numbers") {
        return Array.from(new Set([...(primary || []), ...(workbook.SheetNames || [])]));
      }

      return primary;
    }

    function chooseWorkbookSheets(workbook, monthData) {
      const names = workbook.SheetNames || [];
      if (!names.length) return [];

      const targetMonth = monthData.month;
      const targetYear = monthData.year;
      const scored = names.map((name, index) => {
        const scoreInfo = scoreSheetForMonth(name, targetMonth, targetYear);
        return { name, index, ...scoreInfo };
      });

      // 1) En güvenli tercih: seçili ay / yıl ile doğrudan eşleşen sayfa.
      const exactMatches = scored.filter(s => s.exact);
      if (exactMatches.length) {
        exactMatches.sort((a, b) => b.score - a.score || b.index - a.index);
        return [exactMatches[0].name];
      }

      // 2) Sayfa adlarında ay bilgisi varsa listedeki en güncel ayı al.
      const monthNamed = scored.filter(s => s.monthNumber);
      if (monthNamed.length) {
        monthNamed.sort((a, b) => {
          const ay = a.yearNumber || targetYear;
          const by = b.yearNumber || targetYear;
          if (by !== ay) return by - ay;
          if (b.monthNumber !== a.monthNumber) return b.monthNumber - a.monthNumber;
          return b.index - a.index;
        });
        return [monthNamed[0].name];
      }

      // 3) Ay ismi yoksa en sondaki sayfayı taramak en mantıklı varsayım.
      return [names[names.length - 1]];
    }

    function scoreSheetForMonth(sheetName, targetMonth, targetYear) {
      const search = toSearchText(sheetName);
      const monthMap = {
        ocak:1, subat:2, şubat:2, feb:2, february:2,
        mart:3, march:3, mar:3, nisan:4, april:4, apr:4,
        mayis:5, mayıs:5, may:5, haziran:6, june:6, jun:6,
        temmuz:7, july:7, jul:7, agustos:8, ağustos:8, august:8, aug:8,
        eylul:9, eylül:9, september:9, sep:9,
        ekim:10, october:10, oct:10,
        kasim:11, kasım:11, november:11, nov:11,
        aralik:12, aralık:12, december:12, dec:12
      };

      let monthNumber = null;
      let score = 0;
      Object.entries(monthMap).forEach(([word, num]) => {
        if (new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`, "i").test(search)) {
          monthNumber = num;
          score += 10;
        }
      });

      const numericMonthMatches = [...search.matchAll(/(?:^|\D)([01]?\d)(?:\D|$)/g)]
        .map(m => Number(m[1]))
        .filter(n => n >= 1 && n <= 12);
      if (!monthNumber && numericMonthMatches.length) {
        const preferred = numericMonthMatches.includes(targetMonth) ? targetMonth : numericMonthMatches[numericMonthMatches.length - 1];
        monthNumber = preferred;
        score += 4;
      }

      const yearMatch = search.match(/20\d{2}/);
      const yearNumber = yearMatch ? Number(yearMatch[0]) : null;
      const exact = monthNumber === targetMonth && (!yearNumber || yearNumber === targetYear);
      if (exact) score += 100;
      if (yearNumber === targetYear) score += 20;
      return { monthNumber, yearNumber, exact, score };
    }

    function parseCsv(text) {
      const rows = [];
      let row = [];
      let cell = "";
      let quote = false;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const next = text[i + 1];
        if (ch === '"' && quote && next === '"') { cell += '"'; i++; continue; }
        if (ch === '"') { quote = !quote; continue; }
        if (ch === "," && !quote) { row.push(cell); cell = ""; continue; }
        if ((ch === "\n" || ch === "\r") && !quote) {
          if (ch === "\r" && next === "\n") i++;
          row.push(cell); rows.push(row); row = []; cell = ""; continue;
        }
        cell += ch;
      }
      row.push(cell); rows.push(row);
      return rows;
    }

    function scanRowsForPlanItems(rows, monthData, detected) {
      // Önce gerçek takvim formatını yakala: TARİH / GÜN / PLATFORM / KATEGORİ / KONU / DURUM / NOT.
      // Bu format bulunursa fallback tarama yapılmaz; böylece başlıklar veya boş hücreler yanlış eşleşmez.
      const structuredCount = scanStructuredPlanRows(rows, monthData, detected);
      if (structuredCount > 0) return;

      rows.forEach(row => {
        const cells = row.map(value => normalizeText(value)).filter(Boolean);
        if (!cells.length) return;

        // Hücre bazlı fallback: takvim hücresi içinde “08.07 Reels…” gibi içerikler.
        cells.forEach(cellText => {
          const days = extractDaysFromText(cellText, monthData, true);
          days.forEach(day => registerDetectedItem(detected, day, cellText, monthData));
        });

        // Satır bazlı fallback: bir hücrede tarih, yan hücrelerde içerik varsa.
        const daysInRow = new Set();
        cells.forEach(cellText => extractDaysFromText(cellText, monthData, false).forEach(day => daysInRow.add(day)));
        if (daysInRow.size && daysInRow.size <= 3) {
          const rowText = cells.join(" | ");
          daysInRow.forEach(day => registerDetectedItem(detected, day, rowText, monthData));
        }
      });
    }

    function scanStructuredPlanRows(rows, monthData, detected) {
      const header = findPlanHeader(rows);
      if (!header) return 0;

      let count = 0;
      for (let r = header.rowIndex + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const day = dateValueToDay(row[header.date], monthData);
        if (!day) continue;

        const platform = normalizeText(row[header.platform]);
        const category = normalizeText(row[header.category]);
        const topic = normalizeText(row[header.topic]);
        const status = normalizeText(row[header.status]);
        const extraNote = normalizeText(row[header.note]);

        if (!category && !topic && !extraNote) continue;

        const type = projectTypeFromCategory(category, topic);
        const note = buildStructuredPlanNote({ platform, category, topic, status, extraNote });
        registerDeadlinePlanItem(detected, day, note, type);
        count++;
      }
      return count;
    }

    function findPlanHeader(rows) {
      for (let r = 0; r < Math.min(rows.length, 12); r++) {
        const normalized = (rows[r] || []).map(value => normalizeHeaderText(value));
        const date = normalized.findIndex(h => h === "tarih" || h.startsWith("tarih") || h.includes("teslimtarihi") || h.includes("deadlinetarihi"));
        const topic = normalized.findIndex(h => h === "konu" || h.startsWith("konu") || h.includes("baslik") || h.includes("icerikfikri") || h.includes("icerikkonusu"));
        const category = normalized.findIndex(h => h === "kategori" || h.startsWith("kategor") || h.includes("format") || h === "tur" || h === "tip");
        const platform = normalized.findIndex(h => h === "platform" || h.startsWith("platform") || h.includes("kanal"));
        const status = normalized.findIndex(h => h === "durum" || h.startsWith("durum") || h.includes("status"));
        const note = normalized.findIndex(h => h === "not" || h === "notlar" || h.startsWith("not") || h.includes("aciklama"));

        if (date >= 0 && (topic >= 0 || category >= 0)) {
          return { rowIndex: r, date, topic, category, platform, status, note };
        }
      }
      return null;
    }

    function normalizeHeaderText(value) {
      return toSearchText(value).replace(/[^a-z0-9]+/g, "");
    }

    function dateValueToDay(value, monthData) {
      if (value == null || value === "") return null;

      if (value instanceof Date && !isNaN(value)) {
        const day = value.getDate();
        const month = value.getMonth() + 1;
        const year = value.getFullYear();
        return month === monthData.month && year === monthData.year ? day : null;
      }

      if (typeof value === "number" && isFinite(value)) {
        return excelSerialToDay(value, monthData);
      }

      const text = normalizeText(value);
      const numeric = Number(text.replace(",", "."));
      if (/^\d+(?:[.,]\d+)?$/.test(text) && numeric > 30000) {
        return excelSerialToDay(numeric, monthData);
      }

      const monthFirstDay = extractMonthFirstSlashDate(text, monthData);
      if (monthFirstDay) return monthFirstDay;

      const days = extractDaysFromText(text, monthData, true);
      return days.size ? Array.from(days)[0] : null;
    }

    function extractMonthFirstSlashDate(text, monthData) {
      // SheetJS bazı Numbers/Excel tarihlerini, raw:false durumunda 7/3/26 gibi ABD formatında döndürebiliyor.
      // Bu yüzden sadece slash kullanılan ve ilk sayı seçili aya eşit olan tarihleri month/day/year olarak yorumluyoruz.
      const search = normalizeText(text);
      const match = search.match(/^\s*([01]?\d)\/([0-3]?\d)\/(\d{2}|20\d{2})\s*$/);
      if (!match) return null;
      const month = Number(match[1]);
      const day = Number(match[2]);
      let year = Number(match[3]);
      if (year < 100) year += 2000;
      if (month === monthData.month && year === monthData.year && day >= 1 && day <= daysInMonth(monthData.year, monthData.month)) {
        return day;
      }
      return null;
    }

    function excelSerialToDay(serial, monthData) {
      const wholeDays = Math.floor(Number(serial));
      if (!wholeDays || wholeDays < 30000) return null;
      const date = new Date(Date.UTC(1899, 11, 30) + wholeDays * 86400000);
      const day = date.getUTCDate();
      const month = date.getUTCMonth() + 1;
      const year = date.getUTCFullYear();
      return month === monthData.month && year === monthData.year ? day : null;
    }

    function buildStructuredPlanNote({ platform, category, topic, status, extraNote }) {
      const parts = [];
      if (topic) parts.push(topic);
      else if (category) parts.push(category);
      if (platform) parts.push(`Platform: ${platform}`);
      if (category && topic && !toSearchText(topic).includes(toSearchText(category))) parts.push(`Kategori: ${category}`);
      if (status) parts.push(`Durum: ${status}`);
      if (extraNote) parts.push(`Not: ${extraNote}`);
      return parts.join(" • ");
    }

    function registerDeadlinePlanItem(detected, day, note, projectType) {
      const safeType = projectTypes.includes(projectType) ? projectType : "Statik";
      const entry = detected.get(day) || { hasProject: false, deadline: true, projectType: safeType, hasVideo: false, notes: new Set() };
      entry.deadline = true;
      entry.hasProject = false;

      // Aynı güne birden fazla satır denk gelirse Video öncelikli kalsın; tek satırda kategori neyse onu kullan.
      if (safeType === "Video" || !entry.projectType) entry.projectType = safeType;
      entry.hasVideo = entry.projectType === "Video";

      if (note) entry.notes.add(note);
      detected.set(day, entry);
    }

    function registerDetectedItem(detected, day, text, monthData) {
      if (!day || day < 1 || day > daysInMonth(monthData.year, monthData.month)) return;
      const note = cleanupPlanNote(text, monthData);
      const hasDeadlineWord = /\b(deadline|son\s*teslim|teslim\s*günü|teslim\s*gunu|son\s*gün|son\s*gun)\b/i.test(toSearchText(text));
      const hasReadablePlan = note.length >= 2 && !/^(gün|gun|tarih|deadline|son teslim)$/i.test(note);
      if (!hasReadablePlan && !hasDeadlineWord) return;

      // Fallback taramada kategori başlığı yoksa metinden tahmin ederiz.
      // Başlıklı takvim formatında ise projectTypeFromCategory() zaten KATEGORİ sütununu tek kaynak kabul eder.
      const type = fallbackProjectTypeFromText(text);
      registerDeadlinePlanItem(detected, day, hasReadablePlan ? note : "Deadline", type);
    }

    function projectTypeFromCategory(category, fallbackText = "") {
      const categoryText = toSearchText(category);

      // Ana kural: KATEGORİ sütunu tek kaynak.
      // Reels => Video; Story/Post => Statik.
      if (/\b(reels?|reel)\b/.test(categoryText)) return "Video";
      if (/\b(story|stories|post|static|statik|gorsel|görsel)\b/.test(categoryText)) return "Statik";

      // Kategori dolu ama tanımsızsa güvenli varsayım Statik. Konu metni burada Video'ya çevirmemeli.
      if (categoryText) return "Statik";

      return fallbackProjectTypeFromText(fallbackText);
    }

    function fallbackProjectTypeFromText(text) {
      const search = toSearchText(text);
      if (/\b(reels?|reel|video|shorts?|tik\s*tok|tiktok|kamera|çekim|cekim)\b/i.test(search)) return "Video";
      return "Statik";
    }

    function normalizeText(value) {
      if (value == null) return "";
      if (value instanceof Date && !isNaN(value)) {
        return `${String(value.getDate()).padStart(2, "0")}.${String(value.getMonth() + 1).padStart(2, "0")}.${value.getFullYear()}`;
      }
      if (typeof value === "object") {
        if (value.text != null) value = value.text;
        else if (value.w != null) value = value.w;
        else if (value.v != null) value = value.v;
      }
      return String(value).replace(/\s+/g, " ").trim();
    }

    function toSearchText(value) {
      return normalizeText(value)
        .toLocaleLowerCase("tr-TR")
        .replaceAll("ı", "i")
        .replaceAll("ş", "s")
        .replaceAll("ğ", "g")
        .replaceAll("ü", "u")
        .replaceAll("ö", "o")
        .replaceAll("ç", "c");
    }

    function extractDaysFromText(text, monthData, allowStandaloneStartNumber) {
      const days = new Set();
      const search = toSearchText(text);
      const currentMonth = monthData.month;
      const currentYear = monthData.year;

      let match;
      const dmy = /(?:^|\D)([0-3]?\d)[.\/\-\s]([01]?\d)(?:[.\/\-\s](20\d{2}))?(?=\D|$)/g;
      while ((match = dmy.exec(search))) {
        const day = Number(match[1]);
        const month = Number(match[2]);
        const year = match[3] ? Number(match[3]) : currentYear;
        if (month === currentMonth && year === currentYear && day >= 1 && day <= daysInMonth(currentYear, currentMonth)) days.add(day);
      }

      const ymd = /(20\d{2})[.\/\-]([01]?\d)[.\/\-]([0-3]?\d)/g;
      while ((match = ymd.exec(search))) {
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (month === currentMonth && year === currentYear && day >= 1 && day <= daysInMonth(currentYear, currentMonth)) days.add(day);
      }

      const monthWords = "ocak|subat|şubat|mart|nisan|mayis|mayıs|haziran|temmuz|agustos|ağustos|eylul|eylül|ekim|kasim|kasım|aralik|aralık";
      const monthWordToNum = { ocak:1, subat:2, şubat:2, mart:3, nisan:4, mayis:5, mayıs:5, haziran:6, temmuz:7, agustos:8, ağustos:8, eylul:9, eylül:9, ekim:10, kasim:11, kasım:11, aralik:12, aralık:12 };
      const dmWord = new RegExp(`(?:^|\\D)([0-3]?\\d)\\s*(${monthWords})(?=\\D|$)`, "g");
      while ((match = dmWord.exec(search))) {
        const day = Number(match[1]);
        const month = monthWordToNum[match[2]];
        if (month === currentMonth && day >= 1 && day <= daysInMonth(currentYear, currentMonth)) days.add(day);
      }

      if (!days.size && allowStandaloneStartNumber) {
        const start = search.match(/^\s*([0-3]?\d)(?:\s|[.)\-–—:]|$)/);
        if (start) {
          const day = Number(start[1]);
          if (day >= 1 && day <= daysInMonth(currentYear, currentMonth)) days.add(day);
        }
      }

      return days;
    }

    function cleanupPlanNote(text, monthData) {
      let cleaned = normalizeText(text);
      const monthRegex = String(monthData.month).padStart(2, "0") + "|" + monthData.month;
      cleaned = cleaned
        .replace(new RegExp(`\\b[0-3]?\\d[.\\/\\-\\s](?:${monthRegex})(?:[.\\/\\-\\s]20\\d{2})?\\b`, "gi"), " ")
        .replace(/\b20\d{2}[.\/\-][01]?\d[.\/\-][0-3]?\d\b/g, " ")
        .replace(/\b(pazartesi|salı|sali|çarşamba|carsamba|perşembe|persembe|cuma|cumartesi|pazar|pzt|sal|çar|car|per|cum|cmt|paz)\b/gi, " ")
        .replace(/\b(ocak|şubat|subat|mart|nisan|mayıs|mayis|haziran|temmuz|ağustos|agustos|eylül|eylul|ekim|kasım|kasim|aralık|aralik)\b/gi, " ")
        .replace(/\b(tarih|gün|gun|hafta|ay|içerik|icerik)\b/gi, " ")
        .replace(/^[\s\d.)\-–—:|/]+/, "")
        .replace(/[|]{2,}/g, "|")
        .replace(/\s{2,}/g, " ")
        .trim();

      if (/^[\d\s.)\-–—:|/]+$/.test(cleaned)) return "";
      return cleaned;
    }

    function getTodayDate() {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    function makeLocalDate(monthData, day, hour = 0, minute = 0) {
      return new Date(monthData.year, monthData.month - 1, day, hour, minute, 0);
    }

    function dateDiffInDays(a, b) {
      const start = new Date(a.getFullYear(), a.getMonth(), a.getDate());
      const end = new Date(b.getFullYear(), b.getMonth(), b.getDate());
      return Math.round((start - end) / 86400000);
    }

    function collectDeadlineItems(options = {}) {
      const includeCompleted = !!options.includeCompleted;
      const includeClosed = !!options.includeClosed;
      const ignoreRoleMode = !!options.ignoreRoleMode;
      const today = getTodayDate();
      const items = [];

      state.months.forEach(monthData => {
        if (!includeClosed && monthData.closed) return;
        const endDay = daysInMonth(monthData.year, monthData.month);

        for (let day = 1; day <= endDay; day++) {
          firms.forEach(firm => {
            const key = cellKey(monthData.id, day, firm);
            const cell = getCell(monthData.id, day, firm);
            if (!cell.deadline) return;
            if (!includeCompleted && cell.hasProject) return;
            if (!ignoreRoleMode && !modeAllowsProjectType(cell.projectType)) return;

            const date = makeLocalDate(monthData, day);
            items.push({
              key,
              firm,
              day,
              date,
              monthId: monthData.id,
              monthData,
              projectType: cell.projectType,
              note: cell.note || "",
              completed: !!cell.hasProject,
              closed: !!monthData.closed,
              daysDiff: dateDiffInDays(date, today)
            });
          });
        }
      });

      items.sort((a, b) => a.date - b.date || a.firm.localeCompare(b.firm, "tr") || a.projectType.localeCompare(b.projectType, "tr"));
      return items;
    }

    function renderDeadlineRadar() {
      const radar = document.getElementById("deadlineRadar");
      if (!radar) return;

      const items = collectDeadlineItems({ includeCompleted: false, includeClosed: false });
      const overdue = items.filter(item => item.daysDiff < 0);
      const today = items.filter(item => item.daysDiff === 0);
      const tomorrow = items.filter(item => item.daysDiff === 1);
      const nextSeven = items.filter(item => item.daysDiff > 1 && item.daysDiff <= 7);
      const future = items.filter(item => item.daysDiff >= 0);

      const notifyState = getNotificationButtonLabel();
      const mode = getActiveModeConfig();
      const warningHtml = overdue.length
        ? `<div class="radar-warning">${overdue.length} deadline gecikmiş görünüyor. Bunlar takvim export’una geçmiş tarih olarak eklenmez; önce planı yakalayıp tamamlandı işaretlemek daha doğru.</div>`
        : "";

      radar.innerHTML = `
        <div class="radar-header">
          <div class="radar-title">
            <strong>Deadline Radar</strong>
            <span><b>${mode.label} modu:</b> ${mode.description} Tamamlandı işaretlenen işler radar listesinden düşer. Bildirim izni açıksa site açıkken 09:00 / 12:00 / 15:00 hatırlatır.</span>
          </div>
          <div class="radar-actions">
            <button class="small" type="button" id="radarCalendarBtn">Takvime Aktar (.ics)</button>
            <button class="small" type="button" id="radarNotifyBtn">${notifyState}</button>
            <button class="small blue" type="button" id="radarTestNotifyBtn">Test / Önizleme</button>
          </div>
        </div>
        <div class="radar-body">
          <div class="radar-strip">
            <div class="radar-stat overdue">Gecikmiş<span>${overdue.length}</span></div>
            <div class="radar-stat today">Bugün<span>${today.length}</span></div>
            <div class="radar-stat tomorrow">Yarın<span>${tomorrow.length}</span></div>
            <div class="radar-stat all">Gelecek<span>${future.length}</span></div>
          </div>
          <div class="radar-grid">
            ${renderRadarColumn("Gecikmiş", overdue.slice().reverse(), "overdue")}
            ${renderRadarColumn("Bugün", today, "today")}
            ${renderRadarColumn("Yarın", tomorrow, "tomorrow")}
            ${renderRadarColumn("7 Gün İçinde", nextSeven, "upcoming")}
          </div>
          ${warningHtml}
        </div>
      `;

    }

    function renderRadarColumn(title, items, tone) {
      if (!items.length) {
        return `<div class="radar-column"><h3>${title}</h3><div class="radar-empty">Kayıt yok.</div></div>`;
      }

      return `
        <div class="radar-column">
          <h3>${title}</h3>
          <div class="radar-list">
            ${items.map(item => renderRadarItem(item, tone)).join("")}
          </div>
        </div>
      `;
    }

    function renderRadarItem(item, tone) {
      const typeClass = item.projectType === "Video" ? "video" : "static";
      const note = item.note ? escapeHtml(item.note) : "Not girilmemiş.";
      const dateLabel = formatDate(item.day, item.monthData.month, item.monthData.year);
      return `
        <div class="radar-item ${typeClass} ${tone === "overdue" ? "overdue" : ""} ${tone === "today" ? "today" : ""}">
          <div class="radar-item-head">
            <span>${escapeHtml(item.firm)}</span>
            <span class="pill ${item.projectType === "Video" ? "video" : "static"}">${item.projectType}</span>
          </div>
          <div class="radar-item-note">${note}</div>
          <div class="radar-meta">
            <span class="radar-date">${dateLabel} • ${getDayLabel(item.day, item.monthData.month, item.monthData.year)}</span>
            <button class="tiny ghost" data-action="go-to-cell" data-key="${escapeHtml(item.key)}" type="button">Hücreye git</button>
          </div>
        </div>
      `;
    }

    function primeReminderAudio() {
      try {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return false;
        if (!reminderAudioContext) reminderAudioContext = new AudioCtor();
        if (reminderAudioContext.state === "suspended") reminderAudioContext.resume();
        reminderAudioUnlocked = reminderAudioContext.state === "running";
        return reminderAudioUnlocked;
      } catch (err) {
        return false;
      }
    }

    function playReminderChime() {
      try {
        if (!primeReminderAudio()) return false;
        const ctx = reminderAudioContext;
        const now = ctx.currentTime;
        const notes = [880, 1174, 880];
        notes.forEach((freq, index) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, now + index * 0.22);
          gain.gain.exponentialRampToValueAtTime(0.085, now + index * 0.22 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.22 + 0.18);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + index * 0.22);
          osc.stop(now + index * 0.22 + 0.20);
        });
        return true;
      } catch (err) {
        return false;
      }
    }

    function stopTitleAttention() {
      if (titleFlashTimer) {
        clearInterval(titleFlashTimer);
        titleFlashTimer = null;
      }
      document.title = baseDocumentTitle;
    }

    function flashTitleAttention(title) {
      stopTitleAttention();
      let visible = false;
      let loops = 0;
      titleFlashTimer = setInterval(() => {
        if (document.visibilityState === "visible" && document.hasFocus()) {
          stopTitleAttention();
          return;
        }
        document.title = visible ? baseDocumentTitle : `🔔 ${title}`;
        visible = !visible;
        loops += 1;
        if (loops >= 40) stopTitleAttention();
      }, 1200);
    }

    function getNotificationAvailability() {
      if (!("Notification" in window)) {
        return { ok: false, reason: "Bu tarayıcı masaüstü bildirimi desteklemiyor." };
      }

      const protocol = window.location.protocol;
      const host = window.location.hostname;
      const isLocalhost = host === "localhost" || host === "127.0.0.1" || host === "::1";

      if (protocol === "file:") {
        return {
          ok: false,
          reason: "Bu dosya doğrudan HTML olarak açıldığı için tarayıcı sistem bildirimi izin penceresini engelleyebilir. Gerçek masaüstü bildirimi için dosyayı localhost veya HTTPS üzerinden açmak gerekir."
        };
      }

      if (!window.isSecureContext && !isLocalhost) {
        return {
          ok: false,
          reason: "Tarayıcı sistem bildirimleri güvenli bağlantı ister. Dosyayı HTTPS veya localhost üzerinden açmak gerekir."
        };
      }

      return { ok: true, reason: "" };
    }

    function getNotificationButtonLabel() {
      const availability = getNotificationAvailability();
      if (!availability.ok) return "Bildirim için localhost gerekli";
      if (Notification.permission === "granted") return "Bildirim Açık 09/12/15";
      if (Notification.permission === "denied") return "Bildirim Kapalı";
      return "Bildirim İzni Ver";
    }

    function getDeadlineNotificationPayload(force = false, slotKey = null) {
      const now = new Date();
      const activeSlot = slotKey ? reminderSlots.find(slot => slot.key === slotKey) : getActiveReminderSlot(now);
      const mode = getActiveModeConfig();
      const items = collectDeadlineItems({ includeCompleted: false, includeClosed: false });
      const overdue = items.filter(item => item.daysDiff < 0);
      const today = items.filter(item => item.daysDiff === 0);
      const tomorrow = items.filter(item => item.daysDiff === 1);
      const urgent = [...overdue, ...today, ...tomorrow];
      const label = force ? "Test" : (activeSlot ? activeSlot.label : "Hatırlatma");

      if (!urgent.length) {
        return {
          hasItems: false,
          title: "Deadline Radar",
          body: `${mode.label} modunda bugün, yarın veya gecikmiş açık deadline görünmüyor.`,
          slot: activeSlot,
          mode
        };
      }

      const firstItems = urgent.slice(0, 4).map(item => {
        const status = item.daysDiff < 0 ? "gecikmiş" : (item.daysDiff === 0 ? "bugün" : "yarın");
        return `${item.firm} ${item.projectType} (${status})`;
      }).join(", ");

      return {
        hasItems: true,
        title: `Deadline hatırlatması ${label}`,
        body: `${mode.label}: ${overdue.length} gecikmiş • ${today.length} bugün • ${tomorrow.length} yarın. ${firstItems}${urgent.length > 4 ? "…" : ""}`,
        slot: activeSlot,
        mode
      };
    }

    function isEditableTarget(target) {
      return !!target?.closest?.('input, textarea, select, option, button, a, [contenteditable="true"]');
    }

    function showProtectionNotice(message = "Bu sayfada temel telif koruması aktif.") {
      showInAppNotification("İçerik koruması", message, "warn", 4200);
    }

    function showInAppNotification(title, body, tone = "ok", autoCloseMs = 9000) {
      let stack = document.getElementById("notificationToastStack");
      if (!stack) {
        stack = document.createElement("div");
        stack.id = "notificationToastStack";
        stack.className = "notification-toast-stack";
        document.body.appendChild(stack);
      }

      const toast = document.createElement("div");
      toast.className = `notification-toast ${tone}`;
      toast.innerHTML = `
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(body)}</span>
        <button type="button">Kapat</button>
      `;
      const close = () => toast.remove();
      toast.querySelector("button").addEventListener("click", close);
      toast.addEventListener("click", () => {
        try { window.focus(); } catch (err) {}
      });
      stack.appendChild(toast);

      if (autoCloseMs) {
        setTimeout(() => {
          if (toast.isConnected) close();
        }, autoCloseMs);
      }
    }

    function fireSystemNotification(title, body) {
      try {
        const notification = new Notification(title, { body, requireInteraction: true, silent: true });
        notification.onclick = () => {
          try {
            window.focus();
          } catch (err) {}
          stopTitleAttention();
        };
        return true;
      } catch (err) {
        showInAppNotification("Sistem bildirimi gönderilemedi", err.message || "Tarayıcı bildirimi engelledi.", "error", 12000);
        return false;
      }
    }

    async function requestBrowserNotifications() {
      const availability = getNotificationAvailability();
      if (!availability.ok) {
        state.settings.notificationsEnabled = false;
        saveState();
        showInAppNotification("Bildirim izni açılamadı", `${availability.reason}\n\nŞimdilik uygulama içi önizleme gösteriyorum. Gerçek bildirim için terminalde dosya klasöründe: python3 -m http.server 8000 ve sonra http://localhost:8000 adresinden aç.`, "warn", 16000);
        sendDeadlineNotification(true, null, { inAppOnly: true });
        renderDeadlineRadar();
        return;
      }

      if (Notification.permission === "denied") {
        state.settings.notificationsEnabled = false;
        saveState();
        showInAppNotification("Bildirim izni kapalı", "Tarayıcı site ayarlarında bildirim izni engellenmiş. Kilit/site ayarları menüsünden bildirimleri Allow yapman gerekir. Takvim aktarımı yine çalışır.", "warn", 14000);
        renderDeadlineRadar();
        return;
      }

      const permission = Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();

      if (permission === "granted") {
        state.settings.notificationsEnabled = true;
        primeReminderAudio();
        saveState();
        showInAppNotification("Bildirimler aktif", "Sistem bildirimi açıldı. Hatırlatma geldiğinde sesli uyarı ve sekmeye dönmeni kolaylaştıran başlık flaşı çalışacak. Tarayıcı güvenliği nedeniyle sekmeyi otomatik öne getiremez; bildirime tıklayınca odaklanır.", "ok", 10000);
        sendDeadlineNotification(true);
        scheduleDeadlineNotifications();
        renderDeadlineRadar();
      } else {
        state.settings.notificationsEnabled = false;
        saveState();
        showInAppNotification("Bildirim izni verilmedi", "Tarayıcı sistem bildirimi için izin verilmedi. Testi uygulama içinde gösteriyorum; .ics takvim aktarımı en güvenilir yöntem olmaya devam ediyor.", "warn", 12000);
        sendDeadlineNotification(true, null, { inAppOnly: true });
        renderDeadlineRadar();
      }
    }

    async function testDeadlineNotification() {
      const payload = getDeadlineNotificationPayload(true);

      // Test / Önizleme her zaman uygulama içinde görünmeli.
      // Sistem bildirimi çalışmasa bile kullanıcı feedback almalı.
      showInAppNotification(
        `Önizleme: ${payload.title}`,
        payload.body,
        payload.hasItems ? "ok" : "warn",
        14000
      );

      const availability = getNotificationAvailability();

      // Sistem bildirimi desteklenmiyorsa burada dur. Önizleme zaten gösterildi.
      if (!availability.ok) {
        return;
      }

      // Kullanıcı tarayıcı bildirimini daha önce engellediyse yine burada dur.
      if (Notification.permission === "denied") {
        return;
      }

      // İzin verilmemişse test butonunda izin iste.
      const permission = Notification.permission === "granted"
        ? "granted"
        : await Notification.requestPermission();

      if (permission !== "granted") {
        return;
      }

      state.settings.notificationsEnabled = true;
      primeReminderAudio();
      saveState();

      // Sistem bildirimi ayrıca denensin ama uygulama içi önizleme buna bağlı olmasın.
      playReminderChime();
      flashTitleAttention(payload.title);
      fireSystemNotification(payload.title, payload.body);

      scheduleDeadlineNotifications();
      renderDeadlineRadar();
    }

    function sendDeadlineNotification(force = false, slotKey = null, options = {}) {
      if (!force && !state.settings.notificationsEnabled) return;

      const now = new Date();
      const todayKey = getLocalDateKey(now);
      const activeSlot = slotKey ? reminderSlots.find(slot => slot.key === slotKey) : getActiveReminderSlot(now);
      const activeSlotKey = activeSlot ? `${state.settings.roleMode || "manager"}:${activeSlot.key}` : null;

      if (!force) {
        if (!activeSlot) return;
        if (!state.settings.lastNotifySlots || typeof state.settings.lastNotifySlots !== "object") state.settings.lastNotifySlots = {};
        const sentSlots = state.settings.lastNotifySlots[todayKey] || [];
        if (sentSlots.includes(activeSlotKey)) return;
      }

      const payload = getDeadlineNotificationPayload(force, slotKey);

      if (!payload.hasItems && !force) {
        if (activeSlot && activeSlotKey) markReminderSlotSent(todayKey, activeSlotKey);
        return;
      }

      if (payload.hasItems) {
        playReminderChime();
        flashTitleAttention(payload.title);
      }

      const availability = getNotificationAvailability();
      const canUseSystem = !options.inAppOnly && availability.ok && ("Notification" in window) && Notification.permission === "granted";
      const sentSystem = canUseSystem ? fireSystemNotification(payload.title, payload.body) : false;

      if (!sentSystem) {
        showInAppNotification(payload.title, payload.body, payload.hasItems ? "ok" : "warn");
      }

      if (!force && activeSlot && activeSlotKey) markReminderSlotSent(todayKey, activeSlotKey);
      state.settings.lastNotifyDate = todayKey;
      saveState();
    }

    function getLocalDateKey(date = new Date()) {
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    function getActiveReminderSlot(date = new Date()) {
      return reminderSlots.find(slot => date.getHours() === slot.hour && date.getMinutes() >= slot.minute && date.getMinutes() < slot.minute + 15) || null;
    }

    function markReminderSlotSent(dayKey, slotKey) {
      if (!state.settings.lastNotifySlots || typeof state.settings.lastNotifySlots !== "object") state.settings.lastNotifySlots = {};
      const keepKeys = Object.keys(state.settings.lastNotifySlots).filter(key => key === dayKey);
      const compacted = {};
      keepKeys.forEach(key => { compacted[key] = state.settings.lastNotifySlots[key]; });
      state.settings.lastNotifySlots = compacted;
      const sentSlots = new Set(state.settings.lastNotifySlots[dayKey] || []);
      sentSlots.add(slotKey);
      state.settings.lastNotifySlots[dayKey] = Array.from(sentSlots);
      saveState();
    }

    function getNextReminderDate(slot, from = new Date()) {
      const next = new Date(from.getFullYear(), from.getMonth(), from.getDate(), slot.hour, slot.minute, 0, 0);
      if (next <= from) next.setDate(next.getDate() + 1);
      return next;
    }

    function scheduleDeadlineNotifications() {
      reminderTimerHandles.forEach(timer => clearTimeout(timer));
      reminderTimerHandles = [];

      if (reminderFallbackInterval) {
        clearInterval(reminderFallbackInterval);
        reminderFallbackInterval = null;
      }

      const availability = getNotificationAvailability();
      if (!availability.ok || !("Notification" in window) || Notification.permission !== "granted" || !state.settings.notificationsEnabled) return;

      reminderSlots.forEach(slot => {
        const next = getNextReminderDate(slot);
        const delay = Math.max(1000, next.getTime() - Date.now());
        const timer = setTimeout(() => {
          sendDeadlineNotification(false, slot.key);
          scheduleDeadlineNotifications();
        }, delay);
        reminderTimerHandles.push(timer);
      });

      reminderFallbackInterval = setInterval(() => {
        const activeSlot = getActiveReminderSlot(new Date());
        if (activeSlot) sendDeadlineNotification(false, activeSlot.key);
      }, 60000);
    }

    function exportDeadlineCalendar() {
      const mode = getActiveModeConfig();
      const items = collectDeadlineItems({ includeCompleted: false, includeClosed: false })
        .filter(item => item.daysDiff >= 0);

      if (!items.length) {
        alert(`${mode.label} modunda takvime aktarılacak bugünden sonraki tamamlanmamış deadline yok.`);
        return;
      }

      const lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Fion Medya//Aylik Icerik Planlayici//TR",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Fion Deadline Takvimi"
      ];

      items.forEach(item => {
        const start = makeLocalDate(item.monthData, item.day, 15, 0);
        const end = makeLocalDate(item.monthData, item.day, 15, 30);
        const summary = `${item.firm} ${item.projectType} Deadline`;
        const description = [
          `Mod: ${mode.label}`,
          `Marka: ${item.firm}`,
          `Tip: ${item.projectType}`,
          `Tarih: ${formatDate(item.day, item.monthData.month, item.monthData.year)}`,
          item.note ? `Not: ${item.note}` : "Not: -",
          "Kaynak: Aylık İçerik Planlayıcı"
        ].join("\\n");

        lines.push(
          "BEGIN:VEVENT",
          `UID:${escapeIcsText(item.key)}-${item.projectType.toLowerCase()}@fion-video-planner`,
          `DTSTAMP:${formatIcsDateTime(new Date())}`,
          `DTSTART:${formatIcsDateTime(start)}`,
          `DTEND:${formatIcsDateTime(end)}`,
          `SUMMARY:${escapeIcsText(summary)}`,
          `DESCRIPTION:${escapeIcsText(description)}`,
          `CATEGORIES:${escapeIcsText(`FION,DEADLINE,${item.firm},${item.projectType}`)}`,
          "BEGIN:VALARM",
          "TRIGGER:-PT6H",
          "ACTION:DISPLAY",
          `DESCRIPTION:${escapeIcsText(`09:00 deadline hatırlatması: ${summary}`)}`,
          "END:VALARM",
          "BEGIN:VALARM",
          "TRIGGER:-PT3H",
          "ACTION:DISPLAY",
          `DESCRIPTION:${escapeIcsText(`12:00 deadline hatırlatması: ${summary}`)}`,
          "END:VALARM",
          "BEGIN:VALARM",
          "TRIGGER:-PT0M",
          "ACTION:DISPLAY",
          `DESCRIPTION:${escapeIcsText(`15:00 deadline hatırlatması: ${summary}`)}`,
          "END:VALARM",
          "END:VEVENT"
        );
      });

      lines.push("END:VCALENDAR");
      const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fion-deadline-takvimi-${state.settings.roleMode || "manager"}-${new Date().toISOString().slice(0,10)}.ics`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    function formatIcsDateTime(date) {
      const pad = number => String(number).padStart(2, "0");
      return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
    }

    function escapeIcsText(value) {
      return String(value || "")
        .replace(/\\/g, "\\\\")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,")
        .replace(/\r?\n/g, "\\n");
    }

    function focusPlannerCell(key) {
      const [monthId] = key.split(":");
      const monthData = state.months.find(m => m.id === monthId);
      if (monthData && monthData.collapsed) {
        monthData.collapsed = false;
        saveState();
        render();
      }

      requestAnimationFrame(() => {
        const cell = document.querySelector(`[data-cell="${key}"]`);
        if (!cell) return;
        cell.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        cell.classList.remove("cell-flash");
        void cell.offsetWidth;
        cell.classList.add("cell-flash");
      });
    }

    function exportBackup() {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `icerik-planlayici-yedek-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    function importBackup(file) {
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = JSON.parse(reader.result);
          if (!imported.months || !imported.cells) throw new Error("Geçersiz planlayıcı yedeği.");
          state = imported;
          state.settings = Object.assign({ hideClosed: false, filterType: "all", roleMode: "manager", showModeSettings: false, clearBeforeImport: true, notificationsEnabled: false, lastNotifyDate: "", lastNotifySlots: {}, shrink: {} }, state.settings || {});
          state.months.forEach(month => {
            month.startDay = 1;
            month.endDay = daysInMonth(month.year, month.month);
          });
          Object.keys(state.cells).forEach(key => normalizeCell(state.cells[key]));
          saveState();
          render();
          alert("Planlayıcı yedeği içe aktarıldı.");
        } catch (err) {
          alert("Bu dosya geçerli bir planlayıcı yedeği değil.");
        }
      };
      reader.readAsText(file);
    }


    document.addEventListener("toggle", event => {
      const detail = event.target;
      if (!detail || !detail.matches?.("details[data-shrink-key]")) return;

      if (!state.settings.shrink || typeof state.settings.shrink !== "object") {
        state.settings.shrink = {};
      }

      state.settings.shrink[detail.dataset.shrinkKey] = detail.open;
      saveState();
    }, true);

    document.addEventListener("change", event => {
      const target = event.target;

      if (target.matches('input[type="checkbox"][data-key]')) {
        const cell = getCellFromKey(target.dataset.key);

        if (target.dataset.type === "hasProject") {
          cell.hasProject = target.checked;
          const td = document.querySelector(`[data-cell="${target.dataset.key}"]`);
          if (td) {
            td.classList.toggle("has-project", target.checked);
            td.dataset.hasProject = target.checked ? "true" : "false";
          }
        }

        if (target.dataset.type === "deadline") {
          cell.deadline = target.checked;
          const td = document.querySelector(`[data-cell="${target.dataset.key}"]`);
          if (td) {
            td.classList.toggle("deadline", target.checked);
            td.dataset.deadline = target.checked ? "true" : "false";
          }
        }

        state.cells[target.dataset.key] = cell;
        saveState();
        updateTotals();
        renderDeadlineRadar();
        render();
        return;
      }

      if (target.matches('select[data-type="projectType"][data-key]')) {
        const cell = getCellFromKey(target.dataset.key);
        cell.projectType = target.value;
        target.classList.toggle("video-type", target.value === "Video");
        target.classList.toggle("static-type", target.value === "Statik");
        const td = document.querySelector(`[data-cell="${target.dataset.key}"]`);
        if (td) td.dataset.projectType = target.value;
        state.cells[target.dataset.key] = cell;
        saveState();
        updateTotals();
        renderDeadlineRadar();
        render();
        return;
      }

      if (target.id === "hideClosed") {
        state.settings.hideClosed = target.checked;
        saveState();
        render();
      }

      if (target.id === "typeFilter") {
        if (target.disabled) return;
        state.settings.filterType = target.value;
        saveState();
        render();
      }

      if (target.id === "roleMode") {
        state.settings.roleMode = roleModes[target.value] ? target.value : "manager";
        const mode = getActiveModeConfig();
        state.settings.filterType = mode.projectType || "all";
        saveState();

        // Mod değişince bazı alanlar DOM'dan tamamen kalkmalı / geri gelmeli.
        // Bu yüzden partial update değil, tam render gerekli.
        render();
        scheduleDeadlineNotifications();
        return;
      }

      if (target.id === "clearBeforeImport") {
        state.settings.clearBeforeImport = target.checked;
        saveState();
      }

      if (target.matches('input[type="file"][data-action="excel-import"]')) {
        handleFirmPlanUpload(target.files[0], target.dataset.month, target.dataset.firm);
        target.value = "";
      }
    });

    document.addEventListener("input", event => {
      const target = event.target;
      if (target.matches('textarea[data-key]')) {
        const cell = getCellFromKey(target.dataset.key);
        cell.note = target.value;
        const td = document.querySelector(`[data-cell="${target.dataset.key}"]`);
        if (td) td.dataset.hasNote = target.value.trim() ? "true" : "false";
        state.cells[target.dataset.key] = cell;
        saveState();
        renderDeadlineRadar();
        applyTypeFilter();
      }
    });

    function getCellFromKey(key) {
      const existing = state.cells[key] || { hasProject: false, projectType: "Video", deadline: false, note: "" };
      return normalizeCell(existing);
    }

    document.addEventListener("click", event => {
      if (event.target.closest("#radarTestNotifyBtn")) {
        primeReminderAudio();
        testDeadlineNotification();
        return;
      }

      if (event.target.closest("#radarNotifyBtn")) {
        primeReminderAudio();
        requestBrowserNotifications();
        return;
      }

      if (event.target.closest("#radarCalendarBtn")) {
        exportDeadlineCalendar();
        return;
      }

      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const action = button.dataset.action;

      if (action === "go-to-cell") {
        focusPlannerCell(button.dataset.key);
        return;
      }

      if (action === "bulk-month-type") {
        if ((state.settings.roleMode || "manager") !== "manager") return;
        setMonthType(button.dataset.month, button.dataset.value);
        return;
      }

      if (action === "bulk-firm-type") {
        if ((state.settings.roleMode || "manager") !== "manager") return;
        setFirmType(button.dataset.month, button.dataset.firm, button.dataset.value);
        return;
      }

      const monthData = state.months.find(m => m.id === button.dataset.month);
      if (!monthData) return;

      if (action === "collapse") {
        monthData.collapsed = !monthData.collapsed;
      }

      if (action === "close") {
        monthData.closed = !monthData.closed;
        monthData.collapsed = monthData.closed;
      }

      if (action === "remove") {
        if (!confirm(`${monthLabel(monthData)} silinsin mi? Bu aya ait kayıtlar da silinir.`)) return;
        const prefix = `${monthData.id}:`;
        state.months = state.months.filter(m => m.id !== monthData.id);
        Object.keys(state.cells).forEach(key => {
          if (key.startsWith(prefix)) delete state.cells[key];
        });
      }

      saveState();
      render();
    });

    document.addEventListener("contextmenu", event => {
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      showProtectionNotice("Sağ tık menüsü devre dışı bırakıldı. Bu arayüz Görkem Serin tarafından hazırlanmıştır.");
    });

    document.addEventListener("dragstart", event => {
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
    });

    document.addEventListener("keydown", event => {
      const key = String(event.key || "").toLowerCase();
      const mod = event.ctrlKey || event.metaKey;
      const devtoolsBlocked = key === "f12" || (event.ctrlKey && event.shiftKey && ["i", "j", "c"].includes(key));
      const blockedShortcut = mod && ["u", "s"].includes(key);
      if (!devtoolsBlocked && !blockedShortcut) return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      showProtectionNotice("Kaynak görüntüleme / kayıt kısayolları bu sayfada sınırlandırıldı.");
    });

    document.getElementById("addMonthBtn").addEventListener("click", () => addMonth(document.getElementById("monthInput").value));
    document.getElementById("exportCalendarBtn").addEventListener("click", exportDeadlineCalendar);
    window.addEventListener("focus", stopTitleAttention);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") stopTitleAttention();
    });

    document.getElementById("notifyBtn").addEventListener("click", () => { primeReminderAudio(); requestBrowserNotifications(); });
    document.getElementById("testNotifyBtn").addEventListener("click", () => { primeReminderAudio(); testDeadlineNotification(); });
    document.getElementById("exportBtn").addEventListener("click", exportBackup);
    document.getElementById("importBtn").addEventListener("click", () => document.getElementById("importFile").click());
    document.getElementById("importFile").addEventListener("change", event => importBackup(event.target.files[0]));
    document.getElementById("modeSettings").addEventListener("toggle", event => {
      state.settings.showModeSettings = event.target.open;
      saveState();
    });
    document.getElementById("resetBtn").addEventListener("click", () => {
      if (!confirm("Tüm planlayıcı sıfırlansın mı? Bu işlem tüm ayları, işaretleri, deadline’ları ve notları temizler.")) return;
      state = defaultState();
      saveState();
      render();
    });

    const today = new Date();
    document.getElementById("monthInput").value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

    saveState();
    render();
    scheduleDeadlineNotifications();
