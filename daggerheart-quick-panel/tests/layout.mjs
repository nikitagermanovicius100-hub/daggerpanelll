import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const foundry = process.env.FOUNDRY_APP || 'C:/Program Files/Foundry Virtual Tabletop/resources/app';
const runtime = process.env.PLAYWRIGHT_PATH || `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright`;
const { chromium } = require(runtime);
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const runtimeSource = [
  read('scripts/helpers.js'),
  read('scripts/panel-base.js'),
  read('scripts/main.js'),
].map(source => source.replace(/^import .*?;\r?\n/gm, '').replace(/^export /gm, '')).join('\n');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const output = path.join(root, 'tests', 'output');
fs.mkdirSync(output, { recursive: true });
try {
  await page.setContent('<html><head></head><body style="margin:0;background:#34383c"><aside id="players"><ol id="players-inactive"></ol><div id="players-active"><ol class="players-list"><li class="player">GM</li><li class="player">Player</li></ol><div id="performance-stats"><span id="latency">7ms</span><span id="fps">60</span><button id="players-expand"></button></div></div></aside><div id="hotbar">Macros</div><div id="dqp-root"></div></body></html>');
  await page.addStyleTag({path:path.join(foundry,'public/css/foundry2.css')});
  await page.addScriptTag({ path: path.join(foundry, 'node_modules/handlebars/dist/handlebars.js') });
  const fa = fs.readFileSync(path.join(foundry, 'public/fonts/fontawesome/css/all.min.css'), 'utf8');
  const font = fs.readFileSync(path.join(foundry, 'public/fonts/fontawesome/webfonts/fa-solid-900.woff2')).toString('base64');
  await page.addStyleTag({ content: fa + `\n@font-face {font-family:'Font Awesome 7 Pro';font-style:normal;font-weight:900;src:url(data:font/woff2;base64,${font}) format('woff2');}` });
  await page.addStyleTag({ content: read('styles/panel.css') });
  await page.evaluate(({ source, template, partial, en, ru, portrait }) => {
    const get = (object, key) => key.split('.').reduce((value, part) => value?.[part], object);
    window.languagePacks={en,ru};
    const settings = new Map([...['hudEnabled', 'characterOpen', 'traitsOpen', 'workspaceOpen'].map(key => [key, true]), ['hudPlacement', 'center'], ['hudLanguage', 'auto']]);
    window.calls = [];
    const item = { id:'a1', name:'Deft Maneuvers', type:'domainCard', img:portrait, system:{ actionsList:[{cost:[{key:'stress',value:2,enabled:true}]}], domainLabel:'Bone', level:1, description:'A ready ability.', async toggleVault(_event,toVault,isRecall){calls.push(`vault:${toVault}:${isRecall}`);this.inVault=toVault;} }, use:async () => calls.push('item'), sheet:{render:() => calls.push('item-sheet')} };
    const items = Array.from({length:6}, (_, index) => ({...item, id:`a${index+1}`, name:index ? `Ability ${index+1}` : item.name, system:{...item.system,inVault:index>=3}}));
    items.push({...item,id:'f1',name:'Battle Ready',type:'feature'});
    items.get = id => items.find(item => item.id === id);
    window.actor = { id:'test', type:'character', name:'Vale', img:portrait, isOwner:true, items, system:{
      class:{value:{name:'Brawler'},subclass:{name:'Martial Artist'}}, level:1,
      resources:{ hitPoints:{value:4,max:6},stress:{value:3,max:6},hope:{value:5,max:6} },
      armorScore:{value:1,max:3},updateArmorValue:async change=>calls.push({armorDelta:change.value}),evasion:11,proficiency:1,damageThresholds:{major:7,severe:14},
      traits:Object.fromEntries(['agility','strength','finesse','instinct','presence','knowledge'].map((key,index) => [key,{value:[1,1,0,2,0,-1][index]}])),
      experiences:{e1:{name:'Streetwise',value:2,description:'You know the hidden paths through the city.'}}
    }, rollTrait:async trait => calls.push(`trait:${trait}`), update:async update => calls.push(update), sheet:{render:() => calls.push('sheet')} };
    class Downtime {
      constructor(actor,short) { this.short=short; }
      render() { calls.push(this.short?'short-rest':'long-rest'); }
    }
    class CharacterSettings {
      constructor({document}) { calls.push(`experience-editor:${document.id}`); }
      async render() {}
      changeTab(tab,group) { calls.push(`experience-tab:${group}:${tab}`); }
    }
    const CostField = {
      getRealCosts(costs) { return costs.filter(cost => cost.enabled !== false).map(cost => ({...cost})); },
      hasCost(costs) {
        const resources = actor.system.resources;
        return CostField.getRealCosts(costs).every(cost => {
          const resource = resources[cost.key];
          if (!resource) return true;
          const amount = Number(cost.total ?? cost.value ?? 0);
          return resource.isReversed ? resource.value + amount <= resource.max : resource.value >= amount;
        });
      }
    };
    actor.system.resources.stress.isReversed = true;
    actor.system.resources.hitPoints.isReversed = true;
    window.game = {
      system:{id:'daggerheart',api:{applications:{dialogs:{Downtime},sheetConfigs:{CharacterSettings}},fields:{ActionFields:{CostField}}}},
      user:{isGM:false,character:actor}, actors:[actor], modules:new Map(),
      i18n:{lang:'en',translations:structuredClone(en),localize:key => get(game.i18n.translations,key) || key,format:(key,data) => (get(game.i18n.translations,key)||key).replace(/\{(\w+)\}/g,(_,k)=>data[k])},
      settings:{get:(_,key)=>settings.get(key),set:async (_,key,value)=>settings.set(key,value)}
    };
    window.Hooks={once:()=>{},on:()=>{}};
    window.ui={notifications:{warn:message=>calls.push(`warn:${message}`),error:message=>{throw new Error(message);},info:()=>{}}};
    Handlebars.registerHelper('localize',key=>game.i18n.localize(key));
    Handlebars.registerPartial('modules/daggerheart-quick-panel/templates/partials/item-row.hbs',partial);
    window.chatMessages=[];
    window.confirmAnswer=false;
    window.actorPromptSelection=null;
    window.actorPromptCount=0;
    window.CONFIG={ChatMessage:{documentClass:{getSpeaker:({actor})=>({actor:actor.id,alias:actor.name}),create:async data=>chatMessages.push(data)}}};
    window.foundry={utils:{getProperty:get,deepClone:value=>structuredClone(value)},applications:{api:{DialogV2:{confirm:async options=>{window.lastConfirmation=options;return window.confirmAnswer;},prompt:async options=>{window.lastActorPrompt=options;window.actorPromptCount++;return window.actorPromptSelection;}}},handlebars:{renderTemplate:async(_,context)=>Handlebars.compile(template)(context)}}};
    window.fetch=async url=>({ok:true,status:200,json:async()=>structuredClone(String(url).includes('/ru.json')?ru:en)});
    (0,eval)(source+'\nwindow.TestPanel = DaggerheartQuickPanel; window.installStressOverflowCostRule = installStressOverflowCostRule;');
    const costContext = {actor};
    actor.system.resources.stress.value = 5;
    if (CostField.hasCost.call(costContext,[{key:'stress',value:2,total:2,enabled:true}])) throw new Error('Native mock must reject 5/6 Stress + 2');
    installStressOverflowCostRule();
    if (!CostField.hasCost.call(costContext,[{key:'stress',value:2,total:2,enabled:true}])) throw new Error('Stress overflow cost must be allowed');
    if (CostField.hasCost.call(costContext,[{key:'stress',value:2,total:2,enabled:true},{key:'hope',value:6,total:6,enabled:true}])) throw new Error('Stress overflow must not waive other resource costs');
    actor.system.resources.stress.value = 3;
    window.panel = new TestPanel();
    panel.root=document.querySelector('#dqp-root');
    panel.bindEvents();
    document.body.classList.add('dqp-bottom-hud-active');
    panel.setupPlayersPanel();
    window.testSettings=settings;
    return panel.render();
  }, {source:runtimeSource,template:read('templates/panel.hbs'),partial:read('templates/partials/item-row.hbs'),en:JSON.parse(read('lang/en.json')),ru:JSON.parse(read('lang/ru.json')),portrait:'data:image/svg+xml;base64,'+fs.readFileSync(path.join(foundry,'public/icons/svg/mystery-man.svg')).toString('base64')});

  assert.equal(await page.locator('.dqp-hud-toggle').isVisible(),true);
  assert.equal(await page.locator('.dqp-shell').count(),1);
  assert.equal(await page.locator('#hotbar').evaluate(el=>getComputedStyle(el).display),'none');
  await page.locator('.dqp-hud-toggle').click();
  assert.equal(await page.evaluate(()=>testSettings.get('hudEnabled')),false);
  assert.equal(await page.locator('.dqp-shell').count(),0);
  assert.equal(await page.locator('.dqp-hud-toggle').isVisible(),true);
  assert.notEqual(await page.locator('#hotbar').evaluate(el=>getComputedStyle(el).display),'none');
  await page.evaluate(() => {
    const second={...actor,id:'test2',name:'Nyx',items:actor.items,system:actor.system,sheet:actor.sheet};
    game.actors.push(second);
    window.actorPromptSelection='test2';
  });
  await page.locator('.dqp-hud-toggle').click();
  assert.equal(await page.evaluate(()=>testSettings.get('hudEnabled')),true);
  assert.equal(await page.evaluate(()=>testSettings.get('selectedActorId')),'test2');
  assert.equal(await page.evaluate(()=>actorPromptCount),1);
  assert.equal(await page.locator('.dqp-shell').count(),1);
  await page.evaluate(async()=>{game.actors.pop();await game.settings.set('','selectedActorId','test');return panel.render();});

  assert.equal(await page.locator('[data-group-key="play-loadout"] .dqp-item-row').count(),3);
  assert.equal(await page.locator('[data-group-key="play-vault"] .dqp-item-row').count(),3);
  assert.equal(await page.locator('[data-group-key="play-loadout"] .dqp-inline-group-heading small').textContent(),'3/5');
  assert((await page.locator('[data-group-key="play-loadout"] [data-item-id="a1"] .dqp-item-cost').textContent()).includes('⚡2'));
  // Five client-local themes switch in place and preserve the HUD DOM.
  await page.evaluate(()=>{window.themeHud=document.querySelector('.dqp-columns');});
  const themeSurfaces=[];
  for (const theme of ['daggerheart','minimal','arcane','sacred','monochrome']) {
    if (theme !== 'daggerheart') {
      await page.locator('[data-action="toggle-theme"]').click();
      assert.equal(await page.locator('.dqp-theme-choice').count(),5);
      await page.locator(`.dqp-theme-choice[data-theme="${theme}"]`).click();
      await page.waitForFunction(theme=>document.querySelector('#dqp-root')?.dataset.theme===theme,theme);
    }
    assert.equal(await page.locator('#dqp-root').getAttribute('data-theme'),theme);
    assert(await page.evaluate(()=>themeHud===document.querySelector('.dqp-columns')),'Theme switch must preserve the HUD DOM');
    themeSurfaces.push(await page.locator('#dqp-root').evaluate(el=>getComputedStyle(el).getPropertyValue('--dqp-panel').trim()));
    await page.locator('.dqp-shell').screenshot({path:path.join(output,`theme-${theme}.png`)});
  }
  assert.equal(new Set(themeSurfaces).size,5,'Every theme must expose a distinct panel palette');
  await page.locator('[data-action="toggle-theme"]').click();
  await page.locator('.dqp-theme-choice[data-theme="daggerheart"]').click();
  assert.equal(await page.evaluate(()=>testSettings.get('hudTheme')),'daggerheart');
  // Placement is client-local and switches between screen center and a left-side dock without rebuilding.
  await page.evaluate(()=>{window.placementHud=document.querySelector('.dqp-columns');});
  await page.locator('[data-action="toggle-scale"]').click();
  await page.locator('[data-placement="side"]').click();
  assert.equal(await page.locator('#dqp-root').getAttribute('data-placement'),'side');
  assert(Math.abs(await page.locator('.dqp-shell').evaluate(el=>el.getBoundingClientRect().left)-18)<2,'Side HUD must anchor to the left safe margin');
  assert(await page.evaluate(()=>placementHud===document.querySelector('.dqp-columns')),'Placement switch must preserve the HUD DOM');
  await page.screenshot({path:path.join(output,'placement-side.png')});
  await page.locator('[data-placement="center"]').click();
  assert.equal(await page.locator('#dqp-root').getAttribute('data-placement'),'center');
  assert(Math.abs(await page.locator('.dqp-shell').evaluate(el=>(el.getBoundingClientRect().left+el.getBoundingClientRect().right)/2)-960)<2,'Centered HUD must return to screen center');
  await page.locator('[data-action="toggle-scale"]').click();
  // Resource-only updates patch the existing HUD, animate only changed pips, and refresh price previews.
  await page.evaluate(()=>{
    window.originalHud=document.querySelector('.dqp-columns');
    actor.system.resources.stress.value=5;
    if(!panel.patchActorUpdate(actor,{system:{resources:{stress:{value:5}}}})) throw new Error('Stress update was not patched');
  });
  assert.equal(await page.locator('.dqp-resource--stress .dqp-resource-label strong').textContent(),'5/6');
  assert.equal(await page.locator('.dqp-resource--stress .dqp-pip.is-marked').count(),2);
  assert((await page.locator('[data-item-id="a1"] .dqp-item-cost').first().textContent()).includes('→♥1'));
  assert(await page.evaluate(()=>originalHud===document.querySelector('.dqp-columns')),'Resource patch must preserve the HUD DOM');
  await page.evaluate(()=>{
    actor.system.resources.stress.value=3;
    panel.patchActorUpdate(actor,{system:{resources:{stress:{value:3}}}});
  });
  // Cards move between Vault and Loadout in place, with capacity feedback instead of a full rerender.
  await page.evaluate(()=>{
    window.draggedCard=document.querySelector('[data-group-key="play-vault"] [data-item-id="a4"]');
    const target=document.querySelector('[data-group-key="play-loadout"]');
    const dataTransfer=new DataTransfer();
    draggedCard.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer}));
    target.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer}));
    target.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer}));
  });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>calls.at(-1)),'vault:false:true');
  assert.equal(await page.locator('[data-group-key="play-loadout"] .dqp-inline-group-heading small').textContent(),'4/5');
  assert(await page.evaluate(()=>draggedCard===document.querySelector('[data-group-key="play-loadout"] [data-item-id="a4"]')),'Vault move must preserve the card DOM');
  await page.evaluate(()=>{
    const target=document.querySelector('[data-group-key="play-vault"]');
    const dataTransfer=new DataTransfer();
    draggedCard.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer}));
    target.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer}));
    target.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer}));
  });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>calls.at(-1)),'vault:true:false');
  assert.equal(await page.locator('[data-group-key="play-loadout"] .dqp-inline-group-heading small').textContent(),'3/5');
  await page.evaluate(async()=>{
    actor.items.get('a4').system.inVault=false;
    actor.items.get('a5').system.inVault=false;
    await panel.render();
  });
  await page.evaluate(()=>{
    const card=document.querySelector('[data-group-key="play-vault"] [data-item-id="a6"]');
    const target=document.querySelector('[data-group-key="play-loadout"]');
    const dataTransfer=new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer}));
    target.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer}));
    target.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer}));
  });
  await page.waitForTimeout(50);
  assert((await page.evaluate(()=>calls.at(-1))).includes('Loadout is full (5 cards)'));
  assert.equal(await page.locator('[data-group-key="play-vault"] .dqp-item-row[data-item-id="a6"]').count(),1);
  await page.evaluate(async()=>{
    actor.items.get('a4').system.inVault=true;
    actor.items.get('a5').system.inVault=true;
    calls.length=0;
    await panel.render();
  });
  assert.equal(await page.locator('.dqp-players-toggle span').textContent(),'2');
  assert.equal(await page.locator('#players').evaluate(el=>getComputedStyle(el).bottom),'238px');
  await page.locator('.dqp-players-toggle').click();
  assert.equal(await page.locator('#players').evaluate(el=>el.classList.contains('dqp-players-collapsed')),true);
  assert.equal(await page.locator('#players-active > .players-list').evaluate(el=>getComputedStyle(el).display),'none');
  assert.equal(await page.locator('.dqp-players-toggle').isVisible(),true);
  assert.equal(await page.evaluate(()=>testSettings.get('playersCollapsed')),true);
  await page.locator('.dqp-players-toggle').click();
  assert.equal(await page.locator('#players').evaluate(el=>el.classList.contains('dqp-players-collapsed')),false);
  // Scaling is client-local and does not rebuild the HUD or modify actor data.
  for (const width of [1920, 1366]) {
    await page.setViewportSize({width,height:1080});
    await page.locator('[data-action="toggle-scale"]').click();
    const original = await page.locator('.dqp-column--character').evaluate(el=>el.getBoundingClientRect().height);
    await page.evaluate(()=>{window.originalHud=document.querySelector('.dqp-columns');});
    for (let i=0;i<5;i++) await page.locator('[data-scale="5"]').click();
    assert.equal(await page.locator('.dqp-column--character').evaluate(el=>el.getBoundingClientRect().height),original*1.25);
    assert(await page.locator('.dqp-shell').evaluate(el=>el.getBoundingClientRect().right<innerWidth),`Scaled HUD offscreen at ${width}`);
    assert(await page.evaluate(()=>originalHud===document.querySelector('.dqp-columns')));
    for (let i=0;i<10;i++) await page.locator('[data-scale="-5"]').click();
    assert.equal(await page.locator('.dqp-column--character').evaluate(el=>el.getBoundingClientRect().height),original*.75);
    await page.locator('[data-scale="reset"]').click();
    assert.equal(await page.evaluate(()=>testSettings.get('hudScale')),100);
    await page.locator('[data-action="toggle-scale"]').click();
  }
  for (const width of [1920,1440,1366]) {
    await page.setViewportSize({width,height:1080});
    for (let mask=0;mask<8;mask++) {
      await page.evaluate(async mask => {
        for (const [index,key] of ['character','traits','workspace'].entries()) {
          const open = !(mask & (1<<index));
          if(game.settings.get('',`${key}Open`)!==open) await panel.toggleColumn(key);
        }
      },mask);
      await page.waitForTimeout(280);
      await page.evaluate(()=>Promise.all([...panel.columnAnimations.values()].map(animation=>animation.finished.catch(()=>{}))));
      const result=await page.evaluate(()=>{
        const rect=selector=>document.querySelector(selector).getBoundingClientRect().toJSON();
        const overflow=Array.from(document.querySelectorAll('.dqp-character-body,.dqp-character-identity,.dqp-traits-body,.dqp-trait,.dqp-trait-name,.dqp-defense,.dqp-resource-label')).filter(el=>getComputedStyle(el).visibility!=='hidden' && el.getClientRects().length && (el.scrollWidth>el.clientWidth+1 || el.scrollHeight>el.clientHeight+1)).map(el=>el.className);
        return {stack:rect('.dqp-columns'),traits:Array.from(document.querySelectorAll('.dqp-trait')).map(el=>el.getBoundingClientRect().top),bars:Array.from(document.querySelectorAll('.dqp-column')).map(el=>el.getBoundingClientRect().height),overflow};
      });
      assert.equal(new Set(result.traits).size,1,`Traits wrap at ${width}/${mask}`);
      assert.deepEqual(result.overflow,[],`Content overflow at ${width}/${mask}`);
      assert(result.stack.right<width,`HUD offscreen at ${width}/${mask}`);
      assert.deepEqual(result.bars,[64,38,98].map((h,i)=>mask&(1<<i)?0:h));
      if(!mask) {
        assert.equal(result.stack.height,208);
        if(width===1920) assert(result.stack.width>=1239 && result.stack.width<=1241 && result.stack.width<width*.7);
        await page.locator('.dqp-shell').screenshot({path:path.join(output,`hud-${width}.png`)});
      }
    }
  }
  // Fully hidden layers restore from the portrait dock.
  for(const column of ['character','traits','workspace']) await page.locator(`.dqp-layer-dock [data-column="${column}"]`).click();
  await page.locator('[data-trait="agility"]').click();
  assert.deepEqual(await page.evaluate(()=>calls),['trait:agility']);
  await page.locator('[data-tab="core"]').click();
  await page.waitForTimeout(220);
  assert.equal(await page.evaluate(()=>game.settings.get('','workspaceOpen')),true);
  await page.locator('[data-action="use-item"]').first().click();
  await page.locator('.dqp-item-row').first().click({button:'right'});
  await page.waitForTimeout(220);
  await page.locator('[data-rest="short"]').click();
  await page.locator('[data-rest="long"]').click();
  await page.locator('[data-path="system.resources.hitPoints.value"][data-value="2"]').click();
  await page.locator('[data-path="system.armorScore.value"][data-value="2"]').click();
  await page.locator('[data-action="open-sheet"]').click();
  const calls = await page.evaluate(()=>window.calls);
  assert.deepEqual(calls,['trait:agility','item','item-sheet','short-rest','long-rest',{'system.resources.hitPoints.value':2},{armorDelta:1},'sheet']);
  await page.evaluate(()=>{actor.isOwner=false;});
  await page.locator('[data-path="system.resources.hitPoints.value"][data-value="2"]').click();
  assert.deepEqual(await page.evaluate(()=>window.calls),calls,'Revoked ownership must block resource updates');
  await page.evaluate(()=>{actor.isOwner=true;});
  await page.locator('[data-tab="core"]').click();
  await page.evaluate(()=>{actor.items.get('a1').system.recallCost=1;});
  await page.locator('[data-group-key="play-loadout"] [data-item-id="a1"] [data-action="use-item"]').click();
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(()=>window.calls.slice(-2)),['item','vault:true:false']);
  assert.equal(await page.locator('[data-group-key="play-loadout"] .dqp-inline-group-heading small').textContent(),'2/5');
  await page.evaluate(()=>window.calls.splice(-2));
  await page.locator('[data-group-key="play-vault"] [data-item-id="a1"] [data-action="toggle-vault"]').click();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.calls.at(-1)),'vault:false:true');
  assert.equal(await page.locator('[data-group-key="play-loadout"] .dqp-inline-group-heading small').textContent(),'3/5');
  await page.evaluate(()=>window.calls.pop());
  for(const tab of ['actions','abilities','experiences','gear','core']) { await page.locator(`[data-tab="${tab}"]`).click(); assert.equal(await page.evaluate(()=>panel.activeTab),tab); }
  await page.locator('[data-tab="core"]').click();
  await page.locator('[data-preview-item]').first().hover();
  await page.waitForSelector('.dqp-hover-card');
  assert((await page.locator('.dqp-hover-card').innerText()).includes('A ready ability.'));
  assert((await page.locator('.dqp-hover-card').innerText()).includes('Cost: 2 Stress'));
  await page.locator('.dqp-hover-card').hover();
  assert(await page.locator('.dqp-hover-card').isVisible());
  await page.locator('.dqp-hover-card').focus();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.dqp-hover-card').count(),0);
  await page.locator('[data-tab="abilities"]').click();
  assert.equal(await page.locator('.dqp-item-row').count(),1);
  assert.equal(await page.locator('.dqp-item-row').getAttribute('data-item-id'),'f1');
  assert.equal(await page.locator('.dqp-experiences').count(),0);
  await page.locator('[data-tab="experiences"]').click();
  await page.locator('[data-preview-experience="e1"]').hover();
  await page.waitForSelector('.dqp-hover-card');
  assert((await page.locator('.dqp-hover-card').innerText()).includes('hidden paths'));
  await page.waitForTimeout(160);
  await page.screenshot({path:path.join(output,'experiences-preview.png')});
  await page.locator('[data-preview-experience="e1"]').click();
  assert.equal(await page.evaluate(()=>chatMessages.length),0,'Closing experience details must not post a message');
  const prompt=await page.evaluate(()=>lastConfirmation);
  assert(prompt.content.includes('hidden paths') && prompt.content.includes('Send this experience to chat?'));
  assert.equal(prompt.defaultYes,false);
  await page.evaluate(()=>{confirmAnswer=true;});
  await page.locator('[data-preview-experience="e1"]').click();
  const messages=await page.evaluate(()=>chatMessages);
  assert.equal(messages.length,1);
  assert.equal(messages[0].speaker.actor,'test');
  assert(messages[0].content.includes('Streetwise +2') && messages[0].content.includes('hidden paths'));
  assert(!messages[0].content.includes('Send this experience to chat?'));
  assert.equal(await page.locator('[data-action="edit-experiences"]').count(),0,'Experiences must show existing entries only');
  await page.evaluate(async()=>{
    actor.items.push({id:'w1',uuid:'Actor.test.Item.w1',name:'A finely crafted two-handed longsword',type:'weapon',img:actor.img,system:{equipped:false,actionsList:[{}],description:'A test weapon.'}});
    actor.sheet.document=actor;
    actor.sheet.options={actions:{toggleEquipItem:async function(event,target){
      if(this.document!==actor) throw new Error('Wrong native sheet context');
      calls.push(`equip:${target.closest('[data-item-uuid]').dataset.itemUuid}`);
      const weapon=actor.items.get('w1');
      weapon.system.equipped=!weapon.system.equipped;
    }}};
    await panel.render();
  });
  await page.locator('[data-tab="gear"]').click();
  await page.locator('[data-action="toggle-equip"]').click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('[data-action="toggle-equip"]').getAttribute('aria-pressed'),'true');
  await page.locator('.dqp-shell').screenshot({path:path.join(output,'gear-equip.png')});
  await page.locator('[data-action="toggle-equip"]').click();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('[data-action="toggle-equip"]').getAttribute('aria-pressed'),'false');
  assert.deepEqual(await page.evaluate(()=>window.calls.slice(-2)),['equip:Actor.test.Item.w1','equip:Actor.test.Item.w1']);
  await page.evaluate(async()=>{
    const template=actor.items.get('f1');
    actor.items.push({...template,id:'f2',name:'Ancestry feature'});
    actor.sheet._prepareFeaturesContext=async function(context){
      context.featureGroups=[
        {type:'ancestry',anchorItem:{id:'clank'},title:'Ancestry - Clank',values:[actor.items.get('f2')]},
        {type:'class',title:'Class - Brawler',values:[actor.items.get('f1')]},
        {type:'feature',title:'Features',values:[]},
      ];
    };
    const weapon=actor.items.get('w1');
    weapon.system.equipped=true;
    actor.items.push({...weapon,id:'secondary',name:'A secondary weapon',system:{...weapon.system,secondary:true}});
    actor.items.push({...weapon,id:'armor',type:'armor',usable:false});
    actor.items.push({...weapon,id:'usable',type:'loot',usable:true});
    await panel.render();
  });
  await page.locator('[data-tab="abilities"]').click();
  assert.deepEqual(await page.locator('.dqp-inline-group-heading strong').allTextContents(),['Ancestry - Clank','Class - Brawler','Features']);
  assert.deepEqual(await page.locator('.dqp-item-row').evaluateAll(rows=>rows.map(row=>row.dataset.itemId)),['f2','f1']);
  for (const heading of await page.locator('.dqp-inline-group-heading').all()) await heading.click();
  assert.equal(await page.locator('.dqp-inline-group.is-collapsed .dqp-group-icon i').count(),3);
  assert.deepEqual(await page.locator('.dqp-inline-group.is-collapsed > .dqp-inline-group-heading strong').allTextContents(),['Ancestry - Clank','Class - Brawler','Features']);
  await page.locator('[data-tab="core"]').click();
  assert.deepEqual(await page.locator('[data-group-key="play-equipment"] .dqp-item-row').evaluateAll(rows=>rows.map(row=>row.dataset.itemId)),['w1','secondary','usable']);
  await page.evaluate(async()=>{
    actor.system.usesUnarmed=true;
    actor.system.attack={name:'Unarmed',img:actor.img,_getLabels:['Melee'],use:async()=>calls.push('unarmed')};
    await panel.render();
  });
  await page.locator('[data-action="use-unarmed"]').click();
  assert.equal(await page.evaluate(()=>calls.at(-1)),'unarmed');
  await page.locator('[data-action="toggle-scale"]').click();
  await page.locator('[data-scale="5"]').click();
  await page.locator('.dqp-shell').screenshot({path:path.join(output,'scale-and-equipment.png')});
  await page.locator('.dqp-scale-wrap').dispatchEvent('pointerout',{relatedTarget:null});
  await page.waitForFunction(()=>{const el=document.querySelector('.dqp-scale-controls');return el?.classList.contains('is-hiding')||el?.hidden;},null,{timeout:1500});
  assert.equal(await page.locator('.dqp-scale-controls').evaluate(el=>el.classList.contains('is-hiding')||el.hidden),true,'Scale menu must enter its fade/hide sequence');
  await page.waitForTimeout(220);
  assert.equal(await page.locator('.dqp-scale-controls').evaluate(el=>el.hidden),true,'Scale menu must close after pointer leaves');
  await page.evaluate(()=>panel.render());
  assert.equal(await page.locator('[data-scale="reset"]').textContent(),'105%');
  await page.evaluate(async()=>{await game.settings.set('','hudScale',100);panel.applyScale();});
  await page.evaluate(async()=>{await panel.toggleColumn('traits');await panel.toggleColumn('traits');await Promise.all([...panel.columnAnimations.values()].map(a=>a.finished.catch(()=>{})));});
  assert.equal(await page.locator('.dqp-column--traits').isVisible(),true);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(async()=>{await panel.toggleColumn('traits');await panel.toggleColumn('traits');});
  assert.equal(await page.evaluate(()=>panel.columnAnimations.size),0);
  await page.evaluate(async()=>{
    game.actors.push({...actor,id:'second',name:'Rowan'});
    game.actors.push({...actor,id:'private',name:'Private',isOwner:false});
    await panel.render();
  });
  assert.equal(await page.locator('[data-action="select-actor"] option').count(),2);
  await page.locator('[data-action="select-actor"]').selectOption('second');
  assert.equal(await page.evaluate(()=>panel.actor.id),'second');
  await page.evaluate(()=>panel.render());
  assert.equal(await page.locator('[data-action="select-actor"]').inputValue(),'second');
  await page.evaluate(async()=>{await panel.toggleColumn('traits'); await panel.render();});
  assert.equal(await page.locator('.dqp-column--traits').evaluate(el=>el.classList.contains('is-collapsed')),true);
  // Center the entire dock, lift native quick chat above it and only reserve
  // the actual sidebar controls on the right.
  await page.evaluate(async()=>{
    for (const key of ['character','traits','workspace']) await game.settings.set('',`${key}Open`,true);
    await panel.render();
    const uiRight=document.createElement('aside');
    uiRight.id='ui-right';
    uiRight.style.cssText='position:fixed;inset:0 0 0 auto;width:408px;height:100vh;transform:none;display:block;pointer-events:none;';
    uiRight.innerHTML='<div id="ui-right-column-1" style="position:absolute;inset:0 64px 0 auto;width:328px;height:100vh;padding:16px 0 14px;display:flex;flex-direction:column;pointer-events:none"><div id="chat-notifications" style="flex:1;order:99;display:grid;grid-template-rows:1fr 80px"><div class="overflow"></div><textarea id="chat-message" class="chat-input" aria-label="Test native chat" style="width:328px;height:80px;pointer-events:auto"></textarea></div></div><nav id="sidebar" style="position:absolute;inset:0 0 0 auto;width:48px;height:100vh;background:#171421;pointer-events:auto"></nav>';
    document.body.append(uiRight);
    panel.observeLayout();
  });
  for (const width of [1920,1366,1024]) {
    await page.setViewportSize({width,height:900});
    for (const scale of [75,100,125]) {
      await page.evaluate(async scale=>{await game.settings.set('','hudScale',scale);panel.applyScale();},scale);
      const geometry=await page.evaluate(()=>({
        hud:document.querySelector('.dqp-shell').getBoundingClientRect().toJSON(),
        chat:document.querySelector('#chat-message').getBoundingClientRect().toJSON(),
        sidebar:document.querySelector('#sidebar').getBoundingClientRect().toJSON(),
      }));
      assert(geometry.hud.left>=17,`Dock left edge outside safe area at ${width}/${scale}`);
      assert(geometry.hud.right<=geometry.sidebar.left-17,`Dock overlaps sidebar at ${width}/${scale}`);
      assert(geometry.chat.bottom<=geometry.hud.top-12,`Quick chat is not above the HUD at ${width}/${scale}`);
      assert(Math.abs((geometry.hud.left+geometry.hud.right)/2-width/2)<2,`Dock is not screen-centered at ${width}/${scale}`);
      assert.equal(await page.evaluate(()=>testSettings.get('hudScale')),scale,'Auto-fit must preserve requested scale');
      await page.locator('[aria-label="Test native chat"]').fill(`Chat works at ${width}/${scale}`);
      assert.equal(await page.locator('[aria-label="Test native chat"]').inputValue(),`Chat works at ${width}/${scale}`);
    }
    await page.evaluate(async()=>{await game.settings.set('','hudScale',100);panel.applyScale();});
    if (width===1920) assert(await page.locator('.dqp-columns').evaluate(el=>el.getBoundingClientRect().width)>=1239,'HUD does not use the expanded 1240px band width');
    await page.screenshot({path:path.join(output,`centered-chat-${width}.png`)});
  }
  // Resizing/collapsing the native sidebar changes fit without moving the center or rebuilding the HUD.
  await page.evaluate(()=>{window.centeredHud=document.querySelector('.dqp-columns');document.querySelector('#sidebar').style.width='360px';});
  await page.waitForFunction(()=>Math.abs((document.querySelector('.dqp-shell').getBoundingClientRect().left+document.querySelector('.dqp-shell').getBoundingClientRect().right)/2-innerWidth/2)<2);
  assert(await page.evaluate(()=>centeredHud===document.querySelector('.dqp-columns')));
  await page.evaluate(()=>{document.querySelector('#ui-right').remove();panel.observeLayout();});
  // An active Russian Daggerheart translation module localizes this HUD even when Foundry itself stays English.
  await page.setViewportSize({width:1366,height:900});
  await page.evaluate(async()=>{
    game.i18n.lang='en';
    game.modules.set('daggerheart-ru',{id:'daggerheart-ru',title:'Русский перевод Daggerheart',active:true,relationships:{systems:[{id:'daggerheart'}]}});
    await panel.applyLanguage(false);
    await panel.render();
  });
  assert.equal(await page.evaluate(()=>game.i18n.lang),'en');
  assert.equal(await page.evaluate(()=>panel.activeLanguage),'ru');
  assert.equal((await page.locator('[data-tab="core"]').textContent()).trim(),'Игра');
  assert.equal((await page.locator('[data-tab="experiences"]').textContent()).trim(),'Опыт');
  assert.equal(await page.locator('[data-action="toggle-scale"]').getAttribute('aria-label'),'Масштаб HUD');
  const russianOverflow=await page.evaluate(()=>Array.from(document.querySelectorAll('.dqp-character-body,.dqp-character-identity,.dqp-traits-body,.dqp-trait,.dqp-trait-name,.dqp-defense,.dqp-resource-label,.dqp-tabs')).filter(el=>getComputedStyle(el).visibility!=='hidden'&&el.getClientRects().length&&(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1)).map(el=>el.className));
  assert.deepEqual(russianOverflow,[],'Russian HUD labels must fit the tested layout');
  await page.screenshot({path:path.join(output,'localization-ru.png')});
  assert.deepEqual(errors,[]);
  console.log('PASS: five persistent HUD themes; centered/side placement; complete Russian render; 24 viewport/hidden-layer combinations; rolls, tabs, native item/rest calls, resource and armor bindings, permissions, hover cards, existing experiences, actor selector and persisted layer states.');
} finally { await browser.close(); }
