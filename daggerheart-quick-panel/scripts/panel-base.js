import { MODULE_ID, TEMPLATE, ITEM_PARTIAL, STRESS_OVERFLOW_PATCH, TRAITS, ITEM_TYPE_ORDER, HUD_THEMES, HUD_PLACEMENTS, HUD_LANGUAGES, localize, clamp, asArray, escapeHTML, changePaths, installStressOverflowCostRule, plainText } from "./helpers.js";

export class DaggerheartQuickPanelBase {
  constructor() {
    this.root = null;
    this.activeTab = "core";
    this.unrollPane = false;
    this.collapsedGroups = new Set();
    this.renderTimer = null;
    this.rendering = false;
    this.renderAgain = false;
    this.actionLocks = new Set();
    this.boundClick = this.onClick.bind(this);
    this.boundContext = this.onContextMenu.bind(this);
    this.boundChange = this.onChange.bind(this);
    this.boundDragStart = this.onDragStart.bind(this);
    this.boundDragEnd = this.onDragEnd.bind(this);
    this.boundDragOver = this.onDragOver.bind(this);
    this.boundDragLeave = this.onDragLeave.bind(this);
    this.boundDrop = this.onDrop.bind(this);
    this.boundHover = this.onHover.bind(this);
    this.boundLeave = this.onHoverLeave.bind(this);
    this.boundKey = (event) => { if (event.key === "Escape") this.hidePreview(); };
    this.previewTimer = null;
    this.previewAnchor = null;
    this.preview = null;
    this.scaleHideTimer = null;
    this.themeHideTimer = null;
    this.columnAnimations = new Map();
    this.dragState = null;
    this.layoutFrame = null;
    this.languageCache = new Map();
    this.activeLanguage = "en";
    this.boundLayout = () => this.scheduleLayout();
  }

  get open() {
    return Boolean(game.settings.get(MODULE_ID, "hudEnabled"));
  }

  get columnState() {
    return {
      characterOpen: Boolean(game.settings.get(MODULE_ID, "characterOpen")),
      traitsOpen: Boolean(game.settings.get(MODULE_ID, "traitsOpen")),
      workspaceOpen: Boolean(game.settings.get(MODULE_ID, "workspaceOpen")),
    };
  }

  get actors() {
    const characters = game.actors
      .filter((actor) => actor.type === "character" && (game.user.isGM || actor.isOwner))
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
    return characters;
  }

  get actor() {
    const actors = this.actors;
    if (!actors.length) return null;

    const selectedId = game.settings.get(MODULE_ID, "selectedActorId");
    const selected = actors.find((actor) => actor.id === selectedId);
    if (selected) return selected;

    const assigned = actors.find((actor) => actor.id === game.user.character?.id);
    return assigned || actors[0];
  }

  async mount() {
    if (game.system.id !== "daggerheart") return;
    if (document.getElementById("dqp-root")) return;

    this.root = document.createElement("div");
    this.root.id = "dqp-root";
    this.bindEvents();
    document.body.append(this.root);
    this.setupPlayersPanel();

    await foundry.applications.handlebars.loadTemplates([ITEM_PARTIAL]);

    const selected = this.actor;
    if (selected && !game.settings.get(MODULE_ID, "selectedActorId")) {
      await game.settings.set(MODULE_ID, "selectedActorId", selected.id);
    }
    await this.render();
  }

  scheduleRender(delay = 40) {
    window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => this.render(), delay);
  }

  bindEvents() {
    this.root.addEventListener("click", this.boundClick);
    this.root.addEventListener("contextmenu", this.boundContext);
    this.root.addEventListener("change", this.boundChange);
    this.root.addEventListener("dragstart", this.boundDragStart);
    this.root.addEventListener("dragend", this.boundDragEnd);
    this.root.addEventListener("dragover", this.boundDragOver);
    this.root.addEventListener("dragleave", this.boundDragLeave);
    this.root.addEventListener("drop", this.boundDrop);
    this.root.addEventListener("pointerover", this.boundHover);
    this.root.addEventListener("focusin", this.boundHover);
    this.root.addEventListener("pointerout", this.boundLeave);
    this.root.addEventListener("focusout", this.boundLeave);
    this.root.addEventListener("keydown", this.boundKey);
    window.addEventListener("resize", this.boundLayout);
    this.layoutObserver ??= new ResizeObserver(this.boundLayout);
    this.chromeObserver ??= new MutationObserver(this.boundLayout);
  }

  scheduleLayout() {
    if (this.layoutFrame != null) return;
    this.layoutFrame = requestAnimationFrame(() => {
      this.layoutFrame = null;
      this.positionHud();
    });
  }

  observeLayout() {
    this.layoutObserver?.disconnect();
    this.chromeObserver?.disconnect();
    for (const element of document.querySelectorAll('#ui-right, #ui-right-column-1, #sidebar, #sidebar-content, #chat-notifications, #chat-message, #dqp-root .dqp-shell')) {
      this.layoutObserver?.observe(element);
      if (!element.closest('#dqp-root')) this.chromeObserver?.observe(element, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    }
    this.scheduleLayout();
  }

  positionHud() {
    if (!this.root) return;
    const shell = this.root.querySelector('.dqp-shell');
    if (!shell) {
      document.documentElement.style.removeProperty('--dqp-chat-clearance');
      return;
    }
    const margin = 18;
    let right = window.innerWidth - margin;
    // The real sidebar is the horizontal obstacle. The quick-chat column is
    // lifted above the HUD below, so its transparent wrapper must not squeeze
    // the centered ribbon.
    const sidebar = document.querySelector('#sidebar') || document.querySelector('#ui-right');
    for (const element of sidebar ? [sidebar] : []) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || !rect.width || !rect.height) continue;
      if (rect.left > window.innerWidth * .35 && rect.left < window.innerWidth && rect.bottom > window.innerHeight * .5) {
        right = Math.min(right, rect.left - margin);
      }
    }
    const placement = game.settings.get(MODULE_ID, 'hudPlacement') === 'side' ? 'side' : 'center';
    const center = window.innerWidth / 2;
    const halfAvailable = Math.max(1, Math.min(center - margin, right - center));
    const available = placement === 'side' ? Math.max(1, right - margin) : halfAvailable * 2;
    this.hudBounds = placement === 'side'
      ? { left: margin, right }
      : { left: center - halfAvailable, right: center + halfAvailable };
    const requested = clamp(Number(game.settings.get(MODULE_ID, 'hudScale')) || 100, 75, 125) / 100;
    const rootStyle = getComputedStyle(this.root);
    const portrait = parseFloat(rootStyle.getPropertyValue('--dqp-portrait-size')) || 108;
    const maximumColumns = parseFloat(rootStyle.getPropertyValue('--dqp-hud-max')) || 1240;
    const chrome = portrait + 38;
    const scale = Math.min(requested, available / (720 + chrome));
    const columns = Math.min(maximumColumns, Math.max(720, available / scale - chrome));
    this.root.style.setProperty('--dqp-scale', scale);
    this.root.style.setProperty('--dqp-columns-width', `${columns}px`);
    shell.style.left = `${(placement === 'side' ? margin : center) / scale}px`;
    shell.style.bottom = `${margin / scale}px`;
    const shellRect = shell.getBoundingClientRect();
    document.documentElement.style.setProperty('--dqp-chat-clearance', `${Math.ceil(window.innerHeight - shellRect.top + 14)}px`);
    const avatar = shell.querySelector('.dqp-avatar-anchor')?.getBoundingClientRect();
    const toggle = this.root.querySelector('.dqp-hud-toggle.is-on');
    if (toggle && avatar) {
      toggle.style.left = `${avatar.left + 6 * scale}px`;
      toggle.style.bottom = `${window.innerHeight - avatar.bottom + 31 * scale}px`;
    }
  }

  async render() {
    if (!this.root || game.system.id !== "daggerheart") return;
    if (this.rendering) {
      this.renderAgain = true;
      return;
    }

    this.rendering = true;
    for (const animation of this.columnAnimations.values()) animation.cancel();
    this.columnAnimations.clear();
    this.hidePreview();
    const oldContent = this.root.querySelector(".dqp-ribbon-scroll");
    const scrollLeft = oldContent?.scrollLeft || 0;

    try {
      const context = this.prepareContext();
      // Reuse the sheet's grouping, including multiclass, companion and availability rules.
      const actor = context.hudEnabled ? this.actor : null;
      if (actor?.sheet._prepareFeaturesContext) {
        const native = {};
        await actor.sheet._prepareFeaturesContext(native, {});
        context.abilityGroups = (native.featureGroups || []).map((group, index) =>
          this.groupData(`features-${group.anchorItem?.id || group.type}-${index}`, group.title,
            group.values.map(item => this.itemData(item, actor)), true, group.type));
      } else if (actor?.system.sheetLists) {
        // Daggerheart 2.2.x exposes the sheet's native categories through the
        // actor model instead of CharacterSheet#_prepareFeaturesContext.
        context.abilityGroups = Object.entries(actor.system.sheetLists)
          .filter(([, group]) => group?.type === "feature" || asArray(group?.values).length)
          .map(([key, group], index) => this.groupData(`features-${key}-${index}`, group.title,
            asArray(group.values).map(item => this.itemData(item, actor)), true, group.type || key))
          .filter((group) => group.items.length);
      }
      const html = await foundry.applications.handlebars.renderTemplate(TEMPLATE, context);
      this.root.innerHTML = html;
      this.applyTheme();
      this.applyPlacement();
      this.applyScale();
      this.observeLayout();
      this.root.querySelector(".dqp-ribbon-scroll")?.scrollTo({ left: scrollLeft });
      this.root.classList.toggle("dqp-panel-open", context.open);
      this.root.classList.toggle("dqp-hud-disabled", !context.hudEnabled);
      document.body.classList.toggle("dqp-bottom-hud-active", context.hudEnabled);
      this.unrollPane = false;
    } catch (error) {
      console.error(`${MODULE_ID} | Failed to render`, error);
    } finally {
      this.rendering = false;
      if (this.renderAgain) {
        this.renderAgain = false;
        this.scheduleRender(20);
      }
    }
  }

  prepareContext() {
    const hudEnabled = this.open;
    const hudToggle = {
      hudEnabled,
      hudToggleIcon: hudEnabled ? "fa-solid fa-eye-slash" : "fa-solid fa-eye",
      hudToggleLabel: localize(hudEnabled ? "DQP.Hud.Hide" : "DQP.Hud.Show"),
    };
    if (!hudEnabled) return hudToggle;

    const actor = this.actor;
    const columnState = this.columnState;
    const tabs = [
      ["core", "DQP.Tabs.Core", "fa-solid fa-heart-pulse"],
      ["actions", "DQP.Tabs.Actions", "fa-solid fa-bolt"],
      ["abilities", "DQP.Tabs.Abilities", "fa-solid fa-layer-group"],
      ["experiences", "DQP.Experiences.Title", "fa-solid fa-feather-pointed"],
      ["gear", "DQP.Tabs.Gear", "fa-solid fa-suitcase"],
    ].map(([id, label, icon]) => ({ id, label: localize(label), icon, active: id === this.activeTab }));

    const context = {
      ...hudToggle,
      open: this.open,
      ...columnState,
      unrollPane: this.unrollPane,
      actor: null,
      actorChoices: this.actors.map((candidate) => ({ id: candidate.id, name: candidate.name, selected: candidate.id === actor?.id })),
      tabs,
      themes: HUD_THEMES.map(([id, label]) => ({
        id,
        label: localize(label),
        active: id === (game.settings.get(MODULE_ID, "hudTheme") || "daggerheart"),
      })),
      placements: HUD_PLACEMENTS.map(([id, label, icon]) => ({
        id,
        label: localize(label),
        icon,
        active: id === (game.settings.get(MODULE_ID, "hudPlacement") || "center"),
      })),
      activeTab: this.activeTab,
      showCore: this.activeTab === "core",
      showActions: this.activeTab === "actions",
      showAbilities: this.activeTab === "abilities",
      showExperiences: this.activeTab === "experiences",
      showGear: this.activeTab === "gear",
      emptyHint: localize(game.user.isGM ? "DQP.Actor.NoneHintGM" : "DQP.Actor.NoneHintPlayer"),
    };
    if (!actor) return context;

    const className = actor.system.class?.value?.name || actor.items.find((item) => item.type === "class")?.name || "";
    const subclassName = actor.system.class?.subclass?.name || actor.items.find((item) => item.type === "subclass")?.name || "";
    const subtitle = [className, subclassName].filter(Boolean).join(" · ");
    const domainLabel = [...new Set(actor.items
      .filter((item) => item.type === "domainCard")
      .map((item) => item.system.domainLabel)
      .filter(Boolean))].join(" · ") || "—";
    const level = actor.system.levelData?.level?.current ?? actor.system.level ?? 1;

    const resources = [
      this.resourceData(actor, "hitPoints", "system.resources.hitPoints.value", "DQP.Resources.HitPoints", "fa-solid fa-heart-crack"),
      this.resourceData(actor, "stress", "system.resources.stress.value", "DQP.Resources.Stress", "fa-solid fa-bolt"),
      this.resourceData(actor, "hope", "system.resources.hope.value", "DQP.Resources.Hope", "fa-solid fa-diamond"),
    ];
    const armorMax = Number(actor.system.armorScore?.max || 0);
    if (armorMax > 0) {
      resources.push(this.resourceData(actor, "armor", "system.armorScore.value", "DQP.Resources.Armor", "fa-solid fa-shield-halved", actor.system.armorScore));
    }

    const traits = TRAITS.map(([key, labelKey, icon]) => {
      const value = Number(actor.system.traits?.[key]?.value || 0);
      const label = localize(`DQP.Traits.${labelKey}`);
      return {
        key,
        icon,
        label,
        shortLabel: label.slice(0, 3).toUpperCase(),
        displayValue: value >= 0 ? `+${value}` : `${value}`,
        rollLabel: localize("DQP.Traits.Roll", { trait: label }),
      };
    });

    const itemViews = actor.items.map((item) => this.itemData(item, actor));
    const actionable = itemViews.filter((item) => item.usable);
    const actionItems = actionable.filter((item) => {
      if (item.type === "weapon") return item.equipped;
      if (item.type === "domainCard") return !item.inVault || item.vaultActive;
      return ["feature", "consumable", "loot"].includes(item.type);
    });

    const domainCards = itemViews.filter((item) => item.type === "domainCard");
    const features = itemViews.filter((item) => item.type === "feature");
    const loadout = domainCards.filter((item) => !item.inVault);
    const equipped = actor.items.filter(item => item.system.equipped && (item.type === "weapon" || item.usable))
      .sort((a, b) => (a.type === "weapon" ? Number(Boolean(a.system.secondary)) : 2) - (b.type === "weapon" ? Number(Boolean(b.system.secondary)) : 2))
      .map(item => this.itemData(item, actor));
    if (actor.system.usesUnarmed && actor.system.attack) {
      const attack = actor.system.attack;
      equipped.unshift({ id: "dqp-unarmed", type: "attack", name: localize(attack.name), img: attack.img,
        meta: (attack._getLabels || []).map(label => localize(label.value || label)).join(" · "),
        primaryAction: "use-unarmed", primaryIcon: "fa-solid fa-play", primaryLabel: localize(attack.name),
        detailsLabel: localize("DQP.Actor.OpenSheet") });
    }
    const loadoutGroup = this.groupData("play-loadout", "DQP.Play.Loadout", loadout);
    loadoutGroup.countLabel = `${loadout.length}/${this.loadoutLimit(actor)}`;
    loadoutGroup.dropTarget = "loadout";
    const vaultGroup = this.groupData("play-vault", "DQP.Cards.Vault", domainCards.filter((item) => item.inVault));
    vaultGroup.dropTarget = "vault";
    const playGroups = [
      this.groupData("play-equipment", "DQP.Play.Equipment", equipped, true),
      loadoutGroup,
      vaultGroup,
    ].filter((group) => group.items.length || group.key !== "play-equipment");

    const actionGroups = [
      this.groupData("actions-weapons", "DQP.Actions.Weapons", actionItems.filter((item) => item.type === "weapon")),
      this.groupData("actions-cards", "DQP.Cards.Loadout", actionItems.filter((item) => item.type === "domainCard")),
      this.groupData("actions-features", "DQP.Actions.Features", actionItems.filter((item) => item.type === "feature")),
      this.groupData("actions-consumables", "DQP.Actions.Consumables", actionItems.filter((item) => ["consumable", "loot"].includes(item.type))),
    ].filter((group) => group.items.length);

    const abilityGroups = [
      this.groupData("library-features", "DQP.Cards.Feature", features),
    ].filter((group) => group.items.length);

    const gearGroups = ITEM_TYPE_ORDER.map((type) => this.groupData(`gear-${type}`, {
        weapon: "DQP.Gear.Weapons",
        armor: "DQP.Gear.Armor",
        consumable: "DQP.Gear.Consumables",
        loot: "DQP.Gear.Loot",
      }[type], itemViews.filter((item) => item.type === type))).filter((group) => group.items.length);

    return {
      ...context,
      actor: {
        id: actor.id,
        name: actor.name,
        img: actor.img,
        subtitle,
        classLabel: subtitle || "—",
        domainLabel,
        level,
        levelLabel: localize("DAGGERHEART.GENERAL.level"),
      },
      resources,
      coreResources: resources.filter((resource) => resource.key !== "armor"),
      armorResource: resources.find((resource) => resource.key === "armor"),
      traits,
      experiences: Object.entries(actor.system.experiences || {}).map(([id, experience]) => ({
        id, name: experience.name || localize("DQP.Experiences.Unnamed"),
        value: Number(experience.value) >= 0 ? `+${Number(experience.value) || 0}` : String(experience.value),
      })),
      stats: [
        { label: localize("DQP.Stats.Evasion"), value: actor.system.evasion ?? "—", icon: "fa-solid fa-feather-pointed" },
        { label: localize("DQP.Stats.Armor"), value: actor.system.armorScore?.max ?? 0, icon: "fa-solid fa-shield" },
        { label: localize("DQP.Stats.Proficiency"), value: actor.system.proficiency ?? 0, icon: "fa-solid fa-star" },
      ],
      thresholds: this.thresholdData(actor),
      playGroups,
      actionGroups,
      abilityGroups,
      gearGroups,
    };
  }

  groupData(key, labelKey, items, preserveOrder = false, category = "") {
    const label = localize(labelKey);
    const collapsed = this.collapsedGroups.has(key);
    const icon = this.groupIcon(key, category);
    return {
      key,
      label,
      icon,
      countLabel: items.length,
      items: preserveOrder ? [...items] : [...items].sort((a, b) => Number(b.equipped) - Number(a.equipped) || a.name.localeCompare(b.name)),
      collapsed,
      toggleLabel: localize(collapsed ? "DQP.Group.Expand" : "DQP.Group.Collapse", { group: label }),
    };
  }

  groupIcon(key, category = "") {
    const kind = `${key} ${category}`.toLowerCase();
    if (kind.includes("equipment")) return "fa-solid fa-briefcase";
    if (kind.includes("loadout") || kind.includes("cards")) return "fa-solid fa-layer-group";
    if (kind.includes("vault")) return "fa-solid fa-box-archive";
    if (kind.includes("weapon")) return "fa-solid fa-swords";
    if (kind.includes("armor")) return "fa-solid fa-shield-halved";
    if (kind.includes("consumable")) return "fa-solid fa-flask";
    if (kind.includes("loot")) return "fa-solid fa-gem";
    if (kind.includes("ancestry")) return "fa-solid fa-dna";
    if (kind.includes("community")) return "fa-solid fa-people-group";
    if (kind.includes("companion")) return "fa-solid fa-paw";
    if (kind.includes("transformation")) return "fa-solid fa-wand-magic-sparkles";
    if (kind.includes("multiclass")) return "fa-solid fa-diagram-project";
    if (kind.includes("subclass")) return "fa-solid fa-shield-heart";
    if (kind.includes("class")) return "fa-solid fa-shield";
    return "fa-solid fa-sparkles";
  }

  loadoutLimit(actor) {
    let base = 5;
    try {
      const setting = CONFIG.DH?.SETTINGS?.gameSettings?.Homebrew;
      const configured = setting ? Number(game.settings.get(CONFIG.DH.id, setting)?.maxLoadout) : NaN;
      if (Number.isFinite(configured)) base = configured;
    } catch (_error) { /* Fall back to the Daggerheart default. */ }
    return Math.max(0, base + Number(actor.system.bonuses?.maxLoadout || 0));
  }

  resourceData(actor, key, path, labelKey, icon, override) {
    const resource = override || foundry.utils.getProperty(actor, path.replace(/\.value$/, "")) || {};
    const value = clamp(resource.value, 0, Number(resource.max || 0));
    const max = Math.max(0, Number(resource.max || 0));
    const label = localize(labelKey);
    return {
      key,
      path,
      icon,
      label,
      value,
      max,
      pips: Array.from({ length: max }, (_, index) => {
        const pipValue = index + 1;
        return {
          value: pipValue,
          active: pipValue <= value,
          label: localize("DQP.Resources.Set", { resource: label, value: pipValue }),
        };
      }),
    };
  }

  thresholdData(actor) {
    const major = Number(actor.system.damageThresholds?.major);
    const severe = Number(actor.system.damageThresholds?.severe);
    if (!Number.isFinite(major) || !Number.isFinite(severe)) {
      return [
        { label: localize("DQP.Stats.Minor"), value: "—" },
        { label: localize("DQP.Stats.Major"), value: "—" },
        { label: localize("DQP.Stats.Severe"), value: "—" },
      ];
    }
    const majorRange = severe - major > 1 ? `${major}–${severe - 1}` : `${major}`;
    return [
      { label: localize("DQP.Stats.Minor"), value: `< ${major}` },
      { label: localize("DQP.Stats.Major"), value: majorRange },
      { label: localize("DQP.Stats.Severe"), value: `≥ ${severe}` },
    ];
  }

  costAmount(cost) {
    return Math.max(0, Number(cost?.total ?? (Number(cost?.value || 0) + Number(cost?.scale || 0) * Number(cost?.step || 1))) || 0);
  }

  costResourceLabel(key) {
    const labels = {
      stress: "DQP.Resources.Stress",
      hope: "DQP.Resources.Hope",
      hitPoints: "DQP.Resources.HitPoints",
      armor: "DQP.Resources.Armor",
      quantity: "DQP.Cost.Quantity",
      resource: "DQP.Cost.Charges",
      fear: "DQP.Cost.Fear",
    };
    return localize(labels[key] || key);
  }

  describeCosts(costs, actor) {
    const grouped = new Map();
    for (const cost of asArray(costs)) {
      if (cost?.enabled === false) continue;
      const amount = this.costAmount(cost);
      if (!amount) continue;
      grouped.set(cost.key, (grouped.get(cost.key) || 0) + amount);
    }
    const descriptions = [];
    const short = [];
    const icons = { stress: "⚡", hope: "◆", hitPoints: "♥", armor: "⬟", quantity: "×", resource: "●", fear: "◈" };
    for (const [key, amount] of grouped) {
      const label = this.costResourceLabel(key);
      if (key === "stress") {
        const stress = actor.system.resources?.stress || {};
        const available = Math.max(0, Number(stress.max || 0) - Number(stress.value || 0));
        if (amount > available) {
          const split = available
            ? localize("DQP.Cost.StressOverflowPartial", { stress: available, hp: 1 })
            : localize("DQP.Cost.StressOverflowFull", { hp: 1 });
          descriptions.push(`${amount} ${label} → ${split}`);
          short.push(`${icons.stress}${amount}→${icons.hitPoints}1`);
          continue;
        }
      }
      descriptions.push(`${amount} ${label}`);
      short.push(`${icons[key] || "•"}${amount}`);
    }
    return { description: descriptions.join(" + "), short: short.join(" ") };
  }

  itemCostPreview(item, actor) {
    if (item.type === "domainCard" && item.system.inVault) {
      const recallCost = Math.max(0, Number(item.system.recallCost || 0));
      if (!recallCost) return {
        full: localize("DQP.Cost.Recall", { cost: localize("DQP.Cost.Free") }),
        short: localize("DQP.Cost.FreeShort"),
      };
      const preview = this.describeCosts([{ key: "stress", value: recallCost }], actor);
      return { full: localize("DQP.Cost.Recall", { cost: preview.description }), short: preview.short };
    }

    const previews = asArray(item.system.actionsList)
      .map((action) => this.describeCosts(action.cost, actor))
      .filter((preview) => preview.description);
    const uniqueDescriptions = [...new Set(previews.map((preview) => preview.description))];
    if (!uniqueDescriptions.length) return { full: "", short: "" };
    return {
      full: localize("DQP.Cost.Action", { cost: uniqueDescriptions.join(" / ") }),
      short: previews[0]?.short || "",
    };
  }

  itemData(item, actor) {
    const actions = asArray(item.system.actionsList);
    const resource = item.system.resource;
    const attack = item.system.attack;
    const damage = attack?.damage?.parts?.hitPoints?.value || attack?.damage?.main?.value;
    const damageDice = damage?.custom?.enabled ? damage.custom.formula : damage?.dice;
    const damageBonus = Number(damage?.bonus || 0);
    const trait = attack?.roll?.trait;
    const range = attack?.range;
    const metaParts = [];

    if (trait) metaParts.push(localize(`DAGGERHEART.CONFIG.Traits.${trait}.short`));
    if (range) metaParts.push(localize(`DAGGERHEART.CONFIG.Range.${range}.short`));
    if (damageDice) metaParts.push(`${damageDice}${damageBonus ? ` + ${damageBonus}` : ""}`);
    if (item.type === "domainCard") {
      if (item.system.domainLabel) metaParts.push(item.system.domainLabel);
      if (item.system.level) metaParts.push(`Lv ${item.system.level}`);
    }

    let resourceText = "";
    if (resource) {
      if (resource.type === "die" || resource.dieFaces) resourceText = resource.dieFaces || "";
      else if (resource.max != null) resourceText = `${resource.value ?? 0}/${resource.max}`;
      else if (resource.value != null) resourceText = String(resource.value);
    } else if (item.system.quantity > 1) {
      resourceText = `×${item.system.quantity}`;
    }

    let badge = "";
    if (item.system.equipped) badge = localize("DQP.Gear.Equipped");
    else if (item.type === "domainCard" && item.system.inVault) badge = localize("DQP.Cards.InVault");

    const unavailableInVault = item.type === "domainCard" && item.system.inVault && !item.system.vaultActive;
    const usable = actions.length > 0 && !unavailableInVault && !(item.type === "domainCard" && item.system.isDomainTouchedSuppressed);
    const typeLabel = localize(`TYPES.Item.${item.type}`);
    const meta = metaParts.filter(Boolean).join(" · ") || typeLabel;
    const costPreview = this.itemCostPreview(item, actor);

    return {
      id: item.id,
      uuid: item.uuid,
      type: item.type,
      name: item.name,
      img: item.img,
      meta,
      resource: resourceText,
      badge,
      equipped: Boolean(item.system.equipped),
      equippable: ["weapon", "armor"].includes(item.type),
      equipLabel: localize(item.system.equipped ? "DQP.Gear.Unequip" : "DQP.Gear.Equip"),
      inVault: Boolean(item.system.inVault),
      vaultActive: Boolean(item.system.vaultActive),
      vaultable: item.type === "domainCard",
      vaultLabel: localize(item.system.inVault ? "DQP.Cards.ToLoadout" : "DQP.Cards.ToVault"),
      vaultTooltip: item.type === "domainCard" && item.system.inVault
        ? `${localize("DQP.Cards.ToLoadout")} · ${costPreview.full}`
        : localize("DQP.Cards.ToVault"),
      vaultIcon: item.system.inVault ? "fa-solid fa-arrow-up" : "fa-solid fa-arrow-down",
      costPreview: costPreview.full,
      costShort: costPreview.short,
      usable,
      useLabel: localize("DQP.Actions.Use", { item: item.name }),
      detailsLabel: localize("DQP.Actions.Details", { item: item.name }),
      primaryAction: usable ? "use-item" : "open-item",
      primaryLabel: localize(usable ? "DQP.Actions.Use" : "DQP.Actions.Details", { item: item.name }),
      primaryIcon: usable ? "fa-solid fa-play" : "fa-solid fa-circle-info",
    };
  }

  async onClick(event) {
    const target = event.target.closest("[data-action]");
    if (!target || !this.root?.contains(target)) return;
    const action = target.dataset.action;

    this.hidePreview();

    if (action === "toggle-hud") return this.toggleHud(target);
    if (action === "toggle-scale") {
      const controls = this.root.querySelector(".dqp-scale-controls");
      if (controls.hidden) {
        this.hideThemeControls();
        controls.hidden = false;
        target.setAttribute("aria-expanded", "true");
      } else this.hideScaleControls();
      return;
    }
    if (action === "set-scale") {
      const current = Number(game.settings.get(MODULE_ID, "hudScale")) || 100;
      const next = target.dataset.scale === "reset" ? 100 : clamp(current + Number(target.dataset.scale), 75, 125);
      await game.settings.set(MODULE_ID, "hudScale", next);
      return this.applyScale();
    }
    if (action === "set-placement") {
      if (!HUD_PLACEMENTS.some(([id]) => id === target.dataset.placement)) return;
      await game.settings.set(MODULE_ID, "hudPlacement", target.dataset.placement);
      return this.applyPlacement();
    }
    if (action === "toggle-theme") {
      const controls = this.root.querySelector(".dqp-theme-controls");
      if (controls.hidden) {
        this.hideScaleControls();
        controls.hidden = false;
        target.setAttribute("aria-expanded", "true");
      } else this.hideThemeControls();
      return;
    }
    if (action === "set-theme") {
      if (!HUD_THEMES.some(([id]) => id === target.dataset.theme)) return;
      await game.settings.set(MODULE_ID, "hudTheme", target.dataset.theme);
      this.applyTheme();
      return this.hideThemeControls();
    }
    if (action === "toggle-column") return this.toggleColumn(target.dataset.column);
    if (action === "set-tab") {
      const nextTab = target.dataset.tab || "core";
      this.unrollPane = nextTab !== this.activeTab;
      this.activeTab = nextTab;
      if (!game.settings.get(MODULE_ID, "workspaceOpen")) await this.toggleColumn("workspace");
      return this.render();
    }
    if (action === "toggle-group") {
      const key = target.dataset.group;
      if (this.collapsedGroups.has(key)) this.collapsedGroups.delete(key);
      else this.collapsedGroups.add(key);
      return this.render();
    }
    const actor = this.actor;
    if (!actor) return;
    if (action === "use-unarmed" && actor.isOwner && actor.system.usesUnarmed) return this.withLock(`unarmed:${actor.id}`, target, () => actor.system.attack.use(event));
    if (action === "open-sheet") return actor.sheet.render({ force: true });
    if (action === "level-up") return this.openLevelUp(actor, target);
    if (action === "show-experience") return this.showExperience(actor, target);
    if (action === "roll-trait") return this.withLock(`trait:${target.dataset.trait}`, target, () => actor.rollTrait(target.dataset.trait, { event }));
    if (action === "set-resource") return this.setResource(actor, target);
    if (action === "use-item") return this.useItem(actor, target.dataset.itemId, event, target);
    if (action === "toggle-vault") return this.toggleVault(actor, target.dataset.itemId, event, target);
    if (action === "toggle-equip") return this.toggleEquip(actor, target, event);
    if (action === "open-item") return (target.dataset.itemId === "dqp-unarmed" ? actor : actor.items.get(target.dataset.itemId))?.sheet.render({ force: true });
    if (action === "downtime") return this.openDowntime(actor, target.dataset.rest, target);
  }

  applyScale() {
    const scale = clamp(Number(game.settings.get(MODULE_ID, "hudScale")) || 100, 75, 125);
    this.root.style.setProperty("--dqp-scale", scale / 100);
    document.body.style.setProperty("--dqp-players-bottom", `${Math.round(30 + 208 * scale / 100)}px`);
    const output = this.root.querySelector('[data-scale="reset"]');
    if (output) output.textContent = `${scale}%`;
    for (const button of this.root.querySelectorAll('[data-action="set-scale"]')) {
      button.disabled = (button.dataset.scale === "-5" && scale === 75) || (button.dataset.scale === "5" && scale === 125);
    }
    this.positionHud();
  }

  applyTheme() {
    if (!this.root) return;
    const selected = game.settings.get(MODULE_ID, "hudTheme") || "daggerheart";
    const theme = HUD_THEMES.some(([id]) => id === selected) ? selected : "daggerheart";
    this.root.dataset.theme = theme;
    for (const button of this.root.querySelectorAll('[data-action="set-theme"]')) {
      const active = button.dataset.theme === theme;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }
}
