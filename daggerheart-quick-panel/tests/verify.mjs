import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const json = (relative) => JSON.parse(read(relative));

const manifest = json("module.json");
const en = json("lang/en.json");
const ru = json("lang/ru.json");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function leafKeys(value, prefix = "") {
  return Object.entries(value).flatMap(([key, child]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    return child && typeof child === "object" ? leafKeys(child, next) : [next];
  });
}

assert(manifest.id === "daggerheart-quick-panel", "Unexpected module id");
assert(manifest.relationships.systems.some((system) => system.id === "daggerheart"), "Daggerheart relationship is missing");
assert(Number(manifest.compatibility.minimum.split(".")[1]) <= 361, "Foundry 14 build 361 must be allowed by the manifest");

for (const relative of [...manifest.esmodules, ...manifest.styles, ...manifest.languages.map((language) => language.path)]) {
  assert(fs.existsSync(path.join(root, relative)), `Missing manifest file: ${relative}`);
}

const enKeys = leafKeys(en).sort();
const ruKeys = leafKeys(ru).sort();
assert(manifest.languages.some((language) => language.lang === "en") && manifest.languages.some((language) => language.lang === "ru"), "English and Russian language packs must both be registered");
assert(JSON.stringify(ruKeys) === JSON.stringify(enKeys), "Russian localization must cover every English HUD key");

for (const key of enKeys) {
  const get = (value) => key.split(".").reduce((current, part) => current?.[part], value);
  const placeholders = (value) => [...String(value).matchAll(/\{\w+\}/g)].map((match) => match[0]).sort().join(",");
  assert(placeholders(get(en)) === placeholders(get(ru)), `Russian placeholders differ for ${key}`);
}

const sources = [
  read("scripts/helpers.js"),
  read("scripts/panel-base.js"),
  read("scripts/main.js"),
  read("templates/panel.hbs"),
  read("templates/partials/item-row.hbs"),
].join("\n");

const referencedKeys = new Set(Array.from(sources.matchAll(/["'](DQP\.[A-Za-z0-9.]+)["']/g), (match) => match[1]));
for (const key of referencedKeys) assert(enKeys.includes(key), `Missing localization key: ${key}`);

assert(!sources.includes("systems/daggerheart/"), "Runtime code must not patch or import Daggerheart system files");
assert(sources.includes("actor.rollTrait"), "Native trait roll integration is missing");
assert(sources.includes("item.use(event)"), "Native item action integration is missing");
assert(sources.includes("applications?.dialogs?.Downtime"), "Native downtime integration is missing");
assert(sources.includes("new CharacterLevelup(actor)"), "Native character advancement integration is missing");
assert(sources.includes('class="dqp-portrait-frame" data-action="open-sheet"'), "Portrait must open the character sheet");
assert(sources.includes('data-action="select-actor"'), "Portrait actor picker is missing");
assert(sources.includes('data-action="toggle-hud"') && sources.includes("chooseActorForHud"), "Persistent HUD toggle or actor prompt is missing");
assert(sources.includes("getSceneControlButtons") && sources.includes("dqp-toggle-hud") && sources.includes("game.user.isGM"), "GM HUD fallback control is missing");
assert(sources.includes("group.tools[tool.name]") && sources.includes("Array.isArray(group.tools)"), "Foundry 14 keyed Scene Controls compatibility is missing");
assert(sources.indexOf('Hooks.on("getSceneControlButtons"') < sources.indexOf('Hooks.once("ready"'), "Scene Controls hook must be registered before ready");
assert(sources.includes('data-action="toggle-group"'), "Collapsible item groups are missing");
assert(sources.includes("playGroups"), "Play tab item groups are missing");
assert(!sources.includes('type="search"'), "Gear search must not be present");
assert(read("styles/panel.css").includes("#hotbar"), "The Foundry macro hotbar replacement is missing");
assert(sources.includes('class="dqp-column dqp-column--character '), "Character column is missing");
assert(sources.includes('class="dqp-column dqp-column--traits '), "Traits and rest column is missing");
assert(sources.includes('class="dqp-column dqp-column--workspace '), "Play workspace column is missing");
assert(sources.includes('class="dqp-ribbon-scroll"'), "Inline horizontal ribbon is missing");
assert(sources.includes('data-action="toggle-column"'), "Independent column collapse controls are missing");
assert(!sources.includes("Verbs") && !sources.includes("{{verbs}}"), "Trait cards must contain only icon, name, and modifier");
assert(sources.includes('class="dqp-trait-emblem"') && sources.includes('class="dqp-trait-name"') && sources.includes('class="dqp-trait-value"'), "Ornamental trait card composition is missing");
assert(sources.includes('characterOpen') && sources.includes('traitsOpen') && sources.includes('workspaceOpen'), "Independent column state is missing");
assert(!sources.includes('data-action="close-panel"'), "A one-click close-all control must not be present");
assert(sources.includes('{{#each playGroups}}{{> inlineGroup}}'), "Play must preserve Equipment and Loadout groups");
assert(!sources.includes('data-action="edit-experiences"'), "Experiences must list existing entries without an add/edit shortcut");
assert(sources.includes('class="dqp-group-icon"'), "Collapsed category icons are missing");
assert(!sources.includes('data-action="adjust-resource"'), "Armor must use direct pips without plus/minus controls");
assert(sources.includes("actor.system.updateArmorValue"), "Armor pips must use Daggerheart's native armor update flow");
assert(sources.includes('data-action="toggle-vault"') && sources.includes("item.system.toggleVault"), "Native Vault transfer is missing");
assert(sources.includes("item.system.recallCost") && sources.includes("Boolean(result)"), "Paid cards must auto-vault only after successful use");
assert(sources.includes("installStressOverflowCostRule") && sources.includes("CostField.hasCost = hasCostWithStressOverflow"), "Stress overflow cost rule is missing");
assert(sources.includes("countLabel"), "Loadout current/maximum capacity is missing");
assert(sources.includes('draggable="true"') && sources.includes('data-drop-target="{{dropTarget}}"') && sources.includes("onDrop(event)"), "Loadout/Vault drag-and-drop is missing");
assert(sources.includes("itemCostPreview") && sources.includes('class="dqp-item-cost"') && sources.includes("dqp-hover-cost"), "Action and recall price previews are missing");
assert(sources.includes("patchActorUpdate") && sources.includes("patchItemUpdate"), "Incremental HUD update path is missing");
assert(read("styles/panel.css").includes("dqp-item-used") && read("styles/panel.css").includes("dqp-pip-mark"), "Action feedback animations are missing");
assert(sources.includes("HUD_THEMES") && sources.includes('data-action="set-theme"') && sources.includes("hudTheme"), "Personal HUD theme selector is missing");
assert(sources.includes("HUD_PLACEMENTS") && sources.includes('data-action="set-placement"') && sources.includes("hudPlacement"), "Personal centered/side HUD selector is missing");
assert(sources.includes("HUD_LANGUAGES") && sources.includes("hasRussianDaggerheartTranslation") && sources.includes("applyLanguage") && sources.includes("hudLanguage"), "HUD translation-module detection and personal language override are missing");
for (const theme of ["minimal", "arcane", "sacred", "monochrome"]) {
  assert(read("styles/panel.css").includes(`data-theme="${theme}"`), `Theme stylesheet is missing: ${theme}`);
}
for (const key of ["MissingItem", "CardInVault", "CardSuppressed", "InsufficientResource", "LoadoutFull", "TransferUnavailable", "ActionFailed"]) {
  assert(en.DQP.Warnings[key], `Clear error message is missing: ${key}`);
}
assert(sources.includes("dqp-players-toggle") && sources.includes("playersCollapsed"), "Collapsible connected-player panel is missing");
assert(read("styles/panel.css").includes("#ui-right #ui-right-column-1") && sources.includes("--dqp-chat-clearance"), "Native quick chat must clear the HUD vertically");
assert(read("styles/panel.css").includes("--dqp-hud-max: 1240px"), "Expanded HUD width is missing");
assert(sources.includes('data-column-panel="character"') && sources.includes('data-column-panel="traits"') && sources.includes('data-column-panel="workspace"'), "Fixed independent layer anchors are missing");
assert(!sources.includes("panelStage"), "Sequential stage state must not be used");
assert(read("styles/panel.css").includes("object-fit: contain"), "The full portrait image must remain visible");
assert(!sources.includes("dqp-detail-panel"), "Detached detail window must not be present");

console.log(`Verified ${manifest.title} ${manifest.version}: ${enKeys.length} English/Russian strings, native Daggerheart actions, no system patching.`);
