const MODULE_ID = "daggerheart-quick-panel";
const TEMPLATE = `modules/${MODULE_ID}/templates/panel.hbs`;
const ITEM_PARTIAL = `modules/${MODULE_ID}/templates/partials/item-row.hbs`;
const STRESS_OVERFLOW_PATCH = Symbol.for(`${MODULE_ID}.stress-overflow-cost-rule`);

const TRAITS = [
  ["agility", "Agility", "fa-solid fa-person-running"],
  ["strength", "Strength", "fa-solid fa-hand-fist"],
  ["finesse", "Finesse", "fa-solid fa-hand-sparkles"],
  ["instinct", "Instinct", "fa-solid fa-eye"],
  ["presence", "Presence", "fa-solid fa-masks-theater"],
  ["knowledge", "Knowledge", "fa-solid fa-book-open"],
];

const ITEM_TYPE_ORDER = ["weapon", "armor", "consumable", "loot"];

const HUD_THEMES = [
  ["daggerheart", "DQP.Theme.Daggerheart"],
  ["minimal", "DQP.Theme.Minimal"],
  ["arcane", "DQP.Theme.Arcane"],
  ["sacred", "DQP.Theme.Sacred"],
  ["monochrome", "DQP.Theme.Monochrome"],
];

const HUD_PLACEMENTS = [
  ["center", "DQP.Placement.Center", "fa-solid fa-arrows-to-circle"],
  ["side", "DQP.Placement.Side", "fa-solid fa-align-left"],
];

function localize(key, data) {
  return data ? game.i18n.format(key, data) : game.i18n.localize(key);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.values === "function") return Array.from(value.values());
  return Array.from(value);
}

function escapeHTML(value) {
  const element = document.createElement("span");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

function changePaths(value, prefix = "") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === "object" && !Array.isArray(child) ? changePaths(child, path) : [path];
  });
}

/**
 * Daggerheart already converts Stress that would exceed its maximum into a Hit
 * Point when resources are applied. Its action-cost validation normally stops
 * the action before that conversion can happen, though. Keep every other cost
 * check native and only waive the unavailable-slot check for actor Stress.
 */
function installStressOverflowCostRule() {
  const CostField = game.system.api?.fields?.ActionFields?.CostField;
  const nativeHasCost = CostField?.hasCost;
  if (typeof nativeHasCost !== "function" || nativeHasCost[STRESS_OVERFLOW_PATCH]) return false;

  const hasCostWithStressOverflow = function (costs) {
    if (nativeHasCost.call(this, costs)) return true;

    const realCosts = typeof CostField.getRealCosts === "function"
      ? CostField.getRealCosts.call(this, costs)
      : asArray(costs).filter((cost) => cost.enabled !== false);
    const hasActorStressCost = realCosts.some((cost) =>
      cost.key === "stress" && !cost.itemId && Number(cost.total ?? cost.value ?? 0) > 0
    );
    if (!hasActorStressCost) return false;

    const nonStressCosts = realCosts.filter((cost) => cost.key !== "stress" || cost.itemId);
    return nativeHasCost.call(this, nonStressCosts);
  };

  Object.defineProperty(hasCostWithStressOverflow, STRESS_OVERFLOW_PATCH, { value: true });
  Object.defineProperty(hasCostWithStressOverflow, "dqpNativeHasCost", { value: nativeHasCost });
  CostField.hasCost = hasCostWithStressOverflow;
  return true;
}

function plainText(html, max = 180) {
  const holder = document.createElement("template");
  holder.innerHTML = html || "";
  holder.content.querySelectorAll("script, style").forEach((node) => node.remove());
  holder.content.querySelectorAll("p, div, li, br, h1, h2, h3, h4").forEach((node) => node.append(document.createTextNode("\n")));
  const text = (holder.content.textContent || "").replace(/[\t ]+/g, " ").replace(/\n\s*\n/g, "\n\n").trim();
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

class DaggerheartQuickPanel {
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
  game.modules.get(MODULE_ID).api = { panel, render: () => panel.render() };
  await panel.mount();
  panel.setupPlayersPanel();

  // Keep a GM-only fallback control in Foundry's scene tools. This remains
  // available even when the floating eye is hidden or covered by another UI.
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;
    const groups = Array.isArray(controls) ? controls : Object.values(controls || {});
    let group = groups.find((control) => ["token", "tokens"].includes(control.name));
    if (!group) {
      group = { name: "dqp-hud", title: localize("DQP.Hud.GMControlTitle"), icon: "fa-solid fa-eye", tools: [] };
      if (Array.isArray(controls)) controls.push(group);
      else controls.dqpHud = group;
    }
    group.tools ||= [];
    if (group.tools.some((tool) => tool.name === "dqp-toggle-hud")) return;
    group.tools.push({
      name: "dqp-toggle-hud",
      title: localize("DQP.Hud.GMControl"),
      icon: "fa-solid fa-eye",
      button: true,
      onChange: () => panel.enableHud(),
    });
  });

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
