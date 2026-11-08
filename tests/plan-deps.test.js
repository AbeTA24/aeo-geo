// Valida el grafo del proyecto web: sin ciclos, sin IDs inexistentes,
// sin pasos huérfanos y con todas las fuentes definidas.
// Uso: node tests/plan-deps.test.js [ruta/al/index.html]
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = process.argv[2] || path.join(__dirname, '..', 'preview', 'index.html');
const html = fs.readFileSync(file, 'utf8');
const m = html.match(/\/\*WEBPLAN-START\*\/([\s\S]*?)\/\*WEBPLAN-END\*\//);
if (!m) { console.error('FAIL no encontré el bloque WEBPLAN en ' + file); process.exit(1); }

const ctx = {};
vm.createContext(ctx);
vm.runInContext(m[1] + '\nthis.__plan = { subprojects:WEB_SUBPROJECTS, missions:WEB_MISSIONS, gate:WEB_GATE, steps:WEB_STEPS, sources:SOURCES, costTable:COST_TABLE }; this.__validate = validateWebPlan;', ctx);
const plan = ctx.__plan;
const validate = ctx.__validate;
const clone = o => JSON.parse(JSON.stringify(o));

let failed = 0;
const check = (cond, msg, detail) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) { failed++; if (detail) console.log('     ' + [].concat(detail).join('\n     ')); }
};

// 1) El plan real no tiene errores
const errs = validate(plan);
check(errs.length === 0, 'el plan no tiene ciclos, IDs inexistentes, huérfanos ni fuentes faltantes', errs);

// 2) Conteos esperados del plan v2
check(plan.subprojects.length === 10, '10 subproyectos (S1–S10)');
check(plan.missions.length === 16, '16 misiones');
check(Object.keys(plan.steps).length === 48, '48 pasos');
check(plan.steps['S7.1'].requires.includes('GATE'), 'S7.1 (comprar el dominio) requiere la compuerta de gasto');
check(JSON.stringify(plan.gate.items.flatMap(i => i.ids)) === JSON.stringify(['S1.1','S1.5','S6.2','S6.4']), 'la compuerta pide S1.1, S1.5, S6.2 y S6.4');

// 3) "Desbloquea" derivado de "Requiere": cada arista aparece en ambos sentidos
const unlocks = {};
Object.keys(plan.steps).concat(['GATE']).forEach(id => { unlocks[id] = []; });
Object.entries(plan.steps).forEach(([id, s]) => s.requires.forEach(r => unlocks[r].push(id)));
plan.gate.items.flatMap(i => i.ids).forEach(r => unlocks[r].push('GATE'));
const asym = [];
Object.entries(unlocks).forEach(([id, us]) => us.forEach(u => {
  const reqs = u === 'GATE' ? plan.gate.items.flatMap(i => i.ids) : plan.steps[u].requires;
  if (!reqs.includes(id)) asym.push(id + ' → ' + u);
}));
check(asym.length === 0, '"desbloquea" y "requiere" no se contradicen', asym);

// 4) Todo paso de S7 depende (directa o indirectamente) de la compuerta
const reqsOf = id => id === 'GATE' ? plan.gate.items.flatMap(i => i.ids) : plan.steps[id].requires;
const dependsOn = (id, target, seen = new Set()) => reqsOf(id).some(r => r === target || (!seen.has(r) && (seen.add(r), dependsOn(r, target, seen))));
const s7 = Object.keys(plan.steps).filter(id => id.startsWith('S7.'));
const notGated = s7.filter(id => !dependsOn(id, 'GATE'));
check(notGated.length === 0, 'todos los pasos de S7 quedan detrás de la compuerta', notGated);

// 4b) Fase 4: todo paso tiene instrucciones y toda plantilla de "Empieza aquí" existe
const noBody = Object.keys(plan.steps).filter(id => !(plan.steps[id].body && plan.steps[id].body.steps && plan.steps[id].body.steps.length));
check(noBody.length === 0, 'los 48 pasos tienen instrucciones ("Qué hacer")', noBody);
const tplNames = new Set((html.match(/^  (\w+): \{\n    (html|csv): \(\) =>/gm) || []).map(x => x.trim().split(':')[0]));
const missingTpl = Object.entries(plan.steps).filter(([, s]) => s.start && (s.start.kind === 'doc' || s.start.kind === 'sheet') && !tplNames.has(s.start.template)).map(([id, s]) => id + ' → ' + s.start.template);
check(missingTpl.length === 0, 'cada documento de "Empieza aquí" tiene su plantilla (' + [...tplNames].join(', ') + ')', missingTpl);
const badStart = Object.entries(plan.steps).filter(([, s]) => s.start && ((s.start.kind === 'link' && !/^https:\/\//.test(s.start.url || '')) || (s.start.kind === 'copy' && !s.start.text))).map(([id]) => id);
check(badStart.length === 0, 'los enlaces son https y los "copiar" tienen texto', badStart);

// 5) El validador detecta lo que debe detectar
let p = clone(plan); p.steps['S1.2'].requires = ['S1.3'];
check(validate(p).some(e => e.startsWith('Ciclo')), 'detecta un ciclo (S1.2 ↔ S1.3)');
p = clone(plan); p.steps['S2.4'].requires = ['S2.9'];
check(validate(p).some(e => e.includes('inexistente: S2.9')), 'detecta un requisito inexistente');
p = clone(plan); p.missions[0].steps.push('S9.9');
check(validate(p).some(e => e.includes('paso inexistente S9.9')), 'detecta un paso inexistente en una misión');
p = clone(plan); p.steps['S1.3'].sources = ['F99'];
check(validate(p).some(e => e.includes('fuente inexistente F99')), 'detecta una fuente inexistente');
p = clone(plan); p.steps['S1.5'].body.steps.push('dato [[F98]]');
check(validate(p).some(e => e.includes('F98')), 'detecta una fuente inexistente citada dentro del texto');
p = clone(plan); p.missions[1].steps = [];
check(validate(p).some(e => e.includes('S1.5 no pertenece')), 'detecta un paso que no está en ninguna misión');

console.log(failed ? ('\n' + failed + ' prueba(s) fallaron') : '\nTodo en orden.');
process.exit(failed ? 1 : 0);
