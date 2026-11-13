import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function loadAppFromHtml() {
  const htmlPath = path.resolve(process.cwd(), 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'index.html doit contenir un bloc <script> inline');

  const noop = () => {};
  const createEl = () => ({
    classList: { add: noop, remove: noop, toggle: noop, contains: () => true },
    setAttribute: noop,
    addEventListener: noop,
    appendChild: noop,
    querySelectorAll: () => [],
    querySelector: () => ({ textContent: '', addEventListener: noop }),
    options: [{ value: 'tous' }],
    style: {},
    innerHTML: '',
    textContent: '',
    value: '',
    disabled: false,
    focus: noop
  });

  const sandbox: Record<string, unknown> = {
    Math,
    Date,
    Set,
    Map,
    Array,
    Object,
    String,
    Number,
    Boolean,
    JSON,
    URLSearchParams,
    parseInt,
    isNaN,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    document: {
      readyState: 'loading',
      documentElement: { classList: { toggle: noop } },
      body: { setAttribute: noop, getAttribute: () => 'home', appendChild: noop, removeChild: noop },
      getElementById: () => createEl(),
      createElement: () => createEl(),
      createDocumentFragment: () => ({ appendChild: noop }),
      querySelectorAll: () => [],
      addEventListener: noop
    },
    window: {
      location: { search: '', pathname: '/' },
      history: { replaceState: noop },
      localStorage: {
        getItem: () => null,
        setItem: noop,
        removeItem: noop
      }
    }
  };
  sandbox.window = { ...(sandbox.window as object) };

  vm.createContext(sandbox);
  vm.runInContext(scriptMatch[1], sandbox);

  const api = (sandbox.window as Record<string, any>).__PREPA_QCM__;
  assert.ok(api, '__PREPA_QCM__ doit être exposé sur window');
  return { html, api };
}

const { html, api } = loadAppFromHtml();

test('Fichier HTML autonome, strictement solo, sans CDN externe ni mention hackathon/ADUTI/équipe', () => {
  assert.ok(!/<script[^>]+src=/i.test(html), 'Aucun script externe autorisé');
  assert.ok(!/<link[^>]+rel=["']stylesheet["']/i.test(html), 'Aucune feuille de style externe autorisée');
  assert.ok(!/aduti|hackathon/i.test(html), 'Aucune mention ADUTI ou hackathon ne doit subsister');
  assert.ok(!/view-team|view-handoff|select-active-member|team-ranking-section/i.test(html), 'Aucun élément DOM équipe ne doit subsister');
  assert.ok(!/calculerStatistiquesEquipe|calculerBilanEquipe|creerProfilsParDefaut/i.test(html), 'Aucune logique équipe JS ne doit subsister');
  assert.equal(api.calculerStatistiquesEquipe, undefined);
  assert.equal(api.calculerBilanEquipe, undefined);
});

test('Banque de questions : >= 330 questions (>= 80 par domaine), 5 catégories, pédagogie complète et traçabilité', () => {
  assert.ok(Array.isArray(api.BANQUE_QUESTIONS));
  assert.ok(api.BANQUE_QUESTIONS.length >= 330, `Attendu >= 330 questions (trouvé ${api.BANQUE_QUESTIONS.length})`);

  const ids = new Set<string>();
  const counts: Record<string, Record<string, number>> = {};
  const catCounts: Record<string, number> = {};
  let codeCount = 0;

  for (const raw of api.BANQUE_QUESTIONS) {
    const norm = api.normaliserQuestion(raw);
    assert.ok(norm, `Question invalide détectée : ${raw?.question}`);
    assert.ok(!ids.has(norm.id), `Doublon détecté : ${norm.question}`);
    ids.add(norm.id);

    counts[norm.domaine] ??= { facile: 0, moyen: 0, difficile: 0 };
    counts[norm.domaine][norm.difficulté] += 1;

    catCounts[norm.categorie] = (catCounts[norm.categorie] || 0) + 1;
    if (norm.code) codeCount += 1;

    assert.ok(norm.notion.length > 0, `notion manquante sur : ${norm.question}`);
    assert.ok(norm.pourquoiFaux.length > 0, `pourquoiFaux manquant sur : ${norm.question}`);
    assert.ok(norm.aRetenir.length > 0, `aRetenir manquant sur : ${norm.question}`);
    assert.ok(norm.exemple.length > 0, `exemple manquant sur : ${norm.question}`);
    assert.ok(norm.verification.length > 0, `verification manquante sur : ${norm.question}`);
    assert.ok(norm.source.length > 0, `source manquante sur : ${norm.question}`);
    assert.ok(norm.dateVerification.length > 0, `dateVerification manquante sur : ${norm.question}`);
  }

  for (const dom of api.DOMAINES) {
    assert.ok(counts[dom], `Domaine manquant : ${dom}`);
    const total = counts[dom].facile + counts[dom].moyen + counts[dom].difficile;
    assert.ok(total >= 80, `${dom} doit avoir au moins 80 questions (trouvé ${total})`);
    assert.ok(counts[dom].facile >= 22, `${dom} : >= 22 faciles attendues (trouvé ${counts[dom].facile})`);
    assert.ok(counts[dom].moyen >= 25, `${dom} : >= 25 moyennes attendues (trouvé ${counts[dom].moyen})`);
    assert.ok(counts[dom].difficile >= 22, `${dom} : >= 22 difficiles attendues (trouvé ${counts[dom].difficile})`);
  }

  for (const cat of Object.keys(api.CATEGORIES)) {
    assert.ok((catCounts[cat] || 0) >= 20, `Catégorie ${cat} doit contenir >= 20 questions (trouvé ${catCounts[cat] || 0})`);
  }
  assert.ok(codeCount >= 20, `Attendu >= 20 questions avec extrait de code (trouvé ${codeCount})`);

  const httpIdem = api.BANQUE_QUESTIONS.find((q: any) =>
    String(q.question).toLowerCase().includes('idempotentes')
  );
  assert.ok(httpIdem, 'La question sur les méthodes HTTP idempotentes doit exister');
  assert.equal(httpIdem.difficulté, 'moyen');
});

test('Équilibre de longueur : la bonne réponse n’est pas majoritairement l’option la plus longue (<= 35 %)', () => {
  let uniqueCount = 0;
  let strictLongestCount = 0;

  for (const q of api.BANQUE_QUESTIONS) {
    if (q.type !== 'unique') continue;
    uniqueCount += 1;
    const ans = q.bonnesReponses[0];
    const maxDistractor = Math.max(...q.options.filter((o: string) => o !== ans).map((o: string) => o.length));
    if (ans.length > maxDistractor) {
      strictLongestCount += 1;
    }
  }

  const ratio = strictLongestCount / uniqueCount;
  assert.ok(
    ratio <= 0.35,
    `Biais de longueur trop élevé : ${strictLongestCount}/${uniqueCount} (${Math.round(ratio * 100)} %) > 35 %`
  );
});

test('Les 15 questions de départ "Développer avec l\'IA" sont présentes', () => {
  const iaDev = api.BANQUE_QUESTIONS.filter((q: any) => q.domaine === "Développer avec l'IA");
  const texts = iaDev.map((q: any) => `${q.question} ${(q.bonnesReponses || []).join(' ')}`);
  const expectedSnippets = [
    'vibe coding',
    'Andrej Karpathy',
    'premier prompt',
    'prompting incrémental',
    'prompt de développement efficace',
    "Avant d'intégrer du code généré par l'IA",
    'Prompt-Driven Development',
    'CodeRabbit',
    'codage agentique',
    'assistant IA',
    "outils servent à coder avec l'IA",
    'plusieurs outils IA',
    'ne comprend pas la logique',
    'découper une grosse demande',
    "Quels risques présente un code généré par l'IA"
  ];
  for (const snippet of expectedSnippets) {
    assert.ok(
      texts.some((t: string) => t.toLowerCase().includes(snippet.toLowerCase())),
      `Question de départ manquante pour : ${snippet}`
    );
  }
});

test('Simulation d\'épreuve : 20/25/30/35 questions, 4 domaines obligatoires, répartitions équilibrée, renforcée et aléatoire', () => {
  const banque = api.obtenirBanqueComplete();

  const sim30 = api.construireSessionQuestions(banque, {
    mode: 'simulation_officielle',
    officialCount: 30,
    officialSplit: 'equilibree',
    domaine: 'Développement' // doit être ignoré au profit du mélange des 4 domaines
  });
  assert.equal(sim30.length, 30);
  const doms30 = new Set(sim30.map((q: any) => q.domaine));
  assert.equal(doms30.size, 4, 'La simulation doit couvrir les 4 domaines');
  for (let i = 0; i < 10; i++) assert.equal(sim30[i].difficulté, 'facile');
  for (let i = 10; i < 20; i++) assert.equal(sim30[i].difficulté, 'moyen');
  for (let i = 20; i < 30; i++) assert.equal(sim30[i].difficulté, 'difficile');

  const sim25Hard = api.construireSessionQuestions(banque, {
    mode: 'simulation_officielle',
    officialCount: 25,
    officialSplit: 'progressive_dure'
  });
  assert.equal(sim25Hard.length, 25);
  assert.equal(sim25Hard.filter((q: any) => q.difficulté === 'facile').length, 5);
  assert.equal(sim25Hard.filter((q: any) => q.difficulté === 'moyen').length, 10);
  assert.equal(sim25Hard.filter((q: any) => q.difficulté === 'difficile').length, 10);

  const sim20Rand = api.construireSessionQuestions(banque, {
    mode: 'simulation_officielle',
    officialCount: 20,
    officialSplit: 'aleatoire'
  });
  assert.equal(sim20Rand.length, 20);
  assert.equal(new Set(sim20Rand.map((q: any) => q.domaine)).size, 4);

  const sim35 = api.construireSessionQuestions(banque, {
    mode: 'simulation_officielle',
    officialCount: 35,
    officialSplit: 'equilibree'
  });
  assert.equal(sim35.length, 35);
});

test('Diagnostic initial : 20 questions équilibrées sur les 4 domaines et analyse avec priorités', () => {
  const banque = api.obtenirBanqueComplete();
  const diag = api.construireSessionQuestions(banque, { mode: 'diagnostic' });
  assert.equal(diag.length, 20);
  for (const dom of api.DOMAINES) {
    assert.equal(diag.filter((q: any) => q.domaine === dom).length, 5);
  }

  const profilDiag = api.calculerProfilDiagnostic({
    pourcentage: 65,
    parDomaine: {
      'Développement': { total: 5, justes: 4 },
      'Cybersécurité': { total: 5, justes: 2 }
    },
    parCategorie: {
      code: { total: 4, justes: 3 },
      securite: { total: 4, justes: 1 }
    }
  });
  assert.equal(profilDiag.niveauGlobal, 'Intermédiaire solide');
  assert.equal(profilDiag.domaineFaible.dom, 'Cybersécurité');
  assert.equal(profilDiag.domaineFaible.priorite, 'Élevée');
  assert.equal(profilDiag.domaineFort.priorite, 'Faible');
});

test('Entraînement configuré : filtrage par compétence et notion', () => {
  const banque = api.obtenirBanqueComplete();
  const sessionCode = api.construireSessionQuestions(banque, {
    mode: 'entrainement',
    domaine: 'Développement',
    categorie: 'code',
    difficulte: 'toutes',
    count: 5
  });
  assert.ok(sessionCode.length > 0 && sessionCode.length <= 5);
  for (const q of sessionCode) {
    assert.equal(q.domaine, 'Développement');
    assert.equal(q.categorie, 'code');
  }
});

test('Répétition espacée (SRS) renforcée : 3 réussites espacées pour maîtriser, échec à 5 min, file prioritaire', () => {
  const now = 1_700_000_000_000;
  const s1 = api.calculerProchainSRS(null, false, now);
  assert.equal(s1.mastered, false);
  assert.equal(s1.lapses, 1);
  assert.equal(s1.dueAt, now + 5 * 60 * 1000);

  const s2 = api.calculerProchainSRS(s1, true, now);
  assert.equal(s2.reps, 1);
  assert.equal(s2.mastered, false);
  assert.equal(s2.dueAt, now + 24 * 60 * 60 * 1000);

  const s3 = api.calculerProchainSRS(s2, true, now);
  assert.equal(s3.reps, 2);
  assert.equal(s3.mastered, false);
  assert.equal(s3.dueAt, now + 2 * 24 * 60 * 60 * 1000);

  const s4 = api.calculerProchainSRS(s3, true, now);
  assert.equal(s4.reps, 3);
  assert.equal(s4.intervalIndex, 2);
  assert.equal(s4.mastered, true);
  assert.equal(s4.dueAt, now + 4 * 24 * 60 * 60 * 1000);

  const banque = api.obtenirBanqueComplete().slice(0, 3);
  const srsState = {
    [banque[0].id]: { dueAt: now - 1000, lastResult: true },
    [banque[1].id]: { dueAt: now + 60_000, lastResult: true },
    [banque[2].id]: { dueAt: now - 500, lastResult: false }
  };
  const dues = api.obtenirQuestionsDuesSRS(banque, srsState, now);
  assert.equal(dues.length, 2);
  assert.equal(dues[0].id, banque[2].id);
  assert.equal(dues[1].id, banque[0].id);
});

test('Maîtrise des notions vs questions & recommandation du jour solo', () => {
  const banque = api.obtenirBanqueComplete();
  const sample = banque.slice(0, 2);
  const firstNotion = sample[0].notion;
  const sameNotionQuestions = banque.filter((q: any) => q.notion === firstNotion);

  const srsPartial: Record<string, any> = {};
  srsPartial[sameNotionQuestions[0].id] = { reps: 1, mastered: false, lapses: 1 };
  const maitriseFragile = api.calculerMaitriseNotions(banque, srsPartial, [sameNotionQuestions[0].id]);
  assert.ok(maitriseFragile.seenNotions >= 1);
  assert.equal(maitriseFragile.masteredNotions, 0);
  assert.ok(maitriseFragile.fragileNotions.some((n: any) => n.notion === firstNotion));

  const recoInit = api.calculerRecommandationDuJour(banque, {
    history: { sessions: [], domainStats: {}, categoryStats: {} },
    srs: {},
    errorIds: []
  });
  assert.equal(recoInit.action.mode, 'diagnostic');
});

test('Migration sécurisée depuis v1 : profil unique auto-migré et choix conservés si multi-profils', () => {
  const v1Single = [
    { name: 'Candidat', history: { sessions: [{ pourcentage: 75, tempsMoyen: 11 }], domainStats: {} }, srs: { q1: { mastered: true } }, errorIds: [] },
    { name: 'Vide', history: { sessions: [], domainStats: {} }, srs: {}, errorIds: [] }
  ];
  const resSingle = api.migrerProfilDepuisV1(v1Single, 0);
  assert.equal(resSingle.autoMigratedFrom, 'Candidat');
  assert.equal(resSingle.choices.length, 0);
  assert.equal(resSingle.profile.history.sessions.length, 1);

  const v1Multi = [
    { name: 'Profil A', history: { sessions: [{ pourcentage: 80 }], domainStats: {} }, srs: {}, errorIds: [] },
    { name: 'Profil B', history: { sessions: [{ pourcentage: 60 }], domainStats: {} }, srs: {}, errorIds: [] }
  ];
  const resMulti = api.migrerProfilDepuisV1(v1Multi, 1);
  assert.equal(resMulti.choices.length, 2);
  assert.equal(resMulti.autoMigratedFrom, 'Profil B');
  assert.equal(resMulti.profile.history.sessions[0].pourcentage, 60);
});

test('Bilan individuel honnête : taux exact, non répondues, temps total et score simulé indicatif', () => {
  const q1 = { domaine: 'Développement', difficulté: 'facile', categorie: 'code', pointsBase: 10, tempsMax: 15, bonnesReponses: ['A'] };
  const q2 = { domaine: 'Cybersécurité', difficulté: 'moyen', categorie: 'securite', pointsBase: 20, tempsMax: 25, bonnesReponses: ['B'] };
  const q3 = { domaine: 'Intelligence artificielle', difficulté: 'difficile', categorie: 'debogage', pointsBase: 30, tempsMax: 40, bonnesReponses: ['C'] };

  const bilan = api.calculerBilanIndividuel([
    { question: q1, reponsesChoisies: ['A'], horsDelai: false, estJuste: true, points: 10, tempsReponse: 5 },
    { question: q2, reponsesChoisies: ['X'], horsDelai: false, estJuste: false, points: 0, tempsReponse: 10 },
    { question: q3, reponsesChoisies: [], horsDelai: true, estJuste: false, points: 0, tempsReponse: 40 }
  ]);

  assert.equal(bilan.totalQuestions, 3);
  assert.equal(bilan.bonnesCount, 1);
  assert.equal(bilan.nonReponduesCount, 1);
  assert.equal(bilan.pourcentage, 33);
  assert.equal(bilan.tempsTotal, 55);
  assert.equal(bilan.tempsMoyen, 18.3);
  assert.equal(bilan.scoreSimule, 10);
  assert.equal(bilan.scoreSimuleMax, 60);
  assert.equal(bilan.parCategorie.code.justes, 1);
  assert.equal(bilan.parCategorie.securite.justes, 0);
});

test('Import JSON : accepte difficulte/difficulté, champs pédagogiques et traçabilité', () => {
  const sample = JSON.stringify([
    {
      domaine: 'Développement',
      difficulte: 'moyen',
      categorie: 'code',
      notion: 'WebAssembly & Navigateur',
      type: 'multiple',
      question: 'Quels langages tournent nativement dans le navigateur ?',
      code: 'console.log(typeof WebAssembly);',
      options: ['JavaScript', 'WebAssembly', 'Python natif'],
      bonnesReponses: [0, 1],
      explication: 'JS et Wasm sont exécutés nativement par les navigateurs.',
      pourquoiFaux: 'Python exige un interpréteur compilé en Wasm.',
      aRetenir: 'Navigateur natif = JS + WebAssembly.',
      exemple: 'Exécuter un codec audio compilé en Wasm côté client.',
      verification: 'Citez la différence entre JS et Wasm dans le moteur du navigateur.',
      source: 'MDN Web Docs'
    }
  ]);

  const res = api.analyserImportJSON(sample);
  assert.equal(res.erreurs.length, 0);
  assert.equal(res.questions.length, 1);
  assert.equal(res.questions[0].categorie, 'code');
  assert.equal(res.questions[0].notion, 'WebAssembly & Navigateur');
  assert.equal(res.questions[0].source, 'MDN Web Docs');
  assert.equal(res.questions[0].code, 'console.log(typeof WebAssembly);');
  assert.equal(res.questions[0].aRetenir, 'Navigateur natif = JS + WebAssembly.');
  assert.deepEqual(Array.from(res.questions[0].bonnesReponses), ['JavaScript', 'WebAssembly']);

  const bad = api.analyserImportJSON('{ invalide');
  assert.equal(bad.questions.length, 0);
  assert.equal(bad.erreurs.length, 1);
});
