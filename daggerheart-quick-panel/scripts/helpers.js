export const MODULE_ID = "daggerheart-quick-panel";
export const TEMPLATE = `modules/${MODULE_ID}/templates/panel.hbs`;
export const ITEM_PARTIAL = `modules/${MODULE_ID}/templates/partials/item-row.hbs`;
export const STRESS_OVERFLOW_PATCH = Symbol.for(`${MODULE_ID}.stress-overflow-cost-rule`);

export const TRAITS = [
  ["agility", "Agility", "fa-solid fa-person-running"],
  ["strength", "Strength", "fa-solid fa-hand-fist"],
  ["finesse", "Finesse", "fa-solid fa-hand-sparkles"],
  ["instinct", "Instinct", "fa-solid fa-eye"],
  ["presence", "Presence", "fa-solid fa-masks-theater"],
  ["knowledge", "Knowledge", "fa-solid fa-book-open"],
];

export const ITEM_TYPE_ORDER = ["weapon", "armor", "consumable", "loot"];

export const HUD_THEMES = [
  ["daggerheart", "DQP.Theme.Daggerheart"],
  ["minimal", "DQP.Theme.Minimal"],
  ["arcane", "DQP.Theme.Arcane"],
  ["sacred", "DQP.Theme.Sacred"],
  ["monochrome", "DQP.Theme.Monochrome"],
];

export const HUD_PLACEMENTS = [
  ["center", "DQP.Placement.Center", "fa-solid fa-arrows-to-circle"],
  ["side", "DQP.Placement.Side", "fa-solid fa-align-left"],
];


export const HUD_LANGUAGES = [
  ["auto", "DQP.Language.Auto"],
  ["en", "DQP.Language.English"],
  ["ru", "DQP.Language.Russian"],
];
export function localize(key, data) {
  return data ? game.i18n.format(key, data) : game.i18n.localize(key);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value.values === "function") return Array.from(value.values());
  return Array.from(value);
}

export function hasRussianDaggerheartTranslation() {
  return asArray(game.modules).some((module) => {
    if (!module?.active) return false;
    const manifest = module.toObject?.() ?? module;
    const identity = [manifest.id, manifest.title, manifest.description].filter(Boolean).join(" ").toLowerCase();
    const systems = asArray(manifest.relationships?.systems).map((system) => system?.id ?? system);
    const targetsDaggerheart = systems.includes("daggerheart") || identity.includes("daggerheart");
    const declaresRussian = asArray(manifest.languages).some((language) =>
      String(language?.lang ?? language?.id ?? language).toLowerCase().startsWith("ru")
    );
    const looksRussian = /(?:russian|русск|перевод|(?:^|[-_.\s])ru(?:$|[-_.\s]))/iu.test(identity);
    return targetsDaggerheart && (declaresRussian || looksRussian);
  });
}

export function escapeHTML(value) {
  const element = document.createElement("span");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

export function changePaths(value, prefix = "") {
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
export function installStressOverflowCostRule() {
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

export function plainText(html, max = 180) {
  const holder = document.createElement("template");
  holder.innerHTML = html || "";
  holder.content.querySelectorAll("script, style").forEach((node) => node.remove());
  holder.content.querySelectorAll("p, div, li, br, h1, h2, h3, h4").forEach((node) => node.append(document.createTextNode("\n")));
  const text = (holder.content.textContent || "").replace(/[\t ]+/g, " ").replace(/\n\s*\n/g, "\n\n").trim();
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

