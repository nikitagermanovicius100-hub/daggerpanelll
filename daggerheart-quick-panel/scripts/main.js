import { DaggerheartQuickPanelBase } from "./panel-base.js";
import { MODULE_ID, TEMPLATE, ITEM_PARTIAL, STRESS_OVERFLOW_PATCH, TRAITS, ITEM_TYPE_ORDER, HUD_THEMES, HUD_PLACEMENTS, HUD_LANGUAGES, localize, clamp, asArray, escapeHTML, changePaths, installStressOverflowCostRule, plainText, hasRussianDaggerheartTranslation } from "./helpers.js";

class DaggerheartQuickPanel extends DaggerheartQuickPanelBase {
  applyPlacement() {
    if (!this.root) return;
    const selected = game.settings.get(MODULE_ID, "hudPlacement") === "side" ? "side" : "center";
    this.root.dataset.placement = selected;
    for (const button of this.root.querySelectorAll('[data-action="set-placement"]')) {
      const active = button.dataset.placement === selected;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    this.positionHud();
  }

  async loadLanguage(language) {
    if (this.languageCache.has(language)) return this.languageCache.get(language);
    const response = await fetch(`modules/${MODULE_ID}/lang/${language}.json`);
    if (!response.ok) throw new Error(`Unable to load ${language}.json (${response.status})`);
    const dictionary = (await response.json())?.DQP;
    if (!dictionary) throw new Error(`Language ${language}.json has no DQP namespace`);
    this.languageCache.set(language, dictionary);
    return dictionary;
  }

  async applyLanguage(render = true) {
    const selected = game.settings.get(MODULE_ID, "hudLanguage") || "auto";
    const automaticRussian = String(game.i18n.lang || "").toLowerCase().startsWith("ru") || hasRussianDaggerheartTranslation();
    const language = selected === "auto" ? (automaticRussian ? "ru" : "en") : selected;

    try {
      const dictionary = await this.loadLanguage(language);
      game.i18n.translations ||= {};
      game.i18n.translations.DQP = foundry.utils.deepClone?.(dictionary) ?? structuredClone(dictionary);
      this.activeLanguage = language;
      if (render && this.root) this.scheduleRender(0);
      return true;
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to apply HUD language`, error);
      return false;
    }
  }

  async chooseActorForHud(actors) {
    if (actors.length < 2) return actors[0] || null;
    const selectedId = this.actor?.id;
    const options = actors.map((actor) =>
      `<option value="${escapeHTML(actor.id)}"${actor.id === selectedId ? " selected" : ""}>${escapeHTML(actor.name)}</option>`
    ).join("");
    const actorId = await foundry.applications.api.DialogV2.prompt({
      window: { title: localize("DQP.Hud.ChooseTitle") },
      classes: ["dqp-actor-choice-dialog"],
      position: { width: 360 },
      content: `<div class="dqp-actor-choice"><label for="dqp-hud-actor">${escapeHTML(localize("DQP.Hud.ChooseHint"))}</label><select id="dqp-hud-actor" name="actorId">${options}</select></div>`,
      ok: {
        type: "submit",
        label: localize("DQP.Hud.Enable"),
        icon: "fa-solid fa-eye",
        callback: (_event, button) => button.form.elements.actorId?.value || null,
      },
      rejectClose: false,
    });
    return actors.find((actor) => actor.id === actorId) || null;
  }

  async toggleHud(target) {
    return this.withLock("hud-toggle", target, async () => {
      if (this.open) {
        await game.settings.set(MODULE_ID, "hudEnabled", false);
        return this.render();
      }

      return this.enableHud();
    });
  }

  async enableHud() {
    if (this.open) return this.render();
    const actors = this.actors;
    const actor = await this.chooseActorForHud(actors);
    if (actors.length > 1 && !actor) return;
    if (actor) await game.settings.set(MODULE_ID, "selectedActorId", actor.id);
    await game.settings.set(MODULE_ID, "hudEnabled", true);
    return this.render();
  }

  cancelScaleHide() {
    window.clearTimeout(this.scaleHideTimer);
    this.scaleHideTimer = null;
    this.root?.querySelector(".dqp-scale-controls")?.classList.remove("is-hiding");
  }

  scheduleScaleHide(delay = 1000) {
    this.cancelScaleHide();
    this.scaleHideTimer = window.setTimeout(() => this.hideScaleControls(true), delay);
  }

  hideScaleControls(animate = false) {
    this.cancelScaleHide();
    const controls = this.root?.querySelector(".dqp-scale-controls");
    this.root?.querySelector('[data-action="toggle-scale"]')?.setAttribute("aria-expanded", "false");
    if (!controls) return;
    if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      controls.hidden = true;
      return;
    }
    controls.classList.add("is-hiding");
    this.scaleHideTimer = window.setTimeout(() => {
      controls.hidden = true;
      controls.classList.remove("is-hiding");
      this.scaleHideTimer = null;
    }, 180);
  }

  cancelThemeHide() {
    window.clearTimeout(this.themeHideTimer);
    this.themeHideTimer = null;
    this.root?.querySelector(".dqp-theme-controls")?.classList.remove("is-hiding");
  }

  scheduleThemeHide(delay = 1000) {
    this.cancelThemeHide();
    this.themeHideTimer = window.setTimeout(() => this.hideThemeControls(true), delay);
  }

  hideThemeControls(animate = false) {
    this.cancelThemeHide();
    const controls = this.root?.querySelector(".dqp-theme-controls");
    this.root?.querySelector('[data-action="toggle-theme"]')?.setAttribute("aria-expanded", "false");
    if (!controls) return;
    if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      controls.hidden = true;
      return;
    }
    controls.classList.add("is-hiding");
    this.themeHideTimer = window.setTimeout(() => {
      controls.hidden = true;
      controls.classList.remove("is-hiding");
      this.themeHideTimer = null;
    }, 180);
  }

  async toggleEquip(actor, target, event) {
    if (!actor.isOwner) return ui.notifications.warn(localize("DQP.Warnings.NoPermission"));
    const item = actor.items.get(target.dataset.itemId);
    if (!item || !["weapon", "armor"].includes(item.type)) return;
    const sheet = actor.sheet;
    const action = sheet.options?.actions?.toggleEquipItem;
    const handler = typeof action === "function" ? action : action?.handler;
    if (!handler) return ui.notifications.warn(localize("DQP.Gear.EquipUnavailable"));
    return this.withLock(`equip:${actor.id}`, target, async () => {
      await handler.call(sheet, event, target);
      this.scheduleRender();
    });
  }

  async onChange(event) {
    if (!event.target.matches('[data-action="select-actor"]')) return;
    const actor = this.actors.find((candidate) => candidate.id === event.target.value);
    if (!actor) return this.render();
    this.hidePreview();
    await game.settings.set(MODULE_ID, "selectedActorId", actor.id);
    this.collapsedGroups = new Set();
    return this.render();
  }

  async showExperience(actor, target) {
    if (!actor.isOwner) return ui.notifications.warn(localize("DQP.Warnings.NoPermission"));
    const id = target.dataset.previewExperience;
    const experience = actor.system.experiences?.[id];
    if (!experience) return;
    return this.withLock(`experience-share:${actor.id}:${id}`, target, async () => {
      const name = experience.name || localize("DQP.Experiences.Unnamed");
      const value = Number(experience.value) || 0;
      const card = document.createElement("article");
      card.className = "dqp-experience-detail";
      const heading = document.createElement("h3");
      heading.textContent = `${name} ${value >= 0 ? "+" : ""}${value}`;
      const description = document.createElement("div");
      description.className = "dqp-experience-description";
      description.textContent = plainText(experience.description, Infinity) || localize("DQP.Actions.NoDescription");
      card.append(heading, description);
      const question = document.createElement("p");
      question.className = "dqp-experience-question";
      question.textContent = localize("DQP.Experiences.ShareQuestion");
      const send = await foundry.applications.api.DialogV2.confirm({
        window: { title: localize("DQP.Experiences.Title") },
        classes: ["dqp-experience-dialog"],
        position: { width: 390 },
        content: card.outerHTML + question.outerHTML,
        yes: { label: localize("DQP.Experiences.Share") },
        no: { label: localize("DQP.Experiences.Close") },
        defaultYes: false,
        rejectClose: false,
      });
      if (!send) return;
      if (!this.actors.some((candidate) => candidate.id === actor.id)) return ui.notifications.warn(localize("DQP.Warnings.NoPermission"));
      const Chat = CONFIG.ChatMessage.documentClass;
      await Chat.create({ speaker: Chat.getSpeaker({ actor }), content: card.outerHTML });
    });
  }

  onHover(event) {
    if (event.target.closest?.(".dqp-scale-wrap")) this.cancelScaleHide();
    if (event.target.closest?.(".dqp-theme-wrap")) this.cancelThemeHide();
    if (event.target.closest?.(".dqp-hover-card")) { window.clearTimeout(this.previewTimer); return; }
    const anchor = event.target.closest?.("[data-preview-item], [data-preview-experience]");
    if (!anchor || !this.root.contains(anchor)) return;
    window.clearTimeout(this.previewTimer);
    if (this.previewAnchor === anchor) return;
    this.hidePreview();
    this.previewTimer = window.setTimeout(() => this.showPreview(anchor), 220);
  }

  onHoverLeave(event) {
    const scaleWrap = event.target.closest?.(".dqp-scale-wrap");
    if (scaleWrap && !scaleWrap.contains(event.relatedTarget)) this.scheduleScaleHide();
    const themeWrap = event.target.closest?.(".dqp-theme-wrap");
    if (themeWrap && !themeWrap.contains(event.relatedTarget)) this.scheduleThemeHide();
    const anchor = event.target.closest?.("[data-preview-item], [data-preview-experience], .dqp-hover-card");
    if (!anchor || anchor.contains(event.relatedTarget)) return;
    if (this.preview?.contains(event.relatedTarget) || this.previewAnchor?.contains(event.relatedTarget)) return;
    window.clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(() => this.hidePreview(), 150);
  }

  hidePreview() {
    window.clearTimeout(this.previewTimer);
    this.previewAnchor?.removeAttribute("aria-describedby");
    this.preview?.remove();
    this.preview = null;
    this.previewAnchor = null;
  }

  showPreview(anchor) {
    if (!anchor.isConnected || !this.actor) return;
    const item = this.actor.items.get(anchor.dataset.previewItem);
    const experience = this.actor.system.experiences?.[anchor.dataset.previewExperience];
    if (!item && !experience) return;
    this.hidePreview();
    const view = item ? this.itemData(item, this.actor) : null;
    const card = document.createElement("aside");
    card.id = "dqp-hover-card";
    card.className = "dqp-hover-card";
    card.setAttribute("role", "tooltip");
    card.tabIndex = 0;
    const title = document.createElement("strong");
    title.textContent = item?.name || experience.name || localize("DQP.Experiences.Unnamed");
    const meta = document.createElement("small");
    meta.textContent = view?.meta || `${localize("DQP.Experiences.Title")} · ${Number(experience?.value) >= 0 ? "+" : ""}${experience?.value ?? 0}`;
    const description = document.createElement("div");
    const itemDescription = item?.system.description || asArray(item?.system.actionsList).map((action) => action.description).filter(Boolean).join("\n\n");
    description.textContent = plainText(item ? itemDescription : experience.description, Infinity) || localize("DQP.Actions.NoDescription");
    card.append(title, meta);
    if (view?.costPreview) {
      const cost = document.createElement("div");
      cost.className = "dqp-hover-cost";
      cost.textContent = view.costPreview;
      card.append(cost);
    }
    card.append(description);
    const safeLeft = this.hudBounds?.left ?? 8;
    const safeRight = this.hudBounds?.right ?? window.innerWidth - 8;
    card.style.maxWidth = `${Math.max(1, safeRight - safeLeft)}px`;
    this.root.append(card);
    this.preview = card;
    this.previewAnchor = anchor;
    anchor.setAttribute("aria-describedby", card.id);
    const bounds = anchor.getBoundingClientRect();
    const size = card.getBoundingClientRect();
    card.style.left = `${Math.max(safeLeft, Math.min(bounds.left, safeRight - size.width))}px`;
    const hudTop = this.root.querySelector(".dqp-shell")?.getBoundingClientRect().top ?? bounds.top;
    card.style.top = `${Math.max(8, Math.min(bounds.top, hudTop) - size.height - 8)}px`;
  }

  onContextMenu(event) {
    const row = event.target.closest(".dqp-item-row");
    if (!row) return;
    event.preventDefault();
    this.actor?.items.get(row.dataset.itemId)?.sheet.render({ force: true });
  }

  loadoutHasRoom(actor, item) {
    if (!item?.system.inVault) return true;
    const used = actor.items.filter((candidate) => candidate.type === "domainCard" && !candidate.system.inVault).length;
    return used < this.loadoutLimit(actor) || Boolean(item.system.loadoutIgnore);
  }

  clearDropHighlights() {
    this.root?.querySelectorAll(".is-drop-target, .is-drop-invalid").forEach((element) =>
      element.classList.remove("is-drop-target", "is-drop-invalid"));
  }

  onDragStart(event) {
    const row = event.target.closest?.(".dqp-item-row[draggable='true']");
    const actor = this.actor;
    const item = actor?.items.get(row?.dataset.itemId);
    if (!row || !actor?.isOwner || item?.type !== "domainCard") {
      event.preventDefault();
      return;
    }
    this.dragState = { actorId: actor.id, itemId: item.id, fromVault: Boolean(item.system.inVault) };
    event.dataTransfer?.setData("text/plain", JSON.stringify({ module: MODULE_ID, ...this.dragState }));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    requestAnimationFrame(() => row.classList.add("is-dragging"));
  }

  onDragEnd() {
    this.root?.querySelectorAll(".is-dragging").forEach((row) => row.classList.remove("is-dragging"));
    this.clearDropHighlights();
    this.dragState = null;
  }

  onDragOver(event) {
    const group = event.target.closest?.("[data-drop-target]");
    const state = this.dragState;
    if (!group || !state || state.actorId !== this.actor?.id) return;
    const toVault = group.dataset.dropTarget === "vault";
    if (toVault === state.fromVault) return;
    event.preventDefault();
    const item = this.actor.items.get(state.itemId);
    const valid = toVault || this.loadoutHasRoom(this.actor, item);
    this.clearDropHighlights();
    group.classList.add(valid ? "is-drop-target" : "is-drop-invalid");
    if (event.dataTransfer) event.dataTransfer.dropEffect = valid ? "move" : "none";
  }

  onDragLeave(event) {
    const group = event.target.closest?.("[data-drop-target]");
    if (group && !group.contains(event.relatedTarget)) group.classList.remove("is-drop-target", "is-drop-invalid");
  }

  async onDrop(event) {
    const group = event.target.closest?.("[data-drop-target]");
    const state = this.dragState;
    if (!group || !state || state.actorId !== this.actor?.id) return;
    event.preventDefault();
    const actor = this.actor;
    const item = actor.items.get(state.itemId);
    const toVault = group.dataset.dropTarget === "vault";
    this.clearDropHighlights();
    if (!item || toVault === Boolean(item.system.inVault)) return;
    if (!toVault && !this.loadoutHasRoom(actor, item)) {
      return ui.notifications.warn(localize("DQP.Warnings.LoadoutFull", { max: this.loadoutLimit(actor) }));
    }
    await this.toggleVault(actor, item.id, event, group, toVault);
    this.dragState = null;
  }

  animateElement(element, className, duration = 520) {
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    window.setTimeout(() => element.classList.remove(className), duration);
  }

  patchResource(actor, key) {
    const path = key === "armor" ? "system.armorScore.value" : `system.resources.${key}.value`;
    const labelKey = key === "hitPoints" ? "HitPoints" : key[0].toUpperCase() + key.slice(1);
    const icon = { hitPoints: "fa-solid fa-heart-crack", stress: "fa-solid fa-bolt", hope: "fa-solid fa-diamond", armor: "fa-solid fa-shield-halved" }[key];
    const override = key === "armor" ? actor.system.armorScore : undefined;
    const view = this.resourceData(actor, key, path, `DQP.Resources.${labelKey}`, icon, override);
    const container = key === "armor"
      ? this.root?.querySelector(".dqp-armor-slots")
      : this.root?.querySelector(`.dqp-resource--${key}`);
    if (!container) return false;
    const pips = [...container.querySelectorAll(".dqp-pip")];
    if (pips.length !== view.max) return false;
    const output = key === "armor" ? container.querySelector(":scope > span") : container.querySelector(".dqp-resource-label strong");
    if (output) output.textContent = `${view.value}/${view.max}`;
    for (const [index, pip] of pips.entries()) {
      const wasActive = pip.classList.contains("is-active");
      const isActive = index < view.value;
      pip.classList.toggle("is-active", isActive);
      pip.setAttribute("aria-pressed", String(isActive));
      if (wasActive !== isActive) this.animateElement(pip, isActive ? "is-marked" : "is-cleared");
    }
    return true;
  }

  refreshCostPreviews(actor = this.actor) {
    if (!actor) return;
    for (const row of this.root?.querySelectorAll(".dqp-item-row") || []) {
      const item = actor.items.get(row.dataset.itemId);
      if (item) this.applyItemView(row, this.itemData(item, actor));
    }
  }

  patchActorUpdate(actor, changes) {
    if (!this.open || actor.id !== this.actor?.id) return false;
    const paths = changePaths(changes);
    if (!paths.length) return false;
    const resourcePaths = {
      "system.resources.hitPoints.value": "hitPoints",
      "system.resources.stress.value": "stress",
      "system.resources.hope.value": "hope",
      "system.armorScore.value": "armor",
    };
    if (!paths.every((path) => resourcePaths[path])) return false;
    const keys = [...new Set(paths.map((path) => resourcePaths[path]))];
    const patched = keys.every((key) => this.patchResource(actor, key));
    if (patched) this.refreshCostPreviews(actor);
    return patched;
  }

  applyItemView(row, view) {
    row.dataset.vaultState = view.inVault ? "vault" : "loadout";
    row.classList.toggle("is-equipped", view.equipped);
    const primary = row.querySelector(".dqp-item-use");
    if (primary) {
      primary.dataset.action = view.primaryAction;
      primary.setAttribute("aria-label", view.primaryLabel);
      primary.querySelector(".dqp-item-copy strong").textContent = view.name;
      primary.querySelector(".dqp-item-copy > span").textContent = view.meta;
      const image = primary.querySelector("img");
      if (image) image.src = view.img;
      let resource = primary.querySelector(".dqp-item-resource");
      if (view.resource && !resource) {
        resource = document.createElement("span");
        resource.className = "dqp-item-resource";
        primary.append(resource);
      }
      if (resource) {
        resource.textContent = view.resource;
        resource.hidden = !view.resource;
      }
      let cost = primary.querySelector(".dqp-item-cost");
      if (view.costShort && !cost) {
        cost = document.createElement("span");
        cost.className = "dqp-item-cost";
        primary.append(cost);
      }
      if (cost) {
        cost.textContent = view.costShort;
        cost.dataset.tooltip = view.costPreview;
        cost.hidden = !view.costShort;
      }
      const playIcon = primary.querySelector(".dqp-item-play");
      if (playIcon) playIcon.className = `${view.primaryIcon} dqp-item-play`;
    }
    const vault = row.querySelector(".dqp-item-vault");
    if (vault) {
      vault.setAttribute("aria-label", view.vaultLabel);
      vault.dataset.tooltip = view.vaultTooltip;
      const icon = vault.querySelector("i");
      if (icon) icon.className = view.vaultIcon;
    }
    const equip = row.querySelector(".dqp-item-equip");
    if (equip) {
      equip.classList.toggle("is-active", view.equipped);
      equip.setAttribute("aria-pressed", String(view.equipped));
      equip.setAttribute("aria-label", view.equipLabel);
      equip.dataset.tooltip = view.equipLabel;
    }
  }

  updateLoadoutCounts(actor) {
    const loadout = this.root?.querySelector('[data-group-key="play-loadout"]');
    const vault = this.root?.querySelector('[data-group-key="play-vault"]');
    for (const group of [loadout, vault]) {
      if (!group) continue;
      const items = group.querySelector(".dqp-inline-items");
      const count = items?.querySelectorAll(".dqp-item-row").length || 0;
      let empty = items?.querySelector(".dqp-group-empty");
      if (!count && !empty) {
        empty = document.createElement("span");
        empty.className = "dqp-group-empty";
        empty.textContent = localize("DQP.Cards.Empty");
        items?.append(empty);
      } else if (count) empty?.remove();
      const output = group.querySelector(".dqp-inline-group-heading small");
      if (output) output.textContent = group === loadout ? `${count}/${this.loadoutLimit(actor)}` : String(count);
    }
  }

  patchItemUpdate(item, changes = {}) {
    if (!this.open || (item.parent && item.parent.id !== this.actor?.id)) return false;
    const paths = changePaths(changes);
    const vaultChanged = paths.includes("system.inVault");
    if (vaultChanged && this.activeTab === "actions") return false;
    const patchable = ["name", "img", "system.inVault", "system.resource.value", "system.resource.max", "system.quantity"];
    if (paths.length && !paths.every((path) => patchable.includes(path))) return false;
    const rows = [...(this.root?.querySelectorAll(`.dqp-item-row[data-item-id="${CSS.escape(item.id)}"]`) || [])];
    const view = this.itemData(item, this.actor);
    if (vaultChanged && this.activeTab === "core" && rows.length) {
      const targetKey = view.inVault ? "play-vault" : "play-loadout";
      const destination = this.root.querySelector(`[data-group-key="${targetKey}"] .dqp-inline-items`);
      if (!destination) return false;
      const row = rows[0];
      const moved = row.parentElement !== destination;
      this.applyItemView(row, view);
      destination.querySelector(".dqp-group-empty")?.remove();
      destination.append(row);
      if (moved) this.animateElement(row, "is-arriving", 420);
      this.updateLoadoutCounts(this.actor);
      return true;
    }
    rows.forEach((row) => this.applyItemView(row, view));
    return true;
  }

  async toggleColumn(column) {
    if (!["character", "traits", "workspace"].includes(column)) return;
    const key = `${column}Open`;
    const nextOpen = !game.settings.get(MODULE_ID, key);
    this.hidePreview();
    const panel = this.root?.querySelector(`[data-column-panel="${column}"]`);
    // Sample before cancelling so rapid reversals continue from their current position.
    const previous = panel ? getComputedStyle(panel) : null;
    const start = previous ? { height: previous.height, opacity: previous.opacity, clipPath: previous.clipPath, marginBottom: previous.marginBottom } : null;
    this.columnAnimations.get(column)?.cancel();
    panel?.classList.toggle("is-collapsed", !nextOpen);
    if (panel) panel.inert = !nextOpen;
    if (panel && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const expandedHeight = getComputedStyle(this.root).getPropertyValue({character:"--dqp-core-height", traits:"--dqp-traits-height", workspace:"--dqp-toolkit-height"}[column]).trim();
      const gap = getComputedStyle(this.root).getPropertyValue("--dqp-gap").trim();
      const end = {height: nextOpen ? expandedHeight : "0px", opacity: nextOpen ? "1" : "0", clipPath: nextOpen ? "inset(0 0 0 0)" : "inset(0 100% 0 0)", marginBottom: nextOpen ? "0px" : `-${gap}`, visibility: "visible"};
      const animation = panel.animate([{...start, visibility: "visible"}, end], { duration: 240, easing: "cubic-bezier(.22,.7,.25,1)" });
      this.columnAnimations.set(column, animation);
      animation.finished.then(() => { if (this.columnAnimations.get(column) === animation) this.columnAnimations.delete(column); }).catch(() => {});
    }
    this.root?.querySelectorAll(`[data-action="toggle-column"][data-column="${column}"]`).forEach((control) => {
      control.setAttribute("aria-expanded", String(nextOpen));
      control.classList.toggle("is-active", nextOpen);
    });

    await game.settings.set(MODULE_ID, key, nextOpen);
  }

  async setResource(actor, target) {
    if (!actor.isOwner) return ui.notifications.warn(localize("DQP.Warnings.NoPermission"));
    const path = target.dataset.path;
    const clicked = Number(target.dataset.value);
    const current = Number(foundry.utils.getProperty(actor, path) || 0);
    const next = current === clicked ? clicked - 1 : clicked;
    this.animateElement(target, next > current ? "is-marked" : "is-cleared");
    if (path === "system.armorScore.value" && typeof actor.system.updateArmorValue === "function") {
      const delta = clamp(next, 0, Number(actor.system.armorScore.max || 0)) - current;
      return this.withLock(`resource:${path}`, target, () => actor.system.updateArmorValue({ value: delta }));
    }
    await this.withLock(`resource:${path}`, target, () => actor.update({ [path]: Math.max(0, next) }));
  }

  async openLevelUp(actor, target) {
    if (!actor.isOwner) return ui.notifications.warn(localize("DQP.Warnings.NoPermission"));
    return this.withLock(`level:${actor.id}`, target, async () => {
      const applications = game.system.api?.applications;
      if (actor.system.needsCharacterSetup) {
        const CharacterCreation = applications?.characterCreation?.CharacterCreation;
        return CharacterCreation && new CharacterCreation(actor).render({ force: true });
      }
      if (!actor.system.class?.value || !actor.system.class?.subclass) {
        return ui.notifications.error(localize("DAGGERHEART.UI.Notifications.missingClassOrSubclass"));
      }

      const level = actor.system.levelData?.level;
      const currentLevel = Number(level?.current || 1);
      const pendingLevel = Number(level?.changed || currentLevel);
      if (pendingLevel <= currentLevel) {
        const tiers = Object.values(actor.system.levelupTiers?.tiers || {});
        const maxLevel = tiers.reduce((maximum, tier) => Math.max(maximum, Number(tier.levels?.end || 0)), 0);
        if (maxLevel && currentLevel >= maxLevel) {
          return ui.notifications.info(localize("DQP.Warnings.MaxLevel"));
        }
        await actor.updateLevel(currentLevel + 1);
      }

      const CharacterLevelup = applications?.levelup?.CharacterLevelup;
      return CharacterLevelup && new CharacterLevelup(actor).render({ force: true });
    });
  }

  async useItem(actor, itemId, event, target) {
    const item = actor.items.get(itemId);
    if (!item) return ui.notifications.error(localize("DQP.Warnings.MissingItem"));
    if (!actor.isOwner) return ui.notifications.warn(localize("DQP.Warnings.NoPermission"));
    if (item.type === "domainCard" && item.system.inVault && !item.system.vaultActive) {
      return ui.notifications.warn(localize("DQP.Warnings.CardInVault"));
    }
    if (item.type === "domainCard" && item.system.isDomainTouchedSuppressed) {
      return ui.notifications.warn(localize("DQP.Warnings.CardSuppressed"));
    }
    const actions = asArray(item.system.actionsList);
    if (!actions.length) {
      ui.notifications.info(localize("DQP.Warnings.NoItemAction"));
      return item.sheet.render({ force: true });
    }
    const insufficient = actions.length === 1 ? this.findInsufficientCost(actor, actions[0]) : null;
    if (insufficient) {
      return ui.notifications.warn(localize("DQP.Warnings.InsufficientResource", insufficient));
    }
    return this.withLock(`item:${itemId}`, target, async () => {
      const row = target?.closest(".dqp-item-row");
      row?.classList.add("is-activating");
      try {
        const result = await item.use(event);
        if (result) this.animateElement(row, "is-used", 620);
        const shouldVault = Boolean(result) && item.type === "domainCard" && Number(item.system.recallCost || 0) > 0 && !item.system.inVault;
        if (shouldVault && typeof item.system.toggleVault === "function") {
          await item.system.toggleVault(event, true, false);
          this.patchItemUpdate(item, { system: { inVault: true } });
        }
        return result;
      } finally {
        row?.classList.remove("is-activating");
      }
    });
  }

  findInsufficientCost(actor, action) {
    for (const cost of asArray(action?.cost)) {
      if (cost?.enabled === false || cost.key === "stress" || cost.itemId) continue;
      const amount = this.costAmount(cost);
      const resource = actor.system.resources?.[cost.key];
      if (!amount || !resource) continue;
      const available = resource.isReversed
        ? Math.max(0, Number(resource.max || 0) - Number(resource.value || 0))
        : Math.max(0, Number(resource.value || 0));
      if (amount > available) return {
        resource: this.costResourceLabel(cost.key),
        needed: amount,
        available,
      };
    }
    return null;
  }

  async toggleVault(actor, itemId, event, target, destination = null) {
    if (!actor.isOwner) return ui.notifications.warn(localize("DQP.Warnings.NoPermission"));
    const item = actor.items.get(itemId);
    if (!item) return ui.notifications.error(localize("DQP.Warnings.MissingItem"));
    if (item.type !== "domainCard" || typeof item.system.toggleVault !== "function") {
      return ui.notifications.error(localize("DQP.Warnings.TransferUnavailable"));
    }
    const toVault = destination ?? !item.system.inVault;
    if (!toVault && !this.loadoutHasRoom(actor, item)) {
      return ui.notifications.warn(localize("DQP.Warnings.LoadoutFull", { max: this.loadoutLimit(actor) }));
    }
    const before = Boolean(item.system.inVault);
    await this.withLock(`vault:${itemId}`, target, () => item.system.toggleVault(event, toVault, !toVault));
    if (Boolean(item.system.inVault) !== before) this.patchItemUpdate(item, { system: { inVault: item.system.inVault } });
  }

  setupPlayersPanel() {
    const players = document.getElementById("players");
    if (!players) return;
    players.classList.add("dqp-players-managed");
    const collapsed = Boolean(game.settings.get(MODULE_ID, "playersCollapsed"));
    players.classList.toggle("dqp-players-collapsed", collapsed);
    let button = players.querySelector(".dqp-players-toggle");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "dqp-players-toggle";
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await game.settings.set(MODULE_ID, "playersCollapsed", !players.classList.contains("dqp-players-collapsed"));
        this.setupPlayersPanel();
      });
      (players.querySelector("#performance-stats") || players).append(button);
    }
    const activeCount = players.querySelectorAll("#players-active .player").length;
    const icon = document.createElement("i");
    icon.className = collapsed ? "fa-solid fa-users" : "fa-solid fa-chevron-left";
    icon.setAttribute("inert", "");
    const count = document.createElement("span");
    count.textContent = String(activeCount);
    button.replaceChildren(icon, count);
    button.setAttribute("aria-expanded", String(!collapsed));
    button.setAttribute("aria-label", localize(collapsed ? "DQP.Players.Show" : "DQP.Players.Hide"));
    button.dataset.tooltip = localize(collapsed ? "DQP.Players.Show" : "DQP.Players.Hide");
  }

  async openDowntime(actor, rest, target) {
    const Downtime = game.system.api?.applications?.dialogs?.Downtime;
    if (!Downtime) return console.warn(`${MODULE_ID} | Daggerheart Downtime API is unavailable`);
    await this.withLock(`rest:${actor.id}`, target, async () => {
      new Downtime(actor, rest === "short").render({ force: true });
    });
  }

  async withLock(key, target, operation) {
    if (this.actionLocks.has(key)) return ui.notifications.info(localize("DQP.Warnings.Busy"));
    this.actionLocks.add(key);
    target?.classList.add("is-busy");
    target?.setAttribute("aria-busy", "true");
    try {
      return await operation();
    } catch (error) {
      console.error(`${MODULE_ID} | Action failed`, error);
      ui.notifications.error(localize("DQP.Warnings.ActionFailed", { reason: error?.message || String(error) }));
    } finally {
      this.actionLocks.delete(key);
      target?.classList.remove("is-busy");
      target?.removeAttribute("aria-busy");
    }
  }

}

let quickPanel = null;

function registerHudSceneControl(controls) {
  if (game.system.id !== "daggerheart" || !game.user.isGM) return;

  const groups = Array.isArray(controls) ? controls : Object.values(controls || {});
  const group = groups.find((control) => ["token", "tokens"].includes(control?.name));
  if (!group) return;

  const activate = () => (quickPanel ?? game.modules.get(MODULE_ID)?.api?.panel)?.toggleHud(null);
  const tool = {
    name: "dqp-toggle-hud",
    title: localize("DQP.Hud.GMControl"),
    icon: "fa-solid fa-eye",
    button: true,
    visible: true,
    onChange: activate,
  };

  // Foundry 14 uses a keyed tools record. Retain the array branch for worlds
  // whose UI compatibility layer still exposes the earlier collection shape.
  if (Array.isArray(group.tools)) {
    if (!group.tools.some((candidate) => candidate?.name === tool.name)) group.tools.push(tool);
    return;
  }

  if (!group.tools || typeof group.tools !== "object") group.tools = {};
  if (group.tools[tool.name] || Object.values(group.tools).some((candidate) => candidate?.name === tool.name)) return;
  const orders = Object.values(group.tools).map((candidate) => Number(candidate?.order)).filter(Number.isFinite);
  group.tools[tool.name] = { ...tool, order: (orders.length ? Math.max(...orders) : -1) + 1 };
}

// Register before ready: build 361 can prepare Scene Controls before the HUD
// itself has mounted. The click callback resolves the panel lazily.
Hooks.on("getSceneControlButtons", registerHudSceneControl);

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "hudEnabled", {
    scope: "client", config: false, type: Boolean, default: true,
    onChange: () => game.modules.get(MODULE_ID)?.api?.panel?.scheduleRender(0),
  });
  game.settings.register(MODULE_ID, "hudScale", {
    name: "DQP.Scale.Title", hint: "DQP.Scale.Hint", scope: "client", config: true,
    type: Number, default: 100, range: { min: 75, max: 125, step: 5 },
    onChange: () => game.modules.get(MODULE_ID)?.api?.panel?.applyScale(),
  });
  game.settings.register(MODULE_ID, "hudTheme", {
    name: "DQP.Theme.Title", hint: "DQP.Theme.Hint", scope: "client", config: true,
    type: String, default: "daggerheart",
    choices: Object.fromEntries(HUD_THEMES.map(([id, label]) => [id, localize(label)])),
    onChange: () => game.modules.get(MODULE_ID)?.api?.panel?.applyTheme(),
  });
  game.settings.register(MODULE_ID, "hudPlacement", {
    name: "DQP.Placement.Title", hint: "DQP.Placement.Hint", scope: "client", config: true,
    type: String, default: "center",
    choices: Object.fromEntries(HUD_PLACEMENTS.map(([id, label]) => [id, localize(label)])),
    onChange: () => game.modules.get(MODULE_ID)?.api?.panel?.applyPlacement(),
  });
  game.settings.register(MODULE_ID, "hudLanguage", {
    name: "DQP.Language.Title", hint: "DQP.Language.Hint", scope: "client", config: true,
    type: String, default: "auto",
    choices: Object.fromEntries(HUD_LANGUAGES.map(([id, label]) => [id, localize(label)])),
    onChange: () => game.modules.get(MODULE_ID)?.api?.panel?.applyLanguage(),
  });
  game.settings.register(MODULE_ID, "selectedActorId", {
    scope: "client",
    config: false,
    type: String,
    default: "",
  });
  game.settings.register(MODULE_ID, "playersCollapsed", {
    scope: "client", config: false, type: Boolean, default: false,
    onChange: () => game.modules.get(MODULE_ID)?.api?.panel?.setupPlayersPanel(),
  });
  for (const column of ["character", "traits", "workspace"]) {
    game.settings.register(MODULE_ID, `${column}Open`, {
      scope: "client",
      config: false,
      type: Boolean,
      default: true,
    });
  }
});

Hooks.once("ready", async () => {
  if (game.system.id !== "daggerheart") return;
  installStressOverflowCostRule();
  const panel = new DaggerheartQuickPanel();
  quickPanel = panel;
  game.modules.get(MODULE_ID).api = { panel, render: () => panel.render() };
  await panel.applyLanguage(false);
  await panel.mount();
  panel.setupPlayersPanel();
  const relevantActor = (document) => document?.type === "character" || document?.parent?.type === "character";
  Hooks.on("updateActor", (actor, changes) => {
    if (actor.type === "character" && !panel.patchActorUpdate(actor, changes)) panel.scheduleRender();
  });
  Hooks.on("createActor", () => panel.scheduleRender());
  Hooks.on("deleteActor", () => panel.scheduleRender());
  Hooks.on("updateUser", (user) => { if (user.id === game.user.id) panel.scheduleRender(); });
  Hooks.on("renderPlayers", () => window.setTimeout(() => panel.setupPlayersPanel(), 0));
  for (const hook of ['renderSidebar', 'renderChatNotifications', 'collapseSidebar']) {
    Hooks.on(hook, () => panel.observeLayout());
  }
  Hooks.on("createItem", (item) => {
    if (relevantActor(item) && item.parent?.id === panel.actor?.id) panel.scheduleRender();
  });
  Hooks.on("updateItem", (item, changes) => {
    if (relevantActor(item) && item.parent?.id === panel.actor?.id && !panel.patchItemUpdate(item, changes)) panel.scheduleRender();
  });
  Hooks.on("deleteItem", (item) => {
    if (relevantActor(item) && item.parent?.id === panel.actor?.id) panel.scheduleRender();
  });
});
