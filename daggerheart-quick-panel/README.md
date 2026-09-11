# Daggerheart Character Ribbon

A separate Foundry VTT 14 module for Daggerheart 2.9.2+. Version 0.18.0-draft.6 supports Foundry VTT 14 build 361 and later, previews a wider HUD with centered and left-side layouts plus native chat clearance. This is a draft: keep the stable 0.17.0 archive for rollback. The interface includes complete English and Russian localization, including automatic detection of active Russian Daggerheart translation modules and a manual per-player language override.

Install from Foundry's **Add-on Modules → Install Module → Manifest URL** using `https://raw.githubusercontent.com/nikitagermanovicius100-hub/daggerpanelll/main/daggerheart-quick-panel/module.json`.

- The magnifier beside the portrait opens smaller / reset / larger controls (75–125%, 5% steps). 100% preserves the original layout. This client-local preference is available to players and GMs, persists across reloads and does not change anyone else's HUD. Adjustments do not rerender the HUD or update actor documents.
- The same magnifier menu switches between Centered HUD and Side HUD. Centered is the default; Side anchors the portrait and ribbons to the lower-left safe margin. Placement is client-local, persists across reloads and changes without rebuilding the HUD.
- The palette beside the portrait switches between Daggerheart, Minimal Duo, Dark Arcane, Sacred Light and Monochrome. Theme choice is client-local, persists across reloads and changes the palette, surfaces, corners and glow without rebuilding the HUD or altering actor data.
- The scale controls fade out 1 second after the pointer leaves the magnifier and its popup; returning the pointer cancels the timeout, including during the fade.
- Armor Slots use the same direct segmented interaction as Hit Points. They call Daggerheart's native updateArmorValue flow, while the upper defense summary shows only the maximum Armor value to avoid duplicating current/max.
- Loadout shows current/maximum capacity using Daggerheart's configured world limit plus the character's loadout bonus. Domain cards can move between Loadout and Vault either by dragging the card or using its arrow control. Recalling delegates to Daggerheart's native toggleVault flow, including its configured recall cost and capacity checks. A full Loadout rejects the drop with a specific explanation.
- Action cards show a compact resource-cost badge. The hover description expands it into readable text and previews Stress overflow into a Hit Point before the action is confirmed. Vault cards show their recall price, including free recalls.
- After a Domain Card action completes successfully, a card with recallCost greater than zero is sent to Vault automatically. Free cards stay in Loadout, cancelled or failed actions do not move, and cards already moved by their own action are not moved twice.
- Successful actions pulse briefly, transferred cards slide into their destination, and only resource segments whose state changed animate. Reduced-motion preferences disable these effects.
- HP, Stress, Hope, Armor, item charges/quantity and Loadout/Vault changes patch their existing DOM nodes. Full HUD renders are reserved for structural changes, reducing visible flashes and stale-card micro-lag.
- Foundry's connected-player panel is positioned above the full HUD height. Its toggle lives inside Foundry's own performance toolbar so it remains clickable, completely hides or restores the panel, and remembers that choice for the current client.
- Foundry's native quick-chat column is lifted above the visible HUD with a small gap. It remains the original chat input, preserves normal typing and lowers again as HUD rows are hidden.
- When Foundry uses Russian, the module loads its complete Russian HUD dictionary automatically. Daggerheart document names and native dialogs continue to use the active Daggerheart localization module.
- Collapsed Equipment, Loadout, Vault, action, feature and gear categories use distinct icon badges with their category name and count below.
- Equipment follows the sheet: unarmed attack when applicable, primary and secondary weapons, then other equipped usable items in native order. Passive armor is not listed as a weapon; armor slots remain in Core and armor remains manageable in Gear.
- Features uses the native sheet's feature-context preparation without opening the sheet: ancestry, community, class/subclass, multiclass, transformations, companion and remaining features retain the native titles, ordering and availability rules.

## Layout

Centered mode places the entire HUD (portrait, controls and three bands) on the physical screen center along its bottom edge with an 18 px margin. Side mode places the same HUD at the lower-left safe margin and lets it expand toward the right. The floating native chat composer moves above either HUD instead of narrowing it. The expanded right sidebar still limits available width. Sidebar changes and window resizing update the fit without rebuilding the HUD. Descriptions stay inside the corresponding safe area.

At the default 100% scale, the bands measure up to 1240 × 208 px, plus the portrait and controls. The three rows measure 64, 38, and 98 px, separated by 4 px gaps. Bands narrow as space decreases; below 820 px they use compact trait labels with full tooltips. If the selected scale cannot fit, the displayed size temporarily adapts to the available width without changing the player's saved preference. The eye button follows the portrait. All themes and independent layer controls remain available.

- Core: name/class/domains, then defense stats and editable armor slots, then directly editable segmented HP/Stress/Hope with damage thresholds underneath.
- Traits: six decorated, directly clickable compact buttons in a single row, with secondary rest icons.
- Toolkit: 27 px tabs, quiet group labels above 125 × 48 px item cards, and horizontal scrolling. Card names can wrap to two lines; full names and descriptions remain in hover previews. Play includes Equipment, Loadout and Vault. Loadout has a warm gold backdrop; Vault has a violet backdrop. Both card groups stay visible when empty.
- Portrait: opens the native sheet; the smaller level badge opens native advancement. The name selector beneath it switches between owned characters (all characters for a GM), including those without tokens.
- Each row's right arrow fully hides that row. Three vertically arranged icon buttons immediately right of the portrait independently restore or hide the rows, even when all rows are hidden. The remaining stack stays bottom-aligned. Reveal animations take 240 ms, reverse smoothly on repeated toggles, and respect reduced-motion preferences. Hidden rows are inert.
- Weapon and armor cards have a shirt icon: gold means equipped; click to equip or unequip. This calls the native character sheet toggleEquipItem action, retaining armor replacement, weapon burden and beastform rules. Item usage stays on the main card; the ellipsis still opens details.
- Existing client-scoped settings under daggerheart-quick-panel preserve the selected actor and the three visibility states.
- Features (formerly Library) contains only character features. Vault remains in Play alongside Loadout.
- Experiences is a separate read-only HUD list of entries already created on the character sheet. Hover for the description; click a card for its full name, bonus and description with Send to chat / Close choices. Only explicit confirmation creates a chat card with the original actor as speaker. Closing or cancelling does not post anything.
- Hover or focus an item to read its full description in a styled scrollable card. Move into the card to read/scroll it; Escape dismisses it. Descriptions are converted to inert plain text, preserving paragraphs. Tabs, actor switches and rerenders remove stale previews.
- The macro hotbar stays hidden while the HUD is active.
- The GM HUD toggle supports Foundry 14 build 361's keyed Scene Controls and is registered before the controls are prepared, while retaining the earlier array-shaped compatibility path.

## Preserved integrations

The existing delegated click/contextmenu listeners, data-action selectors, ownership filter, resource paths, render scheduling and action locks remain in use. Item hover cards replace the former truncated native item tooltip; other button tooltips remain native.

- Actor#rollTrait receives the selected trait and original event.
- Item#use receives the original event.
- Downtime, CharacterLevelup, and actor/item sheets remain native Daggerheart applications.
- setResource still updates the existing actor resource/armor paths, including permission checks.
- updateActor and item lifecycle hooks keep the display synchronized.

Experiences editing uses game.system.api.applications.sheetConfigs.CharacterSettings; no parallel experience storage or custom experience bonus rules are introduced.

## Current limitations

Drag-and-drop is intentionally limited to Domain Cards moving between Loadout and Vault; other inventory organization remains on the native character sheet. Right-click and the ellipsis open that native item sheet. Native action availability and dialogs depend on the installed Daggerheart API. Domain names are derived from existing domain cards, as in previous versions.

## Verification

Run node tests/verify.mjs for manifest, localization and integration checks. Run node tests/layout.mjs for an isolated Chromium test using the actual module templates, controller, Foundry stylesheet and stub actor API. FOUNDRY_APP, PLAYWRIGHT_PATH and CHROME_PATH can override local test dependencies.

The layout test renders and captures all five themes, then exercises all eight layer-visibility combinations at 1920, 1440 and 1366 px; checks horizontal and vertical overflow; verifies trait clicks, tabs, item/context actions, rests, HP/armor paths, cost previews, resource-only DOM patching, Loadout/Vault drag-and-drop and limits, revoked ownership, actor selection, hover previews, native equip-action handoffs, animation reversals, reduced motion and retained state after rerender. Screenshots are written to tests/output. It does not roll dice or alter actors in a live world.

Draft layout checks also cover both persistent placement modes and a right-side native quick-chat fixture at 1920, 1366 and 1024 px, each at 75%, 100% and 125%. They verify the wider centered layout, left-side anchoring, vertical chat clearance, typing in chat, retention of the requested scale, and sidebar resizing without a HUD rebuild. Static verification requires exact English/Russian key and placeholder parity.

## Installation

Copy this module's module.json, scripts, styles, templates, lang and README.md into Data/modules/daggerheart-quick-panel. Enable Daggerheart Quick Panel in a Daggerheart world and reload the client. To roll back this draft, extract daggerheart-quick-panel-0.17.0.zip over the module directory and restart Foundry/reload clients. No actor data migration is required.
