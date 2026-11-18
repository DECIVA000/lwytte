(function (root) {
  'use strict';

  // Clinical references and scope are documented in CLINICAL_RULES.md.
  // null means unavailable/invalid, never a measured zero or a negative finding.
  function number(value, allowZero = false) {
    if (value == null || typeof value === 'boolean' || String(value).trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && (allowZero ? n >= 0 : n > 0) ? n : null;
  }
  const anyAvailable = values => {
    const known = values.filter(v => v !== null);
    return known.length ? known.some(Boolean) : null;
  };
  const criterion = (value, test) => value === null ? null : test(value);

  function createState(saved = {}) {
    const defaults = {p: {sex: 'M', height_cm: '', weight_kg: ''}, m: {},
      d: {rap_mmHg: '8', pulmonary_vein_sd_confirmed: false}, mv: {}, av: {}, pv: {}, r: {}, der: {},
      context: {lavi_override: 'auto'}, ph: {a: 'no', b: 'no', c: 'no'}};
    return Object.fromEntries(Object.entries(defaults).map(([key, value]) =>
      [key, {...value, ...saved[key]}]));
  }
  function mosteller(p = {}) {
    const height = number(p.height_cm), weight = number(p.weight_kg);
    return height === null || weight === null ? null : number(Math.sqrt(height * weight / 3600));
  }
  function estimatedPasp(trpg, rap) {
    const gradient = number(trpg), pressure = number(rap);
    return gradient !== null && [3, 8, 15].includes(pressure) ? number(gradient + pressure) : null;
  }
  function rightHeart({d = {}, context = {}} = {}) {
    const tr = context.tr_unmeasurable ? null : number(d.tr_vmax_ms);
    const trpg = tr === null ? null : number(4 * tr * tr);
    return {trpg, rap: [3, 8, 15].includes(number(d.rap_mmHg)) ? number(d.rap_mmHg) : null,
      pasp: estimatedPasp(trpg, d.rap_mmHg)};
  }
  // Requested local surrogate, NOT a measured volume or an ASE-validated substitute.
  function laviCriterion({p = {}, m = {}, context = {}} = {}) {
    const measured = number(m.lavi_ml_m2), diameter = number(m.la_ap_mm), bsa = mosteller(p);
    const ladi = diameter !== null && bsa !== null ? number(diameter / bsa) : null;
    // Tolerance only covers binary floating-point error at an exact boundary.
    const atLeast = (a, b) => a > b || Math.abs(a - b) <= Number.EPSILON * 8 * Math.max(1, a, b);
    const automatic = ladi === null ? null : atLeast(diameter, 40) || atLeast(ladi, 23.35);
    const base = {measured, diameter, bsa, ladi, automatic};
    if (measured !== null) return {...base, elevated: measured > 34, source: 'measured'};
    if (['high', 'normal'].includes(context.lavi_override)) {
      return {...base, elevated: context.lavi_override === 'high', source: 'manual'};
    }
    return {...base, elevated: automatic, source: automatic === null ? 'unavailable' : 'surrogate'};
  }
  function laviDescription(value) {
    const answer = v => v === null ? 'Unknown' : v ? 'Yes' : 'No';
    const source = {measured: 'measured LAVi', surrogate: 'diameter-based surrogate; custom rule',
      manual: 'manual surrogate override; custom rule', unavailable: 'insufficient measured/proxy data'}[value.source];
    return `LAVi criterion >34: ${answer(value.elevated)} (${source})` +
      (value.source === 'manual' ? `; automatic proxy: ${answer(value.automatic)}` : '');
  }

  const exclusions = [
    ['mac', 'Moderate/severe MAC'],
    ['primary_mr', 'Severe primary MR'],
    ['ms', 'Mitral stenosis (any degree)'],
    ['mitral_procedure', 'Mitral repair / replacement / TEER'],
    ['lvad', 'LVAD'],
    ['noncardiac_ph', 'Non-cardiac PH'],
    ['htx', 'Heart transplant'],
    ['constriction', 'Pericardial constriction']
  ];

  const regurgitations = [
    ['mr', 'MR', 'Mitral regurgitation'], ['ar', 'AR', 'Aortic regurgitation'],
    ['tr', 'TR', 'Tricuspid regurgitation'], ['pr', 'PR', 'Pulmonary regurgitation']
  ];
  function regGrade(r, valve) {
    // Preserve the existing EROA bands; clinician-selected integrated grade wins.
    const manual = String(r[`${valve}_grade`] || '').trim().toLowerCase();
    if (['none', 'unassessed'].includes(manual)) return '';
    if (manual) return manual[0].toUpperCase() + manual.slice(1);
    const ero = number(r[`${valve}_eroa`]);
    if (ero === null) return '';
    if (valve === 'mr' || valve === 'tr') {
      if (ero < 0.2) return 'Mild';
      if (ero < 0.3) return 'Mild-moderate';
      if (ero < 0.35) return 'Moderate';
      if (ero < 0.4) return 'Moderate-severe';
      if (valve === 'mr' || ero < 0.6) return 'Severe';
      return ero < 0.8 ? 'Massive' : 'Torrential';
    }
    if (ero < 0.1) return 'Mild';
    if (ero < 0.2) return 'Mild-moderate';
    if (ero < 0.25) return 'Moderate';
    return ero < 0.3 ? 'Moderate-severe' : 'Severe';
  }
  function regFindings(r) {
    return regurgitations.map(([key, abbreviation, name]) => ({
      key, abbreviation, name, grade: regGrade(r, key), ero: number(r[`${key}_eroa`])
    })).filter(f => f.grade);
  }
  function joinEnglish(items) {
    return items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
  }
  function regStatus(r, findings) {
    const unknown = regurgitations.filter(([key]) => r[`${key}_grade`] === 'unassessed' ||
      (!r[`${key}_grade`] && String(r[`${key}_eroa`] ?? '').trim() !== '' && number(r[`${key}_eroa`], true) === null))
      .map(([, abbreviation]) => abbreviation);
    if (unknown.length) return [`Regurgitation not assessed / insufficient data: ${joinEnglish(unknown)}`];
    return findings.length ? [] : ['No significant valvular regurgitation.'];
  }
  function regImpression(r) {
    const groups = new Map();
    regFindings(r).forEach(f => {
      if (!groups.has(f.grade)) groups.set(f.grade, []);
      groups.get(f.grade).push(f.abbreviation);
    });
    const lines = [...groups].map(([grade, valves]) => `${grade} ${joinEnglish(valves)}`);
    return [...lines, ...regStatus(r, lines)];
  }
  function regDetails(r) {
    const lines = regFindings(r).map(f => `${f.name}, ${f.grade}${f.ero === null ? '' : ` (EROA ${f.ero.toFixed(2)} cm²)`}`);
    return [...lines, ...regStatus(r, lines)];
  }

  // ASE 2025 Figure 3. General sinus-rhythm pathway only.
  function diastolic({ p = {}, d = {}, m = {}, mv = {}, r = {}, context = {} } = {}) {
    const result = (g, lap, reason = '') => ({ g, lap, reason });
    const excluded = exclusions.filter(([key]) => context[key]).map(([, label]) => label);
    if (context.rhythm && !['sinus', 'apcs', 'vpcs'].includes(context.rhythm)) excluded.push('Non-sinus rhythm');
    if (excluded.length) return result('Not applicable', 'Not assessed', `Use condition-specific assessment: ${excluded.join('; ')}`);
    if (!context.rhythm) return result('Indeterminate', 'Indeterminate', 'Confirm rhythm and general-algorithm eligibility');
    const pht = number(mv.mv_pht_ms);
    if (pht !== null && 220 / pht <= 2) {
      return result('Indeterminate', 'Not assessed', 'Reduced PHT-derived MVA: confirm/exclude MS before using the general algorithm');
    }
    // Severe MR without its mechanism established cannot safely enter this pathway.
    if (regGrade(r, 'mr') === 'Severe' && context.mr_mechanism !== 'secondary') {
      return result('Not applicable', 'Not assessed', 'Severe MR: confirm mechanism and use the appropriate assessment');
    }

    const E = number(d.mv_e_cm_s), A = number(d.mv_a_cm_s);
    const eS = number(d.e_prime_sep_cm_s), eL = number(d.e_prime_lat_cm_s);
    const eAverage = eS !== null && eL !== null ? (eS + eL) / 2 : null;
    const TR = context.tr_unmeasurable ? null : number(d.tr_vmax_ms);
    const PASP = rightHeart({d, context}).pasp;
    const EA = E !== null && A !== null ? E / A : null;
    const reducedE = anyAvailable([
      criterion(eS, n => n <= 6), criterion(eL, n => n <= 7), criterion(eAverage, n => n <= 6.5)
    ]);
    const increasedEE = E === null ? null : anyAvailable([
      criterion(eS, n => E / n >= 15), criterion(eL, n => E / n >= 13), criterion(eAverage, n => E / n >= 14)
    ]);
    // ASE text: use PASP when available; otherwise use TR velocity.
    const increasedPressure = PASP !== null ? PASP >= 35 : criterion(TR, n => n >= 2.8);
    const primary = [reducedE, increasedEE, increasedPressure];
    if (primary.includes(null)) return result('Indeterminate', 'Indeterminate', 'Missing reliable e′, E/e′, or TR Vmax/PASP');
    const count = primary.filter(Boolean).length;
    const highLAP = () => EA === null
      ? result('Indeterminate', 'High', 'Elevated LAP; E/A required to distinguish Grade 2 from Grade 3')
      : result(EA >= 2 ? 'Grade 3' : 'Grade 2', 'High');
    if (count === 0) return result('Normal', 'Normal');
    if (count === 3) return highLAP();
    if (reducedE && count === 1) {
      if (EA === null) return result('Indeterminate', 'Indeterminate', 'E/A required for isolated reduced e′');
      if (EA <= 0.8) return result('Grade 1', 'Normal');
    }

    // Removed numeric PV S/D, LARS and IVRT fields are intentionally ignored.
    // User-confirmed workflow: unchecked is a negative criterion, checked positive.
    // Absent/invalid imported boolean still remains unavailable.
    const lavi = laviCriterion({p, m, context});
    const supplemental = [
      typeof d.pulmonary_vein_sd_confirmed === 'boolean' ? d.pulmonary_vein_sd_confirmed : null,
      lavi.elevated
    ];
    let elevated = anyAvailable(supplemental);
    if (elevated === null && ['normal', 'high'].includes(context.supplemental_lap)) {
      elevated = context.supplemental_lap === 'high';
    }
    if (elevated === null) return result('Indeterminate', 'Indeterminate', 'No reliable second-stage criterion; obtain measured LAVi, confirmed pulmonary vein S/D ≤0.67, or supplemental assessment');
    return elevated ? highLAP() : result('Grade 1', 'Normal');
  }

  // ESC/ERS 2022 Figure 5 + Table 10: count categories, not individual signs.
  function pulmonaryHypertension({ trV, unmeasurable = false, categories = [] } = {}) {
    const velocity = unmeasurable ? null : number(trV);
    const known = [0, 1, 2].map(i => ['yes', 'no'].includes(categories[i]) ? categories[i] : 'unknown');
    const positive = known.filter(v => v === 'yes').length;
    const unknown = known.filter(v => v === 'unknown').length;
    const signs = positive >= 2 ? true : positive + unknown < 2 ? false : null;
    const result = (probability, reason = '') => ({ probability, reason, positive });
    if (velocity === null && !unmeasurable) return result('Indeterminate', 'TR Vmax not entered; distinguish missing data from an unmeasurable jet');
    if (velocity > 3.4) return result('High');
    if (velocity !== null && velocity > 2.8) {
      return signs === true ? result('High') : signs === false ? result('Intermediate')
        : result('At least intermediate', 'Additional PH signs incompletely assessed');
    }
    return signs === true ? result('Intermediate') : signs === false ? result('Low', unmeasurable ? 'TR jet unmeasurable; absence of a measurable jet does not exclude PH' : '')
      : result('Indeterminate', 'Additional PH signs incompletely assessed');
  }

  function phImpression({trV, unmeasurable = false, categories = []} = {}) {
    const ph = pulmonaryHypertension({trV, unmeasurable, categories});
    if (ph.probability === 'Low') return ph.reason ? [`PH assessment limitation: ${ph.reason}`] : [];
    const tr = number(trV);
    const trText = unmeasurable ? 'TR Vmax unmeasurable' : tr === null ? 'TR Vmax unavailable' : `TR Vmax ${tr.toFixed(2)} m/s`;
    const signs = ['A', 'B', 'C'].filter((_, i) => categories[i] === 'yes');
    return [`${ph.probability} echocardiographic probability of pulmonary hypertension (${trText}${signs.length ? '; PH sign categories ' + signs.join(', ') : ''})${ph.reason ? '; ' + ph.reason : ''}`];
  }

  function chamberLines({ geometry = '', lvSizeKnown = false, lvDil = false, laDil = false, rvDil = false, raDil = false } = {}) {
    const lines = [];
    if (geometry && geometry !== 'normal geometry') lines.push(`LV ${geometry}`);
    else if (lvSizeKnown && !lvDil) lines.push('The left ventricle size is normal');
    const dilated = [['LV', lvDil], ['LA', laDil], ['RV', rvDil], ['RA', raDil]]
      .filter(([, dil]) => dil).map(([name]) => name);
    if (dilated.length) lines.push(dilated.length === 4 ? 'Four-chamber dilatation' : `${dilated.join(' & ')} dilatation`);
    return lines;
  }

  const api = { number, createState, mosteller, estimatedPasp, rightHeart, laviCriterion, laviDescription,
    exclusions, regGrade, regImpression, regDetails, diastolic, pulmonaryHypertension, phImpression, chamberLines };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EchoRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
