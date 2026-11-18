(function(){
  // ---------- 0. DOM helpers ----------
  const $  = id => document.getElementById(id);
  const rd = (v,d=2) => Number.isFinite(+v) ? (+v).toFixed(d) : '';
  const cm = v => v/10;
  const rules = EchoRules;

  // ---------- 1. Field definitions ----------
  const mm = [
 ['ao_root_mm','Ao root','mm'],                     // 1
 ['acs_mm','Aortic cusp separation','mm'],          // 2
 ['la_ap_mm','LA diam','mm'],                       // 3

 ['ivsd_mm','IVS','mm'],                            // 4
 ['lvidd_mm','LVIDd','mm'],                         // 5
 ['lvpwd_mm','LVPW','mm'],                          // 6

 ['lvids_mm','LVIDs','mm'],                         // 7
 ['lavi_ml_m2','LAVi','mL/m²'],                      // 8
 ['tapse_mm','TAPSE','mm'],                         // 9

 ['lvot_diam_mm','LVOT diam','mm'],                  // 10
 ['edd_ml','EDV (2D)','mL'],                         // 11
 ['esv_ml','ESV (2D)','mL']                          // 12
  ];

  const dop  = [
    ['mv_e_cm_s','MV E','cm/s'],
    ['mv_a_cm_s','MV A','cm/s'],
    ['e_prime_sep_cm_s','e′ sep','cm/s'],
    ['e_prime_lat_cm_s','e′ lat','cm/s'],
    ['lvot_vti_cm','LVOT VTI','cm'],
    ['lvot_vmax_ms','LVOT Vmax','m/s'],
    ['tr_vmax_ms','TR Vmax','m/s'],
    ['tas_cm_s','TAS′','cm/s']
  ];
  const mvF  = [
    ['mv_mean_pg_mmHg','MV Mean PG','mmHg'],
    ['mv_pht_ms','MV PHT','ms']
  ];
  const av   = [
    ['av_vti_cm','AV VTI','cm'],
    ['av_vmax_ms','AV Vmax','m/s'],
    ['av_mean_pg_mmHg','AV Mean PG','mmHg'],
  ];
  const pv   = [
    ['pv_vel_cm_s','PV Vel','cm/s'],
    ['pv_acc_ms','PV Acc T','ms']
  ];
  const regList = [
    ['mr','MR'],['ar','AR'],['tr','TR'],['pr','PR']
  ];

  // ---------- 2. Global state ----------
  const S = rules.createState();

  function clearProxyOverride() {
    S.context.lavi_override = 'auto';
    if ($('lavi_override')) $('lavi_override').value = 'auto';
  }

  // ---------- 3. Build-input helper ----------
  function addInput(parent,[k,label,unit],store){
    const d=document.createElement('div');
    d.className='col-6 col-md-3 mb-2';
    d.innerHTML=
      `<label for="${k}" class="form-label small">${label}${unit ? ` (${unit})` : ''}</label>`+
      `<input id="${k}" class="form-control form-control-sm" type="number" min="0" step="any">`;
    parent.appendChild(d);
    store[k] ??= '';
    $(k).value = store[k];
    $(k).oninput=e=>{
      store[k]=e.target.value;
      if (['la_ap_mm', 'lavi_ml_m2'].includes(k)) clearProxyOverride();
      calc();
    };
  }

  function addSelect(parent, id, label, options, store, key = id, defaultValue = options[0][0]) {
    const col = document.createElement('div');
    col.className = 'col-12 col-md-4 mb-2';
    col.innerHTML = `<label for="${id}" class="form-label small">${label}</label>` +
      `<select id="${id}" class="form-select form-select-sm">${options.map(([value, text]) =>
        `<option value="${value}">${text}</option>`).join('')}</select>`;
    parent.appendChild(col);
    store[key] ??= defaultValue;
    $(id).value = store[key];
    $(id).dataset.resetValue = defaultValue;
    $(id).onchange = e => { store[key] = e.target.value; calc(); };
  }

  function addCheck(parent, id, label, store, key = id) {
    const col = document.createElement('div');
    col.className = 'col-12 col-md-4 mb-2';
    col.innerHTML = `<div class="form-check"><input id="${id}" class="form-check-input" type="checkbox">` +
      `<label for="${id}" class="form-check-label small">${label}</label></div>`;
    parent.appendChild(col);
    store[key] ??= false;
    $(id).checked = store[key] === true;
    $(id).onchange = e => { store[key] = e.target.checked; calc(); };
  }

  // ---------- 4. Derived meta ----------
  const meta = {
    lvot_area:['LVOT area','cm²'],
    sv_mmode:['SV (m-mode)','mL'],   svi_mmode:['SVi (m-mode)','mL/m²'],  ef_mmode:['EF (m-mode)','%'],
    sv_2d:['SV (2D)','mL'],          svi_2d:['SVi (2D)','mL/m²'],         ef_2d:['EF (2D)','%'],
    sv_dopp:['SV (Doppler)','mL'],   svi_dopp:['SVi (Doppler)','mL/m²'],
    mv_mean_pg:['MV Mean PG','mmHg'],mv_pht:['MV PHT','ms'],             tas:['TAS′','cm/s'],
    ao_max_pg:['Ao PG','mmHg'],      ava_vti:['AVA (VTI)','cm²'],         ava_vel:['AVA (Vel)','cm²'],
    ea_ratio:['E/A',''],             ee_sep:['E/e′ sep',''],             ee_lat:['E/e′ lat',''], ee_avg:['E/e′ avg',''], trpg:['TRPG','mmHg'],
    mva:['MVA','cm²'],
    pasp_est:['Estimated PASP','mmHg'], ladi:['LADi','mm/m²'],
    lavi_est:['LAVi','mL/m²'],       la_size:['LA size',''],              df_grade:['DF',''],     lap_status:['LAP',''],
    ms_grade:['MS',''],              mr_grade:['MR',''],                 ar_grade:['AR',''],     tr_grade:['TR',''],      pr_grade:['PR','']
  };
  Object.keys(meta).forEach(k=>S.der[k]={a:'',m:null});
  S.der.bsa={a:'',m:null};

  // ---------- 5. Utilities ----------
  function calcDF(){
    return rules.diastolic(S);
  }
  function regGrade(p){
    return rules.regGrade(S.r, p);
  }

  // ---------- 6. Main calculation ----------
  function calc(){
    const D=S.der;
    // BSA
    const bsa = rules.mosteller(S.p);
    D.bsa.a=bsa ?? ''; $('bsa').textContent=bsa === null ? '-' : rd(bsa);
    const pressure = rules.rightHeart(S);
    D.trpg.a = pressure.trpg === null ? '' : rd(pressure.trpg);
    D.pasp_est.a = pressure.pasp === null ? '' : rd(pressure.pasp);
    $('estimated-pasp').textContent = pressure.pasp === null ? 'Unavailable' : `${rd(pressure.pasp)} mmHg`;
    S.lavi = rules.laviCriterion(S);
    D.ladi.a = S.lavi.ladi === null ? '' : rd(S.lavi.ladi);
    $('lavi-criterion').textContent = rules.laviDescription(S.lavi);
    $('lavi_override').disabled = S.lavi.source === 'measured';

    // LVOT area
    D.lvot_area.a = S.m.lvot_diam_mm
      ? rd(Math.PI * Math.pow(cm(S.m.lvot_diam_mm)/2,2),2)
      : '';

    // EDV / ESV
    const EDV = S.m.edd_ml
                  || (S.m.lvidd_mm
                      ? rd(7*Math.pow(cm(S.m.lvidd_mm),3)/(2.4+cm(S.m.lvidd_mm)),0)
                      : '');
    const ESV = S.m.esv_ml
                  || (S.m.lvids_mm
                      ? rd(7*Math.pow(cm(S.m.lvids_mm),3)/(2.4+cm(S.m.lvids_mm)),0)
                      : '');

    // 2D derived
    D.sv_2d  = { a: (EDV&&ESV)? rd(EDV - ESV): '', m:null };
    D.svi_2d = { a: (D.sv_2d.a&&bsa)? rd(D.sv_2d.a/bsa): '', m:null };
    D.ef_2d  = { a: (EDV&&ESV)? rd((EDV-ESV)/EDV*100,1): '', m:null };

    // m-mode derived
    if(S.m.lvidd_mm && S.m.lvids_mm){
      const ed = 7*Math.pow(cm(S.m.lvidd_mm),3)/(2.4+cm(S.m.lvidd_mm));
      const es = 7*Math.pow(cm(S.m.lvids_mm),3)/(2.4+cm(S.m.lvids_mm));
      const sv = ed - es;
      D.sv_mmode  = { a: rd(sv), m:null };
      D.svi_mmode = { a: bsa? rd(sv/bsa): '', m:null };
      D.ef_mmode  = { a: rd(sv/ed*100,1), m:null };
    } else {
      ['sv_mmode', 'svi_mmode', 'ef_mmode'].forEach(key => D[key].a = '');
    }

    // Doppler SV
    if(D.lvot_area.a && S.d.lvot_vti_cm){
      const sv = D.lvot_area.a * S.d.lvot_vti_cm;
      D.sv_dopp  = { a: rd(sv), m:null };
      D.svi_dopp = { a: bsa? rd(sv/bsa): '', m:null };
    } else {
      ['sv_dopp', 'svi_dopp'].forEach(key => D[key].a = '');
    }

    // LAVi & LA size
    D.lavi_est.a = rules.number(S.m.lavi_ml_m2) ?? '';
    const L = +D.lavi_est.a||0;
    D.la_size.a = L
      ? (L<=34?'Normal':L<=41?
         'Mild':L<=48?'Moderate':'Severe')
      : '';

    // Diastolic
    const df = calcDF();
    D.df_grade.a   = df.g;
    D.lap_status.a = df.lap;
    S.dfReason = df.reason;

    // MVA & MS
    D.mva.a      = S.mv.mv_pht_ms
                    ? rd(220/S.mv.mv_pht_ms,2)
                    : '';
    D.ms_grade.a = D.mva.a
                    ? (D.mva.a>1.5?'Mild':D.mva.a>1?'Moderate':'Severe')
                    : '';

    // Ao PG & AVA
    D.ao_max_pg.a = S.av.av_vmax_ms
                      ? rd(4*Math.pow(S.av.av_vmax_ms,2))
                      : '';
    D.ava_vti.a   = (D.lvot_area.a && S.d.lvot_vti_cm && S.av.av_vti_cm)
                      ? rd(D.lvot_area.a * (S.d.lvot_vti_cm/S.av.av_vti_cm),2)
                      : '';
    D.ava_vel.a   = (D.lvot_area.a && S.d.lvot_vmax_ms && S.av.av_vmax_ms)
                      ? rd(D.lvot_area.a * (S.d.lvot_vmax_ms/S.av.av_vmax_ms),2)
                      : '';

    // Additional hemodynamics
    D.ea_ratio = { a: (S.d.mv_e_cm_s&&S.d.mv_a_cm_s)
                     ? rd(S.d.mv_e_cm_s/S.d.mv_a_cm_s,2)
                     : '', m:null };
    D.ee_sep   = { a: (S.d.mv_e_cm_s&&S.d.e_prime_sep_cm_s)
                     ? rd(S.d.mv_e_cm_s/S.d.e_prime_sep_cm_s,1)
                     : '', m:null };
    D.ee_lat   = { a: (S.d.mv_e_cm_s&&S.d.e_prime_lat_cm_s)
                     ? rd(S.d.mv_e_cm_s/S.d.e_prime_lat_cm_s,1)
                     : '', m:null };
    const eSep = rules.number(S.d.e_prime_sep_cm_s), eLat = rules.number(S.d.e_prime_lat_cm_s);
    D.ee_avg.a = eSep !== null && eLat !== null && rules.number(S.d.mv_e_cm_s) !== null
      ? rd(Number(S.d.mv_e_cm_s) / ((eSep + eLat) / 2), 1) : '';

    // Regurg grades
    regList.forEach(([p]) => D[`${p}_grade`].a = regGrade(p));

    renderDerived();
    renderSummary();
  }

  // ---------- 7. renderDerived ----------
  function renderDerived(){
    const box=$('derived'); if(!box) return; box.innerHTML='';
    const order = [
     // m-mode
     'sv_mmode','svi_mmode','ef_mmode',
     // 2D
     'sv_2d','svi_2d','ef_2d',
     // Doppler
     'sv_dopp','svi_dopp','lvot_area',
     // Diastolic
     'ea_ratio','ee_sep','ee_lat','ee_avg',
     // AV
     'ava_vti','ava_vel','mva',
     // TRPG
     'trpg', 'pasp_est', 'ladi'
   ];

    order.forEach((k,i)=>{
      const d=S.der[k]; if(!d) return;
      const [lab,unit]=meta[k];
      const val=d.a||'-';
      const col=document.createElement('div');
      col.className='col-6 col-md-4';
      col.innerHTML=
        `<div class="d-flex align-items-center">`+
        `<span class="fw-bold flex-grow-1">${lab}:</span>`+
        `<span>${val}${unit?` ${unit}`:''}</span>`+
        `</div>`;
      box.appendChild(col);
      if((i+1)%3===0){
        const br=document.createElement('div');
        br.className='w-100';
        box.appendChild(br);
      }
    });
  }

// ---------- 8. renderSummary (替换整段) ----------
function renderSummary(){
  const lines = [];

   // --- 1. LV geometry + dilation (using RWT & LVMi) ---
   const ivs   = rules.number(S.m.ivsd_mm) || 0;
   const pw    = rules.number(S.m.lvpwd_mm) || 0;
   const lvidd = rules.number(S.m.lvidd_mm) || 0;
   const rwt   = lvidd && pw ? 2 * pw / lvidd : 0;
 
   // 計算 LVM (Devereux 公式) 並 index by BSA
   const bsa   = parseFloat(S.der.bsa.a) || 0;
   let lvmi = 0;
   if (lvidd && ivs && pw && bsa) {
     const ivs_cm   = cm(ivs), pw_cm = cm(pw), lvidd_cm = cm(lvidd);
     const lvm_g    = 0.8 * (1.04 * (Math.pow(lvidd_cm + ivs_cm + pw_cm, 3) - Math.pow(lvidd_cm, 3))) + 0.6;
     lvmi = lvm_g / bsa;
   }
 
   // 性別依門檻判 LVMi 增高
   const sex        = S.p.sex;
   const lvmiThresh = sex === 'M' ? 115 : 95;
   const lvmiHigh   = lvmi > lvmiThresh;
 
   // 用 RWT & LVMi 判定 geometry
   let geometry;
   if (!(lvidd && ivs && pw && bsa))    geometry = '';
   else if (rwt <= 0.42 && !lvmiHigh)   geometry = 'normal geometry';
   else if (rwt > 0.42  && !lvmiHigh)   geometry = 'concentric remodeling';
   else if (rwt > 0.42  && lvmiHigh)    geometry = 'concentric hypertrophy';
   else /* rwt ≤0.42 && lvmiHigh */     geometry = 'eccentric hypertrophy';

  const lvDil = lvidd > 53;
  const measuredLavi = rules.number(S.m.lavi_ml_m2);
  const laDil = measuredLavi !== null ? measuredLavi > 34 : (parseFloat(S.m.la_ap_mm) > 42);
  const rvDil = !!S.m.rv_dil;
  const raDil = !!S.m.ra_dil;
  rules.chamberLines({geometry, lvSizeKnown: lvidd > 0, lvDil, laDil, rvDil, raDil})
    .forEach(line => lines.push(`• ${line}`));


  // --- 2. EF status ---
  // 2. Systolic Function：改為取 2D-EF 與 M-mode EF 的較低值，且忽略未輸入的欄位

  const ef2d = parseFloat(S.der.ef_2d?.a);
  const efMM = parseFloat(S.der.ef_mmode?.a);
  let ef = Number.isFinite(ef2d) && Number.isFinite(efMM) ? Math.min(ef2d, efMM)
          : Number.isFinite(ef2d) ? ef2d
          : Number.isFinite(efMM) ? efMM
          : null;
  if (ef !== null) {
    let status = 'Preserved EF';
    if (ef < 40) status = 'Reduced EF';
    else if (ef < 50) status = 'Mildly reduced EF';
    lines.push(`• Systolic function: ${status} (${ef.toFixed(0)}%)`);
  }


  // --- 3. Diastolic function (原 calcDF 结果) ---
  const df = S.der.df_grade.a || '-';
  const lap = S.der.lap_status.a || '-';
  lines.push(`• Diastolic function: ${df} (LAP ${lap})${S.dfReason ? '; ' + S.dfReason : ''}`);
  if (df === 'Grade 1' && S.context.symptomatic) {
    lines.push('• Consider diastolic exercise echocardiography for symptoms despite normal resting LAP');
  }

  // 4. Valve findings (AS → MS → AR → MR → TR → PR)

  // 4.1 Aortic stenosis
  (() => {
    const ava   = parseFloat(S.der.ava_vti.a) || parseFloat(S.der.ava_vel.a) || 0;
    const vmax  = parseFloat(S.av.av_vmax_ms)     || 0;
    const svIdx = +S.der.svi_dopp.a               || 0;
    let status = '';
    if (ava && ava < 1) {
      if      (vmax > 4)        status = 'Severe – high gradient';
      else if (svIdx > 35)      status = 'Severe – NFLG';
      else {
        const efVal = +S.der.ef_2d.a || +S.der.ef_mmode.a || 0;
        status = efVal < 50
          ? 'Severe – classic LFLG'
          : 'Severe – paradoxical LFLG';
      }
    } else if (vmax >= 3.5)      status = 'Moderate-Severe';
    else if (vmax >= 3)          status = 'Moderate';
    else if (vmax >= 2)          status = 'Mild';
    // <2 → normal，status 留空>
    if (status) lines.push(`• Aortic stenosis, ${status}`);
  })();

// 4.2 Mitral stenosis（先看 MVA；僅 Moderate/Severe 會顯示；後面附 mean PG + MVA）
(() => {
  // 取 MVA（優先使用已計算好的 S.der.mva.a；若沒有就以 PHT 現算）
  let mva = parseFloat(S.der.mva?.a);
  if (!Number.isFinite(mva) && S.mv.mv_pht_ms) {
    const pht = parseFloat(S.mv.mv_pht_ms);
    if (Number.isFinite(pht) && pht > 0) mva = 220 / pht;
  }
  if (!Number.isFinite(mva)) return; // 無法判定就不顯示

  // 先以 MVA 決定等級
  let status = '';
  if (mva <= 1.5)       status = 'Severe';
  else if (mva <= 2.0)  status = 'Moderate';
  else                  status = ''; // Mild/Normal 一律不顯示於 Summary

  if (!status) return;  // 只有 Moderate / Severe 需要輸出

  // 附帶顯示 mean PG 與 MVA 數值
  const pgNum = parseFloat(S.mv.mv_mean_pg_mmHg);
  const pgTxt = Number.isFinite(pgNum) ? pgNum.toFixed(1) : '-';
  const mvaTxt = mva.toFixed(2);

  lines.push(`• Mitral stenosis, ${status} (mean PG ${pgTxt} mmHg; MVA ${mvaTxt} cm²)`);
})();



  // 4.3 Impression groups share one grade; details are generated from data below.
  rules.regImpression(S.r).forEach(line => lines.push(`• ${line}`));

  // 5. Pulmonary Hypertension Probability
  rules.phImpression({trV: S.d.tr_vmax_ms, unmeasurable: S.context.tr_unmeasurable,
    categories: [S.ph.a, S.ph.b, S.ph.c]}).forEach(line => lines.push(`• ${line}`));

  // 最後輸出
  $('summary').textContent = lines.join('\n');
}


// ---------- 9. Generate Report ----------
$('generate').onclick = () => {
  const o = [];

  // 1) Interpretation Summary
o.push(
  'Interpretation Summary',
  $('summary').textContent + (S.context.rhythm ? '\n• ' + $('rhythm').selectedOptions[0].text + ' during the examination' : ''),
  ''
);


/**
 * 三栏输出，标签左对齐、冒号对齐，数值右对齐，单位左对齐
 * @param {Array} arr [[label, val, unit], ...]
 */
/**
 * 三栏输出：
 * - label 左对齐
 * - 冒号对齐
 * - value 左对齐
 * - unit 右对齐
 */
function pushThree(arr) {
  if (!arr.length) return;
  // 计算三部分最大宽度
  const maxLab = Math.max(...arr.map(([lab]) => lab.length));
  const maxVal = Math.max(...arr.map(([_, val]) => String(val).length));
  const maxUnit = Math.max(...arr.map(([_, __, unit]) => unit.length));

  // 每三项一行
  for (let i = 0; i < arr.length; i += 2) {
    const cols = arr.slice(i, i + 2).map(([lab, val, unit]) => {
      const labTxt  = lab.padEnd(maxLab, ' ');
      const valTxt  = String(val).padEnd(maxVal, ' ');
      const unitTxt = unit.padStart(maxUnit, ' ');
      // 拼成：标签 + ':' + 空格 + 数值 + 空格 + 单位
      return `${labTxt}: ${valTxt} ${unitTxt}`;
    });
    // 三栏之间用三个空格间隔
    o.push(cols.join('   '));
  }
  o.push('');
}



  // 2) 2D Measurements — 三栏输出
  o.push('■ 2D Measurements');

  const items2D = [
    ['Ao root diam', S.m.ao_root_mm, 'mm'],
    ['Aortic cusp separation', S.m.acs_mm, 'mm'],
    ['LVOT diam', S.m.lvot_diam_mm, 'mm'],
    ['IVS/LVPW', `${S.m.ivsd_mm}/${S.m.lvpwd_mm}`, 'mm'],
    ['LVIDd/LVIDs', `${S.m.lvidd_mm}/${S.m.lvids_mm}`, 'mm'],
    ['LA diam', S.m.la_ap_mm, 'mm'],
    ['LAVi', S.m.lavi_ml_m2, 'mL/m²'],
    ['TAPSE', S.m.tapse_mm, 'mm'],
    ['EDV (2D)', S.m.edd_ml, 'mL'],
    ['ESV (2D)', S.m.esv_ml, 'mL'],
    ['EF (2D)', S.der.ef_2d.a, '%'],
    ['SV (m-mode)', S.der.sv_mmode.a, 'mL'],
    ['SVi (m-mode)', S.der.svi_mmode.a, 'mL/m²'],
    ['EF (m-mode)', S.der.ef_mmode.a, '%'],
    ['SV (Doppler)', S.der.sv_dopp.a, 'mL'],
    ['SVi (Doppler)', S.der.svi_dopp.a, 'mL/m²']
  ];
  // 过滤掉 value 为 null/undefined/空字符串 的
  const filled2D = items2D.filter(([_, v]) => v !== '' && v != null);
  pushThree(filled2D);

  // 3) Doppler & Valve Measurements — 三栏输出
  o.push('■ Doppler & Valve Measurements');
 
    const itemsDV = [
    // 行 1
    ['MV E/A', `${S.d.mv_e_cm_s}/${S.d.mv_a_cm_s}`, 'cm/s'],
    ['e′ sep/lat', `${S.d.e_prime_sep_cm_s}/${S.d.e_prime_lat_cm_s}`, 'cm/s'],
    ['E/e′ sep/lat', `${S.der.ee_sep.a}/${S.der.ee_lat.a}`, ''],
    ['E/e′ average', S.der.ee_avg.a, ''],
    ['TR Vmax', S.context.tr_unmeasurable ? 'Unmeasurable' : S.d.tr_vmax_ms, 'm/s'],
    ['Selected RAP', S.d.rap_mmHg, 'mmHg'],
    ['Estimated PASP', S.der.pasp_est.a, 'mmHg'],
    ['Pulmonary vein S/D ≤0.67', S.d.pulmonary_vein_sd_confirmed === true ? 'Yes' : S.d.pulmonary_vein_sd_confirmed === false ? 'No' : 'Unavailable', ''],

    // 行 2
    ['LVOT Vmax', S.d.lvot_vmax_ms, 'm/s'],
    ['AV Vmax', S.av.av_vmax_ms, 'm/s'],       // 改用 S.av
    ['AV max PG', S.der.ao_max_pg.a, 'mmHg'],  // 新增 AV max PG
    ['AVA (vel)', S.der.ava_vel.a, 'cm²'],

    // 行 3
    ['LVOT VTI', S.d.lvot_vti_cm, 'cm'],
    ['AV VTI', S.av.av_vti_cm, 'cm'],
    ['AVA (VTI)', S.der.ava_vti.a, 'cm²'],

    // 行 4
    ['TRPG', S.der.trpg.a, 'mmHg'],
    ['TAS′', S.d.tas_cm_s, 'cm/s'],

    // 行 5
    ['MV Mean PG', S.mv.mv_mean_pg_mmHg, 'mmHg'],
    ['MV PHT', S.mv.mv_pht_ms, 'ms'],
    ['MVA', S.der.mva.a, 'cm²'],

    // 行 6
    ['PV Vel',   S.pv.pv_vel_cm_s, 'cm/s'],
    ['PV Acc T', S.pv.pv_acc_ms,   'ms']

  ];
  const filledDV = itemsDV.filter(([_, v]) => v !== '' && v != null);
  pushThree(filledDV);


  // 4) Regurgitation Assessment 
  o.push('■ Regurgitation Assessment');  
  const regLines = rules.regDetails(S.r);

  regLines.forEach(line => o.push('• ' + line));

  o.push('');

  // 5) Other Assessment
  o.push('■ Other Assessment');
  o.push('• No pericardial effusion');
  o.push('• No regional wall abnormalities');

  o.push('');


  // 最后写入 textarea
  $('reportText').value = o.join('\n');
};




  // ---------- 10. buildUI & startup ----------
  
  function buildUI(){
    $('sex').onchange=e=>{ S.p.sex=e.target.value; calc(); };
    ['height_cm','weight_kg']
      .forEach(id=>$(id).oninput=e=>{
        S.p[id]=e.target.value;
        clearProxyOverride();
        calc();
      });
    const m2D=$('m-mode'),
          dopC=$('doppler'),
          regC=$('regurg');
    mm.forEach(f=>addInput(m2D,f,S.m));

    // 在 M-mode / 2D Measurements 最後加上 RV & RA dilatation checkbox
[['rv_dil','RV dilatation'], ['ra_dil','RA dilatation']].forEach(([id,label]) => {
  const d = document.createElement('div');
  d.className = 'col-6 col-md-4 mb-2';  // 跟其他數值欄位同樣的欄寬設定
  d.innerHTML = `
    <div class="form-check">
      <input id="${id}" class="form-check-input" type="checkbox">
      <label for="${id}" class="form-check-label small">${label}</label>
    </div>
  `;
  m2D.appendChild(d);
  // 監聽改變，把勾選狀態存到 S.m，並重新計算
  $(id).onchange = e => {
    S.m[id] = e.target.checked;
    calc();
  };
});

   
    const dvOrder = [
     // PV 開頭
     ['pv_vel_cm_s',    'PV Vel',        'cm/s', dopC, S.pv],
     ['pv_acc_ms',      'PV Acc T',      'ms',   dopC, S.pv],
     // Mitral E/A 之前的 MV E/A 拆成分項
     ['mv_e_cm_s',      'MV E',          'cm/s', dopC, S.d],
     ['mv_a_cm_s',      'MV A',          'cm/s', dopC, S.d],
     ['e_prime_sep_cm_s','e′ sep',       'cm/s', dopC, S.d],
     ['e_prime_lat_cm_s','e′ lat',       'cm/s', dopC, S.d],
     // TR Vmax
     ['tr_vmax_ms',     'TR Vmax',       'm/s',  dopC, S.d],
     // AV 系列
     ['av_vmax_ms',     'AV Vmax',       'm/s',  dopC,  S.av],
     ['av_vti_cm',      'AV VTI',        'cm',   dopC,  S.av],
     ['av_mean_pg_mmHg','AV Mean PG',    'mmHg', dopC,  S.av],
     // LVOT 系列
     ['lvot_vmax_ms',   'LVOT Vmax',     'm/s',  dopC, S.d],
     ['lvot_vti_cm',    'LVOT VTI',      'cm',   dopC, S.d],
     // TAS′
     ['tas_cm_s',       'TAS′',          'cm/s', dopC, S.d],
     // 最後 MV Flow
     ['mv_mean_pg_mmHg','MV Mean PG',    'mmHg', dopC,  S.mv],
     ['mv_pht_ms',      'MV PHT',        'ms',   dopC,  S.mv]
   ];
dvOrder.forEach(([id, label, unit, parent, store]) => {
  addInput(parent, [id, label, unit], store);
});

const dfContext = $('df-context');
addSelect(dfContext, 'rhythm', 'Rhythm', [
  ['', '請選擇心律'], ['sinus', 'Sinus rhythm'], ['af', 'Atrial fibrillation'],
  ['apcs', 'Sinus rhythm with APCs'], ['vpcs', 'Sinus rhythm with VPCs']
], S.context);
addSelect(dfContext, 'mr_mechanism', 'MR mechanism（severe MR 時必填）', [
  ['', '未確認 / 不適用'], ['primary', 'Primary MR'], ['secondary', 'Secondary MR']
], S.context);
addSelect(dfContext, 'supplemental_lap', 'Supplemental methods 綜合 LAP 判讀', [
  ['', '未評估'], ['normal', 'Normal LAP（已由其他方法確認）'], ['high', 'Increased LAP（已由其他方法確認）']
], S.context);
addSelect($('df-measures'), 'rap_mmHg', 'Selected RAP (mmHg)', [
  ['3', '3'], ['8', '8'], ['15', '15']
], S.d, 'rap_mmHg', '8');
addSelect($('df-measures'), 'lavi_override', 'LAVi surrogate criterion override', [
  ['auto', 'Auto — diameter-based rule'], ['high', 'Manual — treat as >34'], ['normal', 'Manual — treat as ≤34']
], S.context);
addCheck($('df-options'), 'pulmonary_vein_sd_confirmed', 'Pulmonary vein S/D ≤0.67', S.d);
addCheck($('df-options'), 'symptomatic', '有呼吸困難等症狀', S.context);
addCheck($('ph-context'), 'tr_unmeasurable', 'TR jet 無法可靠測量（排除已輸入 TR Vmax）', S.context);
[
  ['a', 'A · Ventricles'], ['b', 'B · Pulmonary artery'], ['c', 'C · IVC / RA']
].forEach(([key, label]) => addSelect($('ph-categories'), `ph_${key}`, label, [
  ['no', '已評估，無符合徵象'], ['yes', '有至少一項符合徵象']
], S.ph, key));

regList.forEach(([p, lbl]) => {
  const d = document.createElement('div');
  d.className = 'col-6 col-md-3 mb-2';
  // 新的 option 列表：Grade(默认), then EROA-based options
  const opts = ['Grade'];
  if (p === 'mr') {
    opts.push('mild','mild-moderate','moderate','moderate-severe','severe');
  } else if (p === 'ar' || p==='pr') {
    opts.push('mild','mild-moderate','moderate','moderate-severe','severe');
  } else if (p === 'tr') {
    opts.push('mild','mild-moderate','moderate','moderate-severe','severe','Massive','Torrential');
  }
  d.innerHTML = `
    <label for="${p}_grade" class="form-label small fw-bold">${lbl}</label>
    <div class="input-group input-group-sm mb-1">
      <input id="${p}_eroa" aria-label="${lbl} EROA" class="form-control" placeholder="EROA cm²" type="number" min="0" step="0.01">
      <select id="${p}_grade" class="form-select">
        ${opts.map((o, i)=>`<option value="${i === 0 ? '' : o}">${o}</option>`).join('')}
      </select>
    </div>`;
  regC.appendChild(d);
  ['eroa','grade'].forEach(suf => {
    $(`${p}_${suf}`)[suf === 'grade' ? 'onchange' : 'oninput'] = e => {
      S.r[e.target.id] = e.target.value;
      calc();
    };
  });
});




function resetForm() {
  // Clear hidden/imported context as well as all visible fields for a new case.
  for (const key of ['p', 'm', 'd', 'mv', 'av', 'pv', 'r', 'context', 'ph']) {
    Object.keys(S[key]).forEach(field => delete S[key][field]);
  }
  document.querySelectorAll('input, select').forEach(el => {
    if (el.type === 'checkbox') el.checked = false;
    else el.value = el.dataset.resetValue ?? (el.id === 'sex' ? 'M' : '');
    el.dispatchEvent(new Event(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input'));
  });
  $('reportText').value = '';
  calc();
}
$('resetForm').onclick = resetForm;
$('toggleNormal').onclick = function() {
    // 載入範例值
    const demo = {
      height_cm: 170,      weight_kg: 65,
      ao_root_mm: 30,      acs_mm: 12,         la_ap_mm: 35,
      ivsd_mm: 10,         lvidd_mm: 45,       lvpwd_mm: 10,
      lvids_mm: 30,        lavi_ml_m2: 28,     tapse_mm: 20,
      edd_ml: 90,          esv_ml: 40,         lvot_diam_mm: 20,
      pv_vel_cm_s: 50,     pv_acc_ms: 120,
      mv_e_cm_s: 80,       mv_a_cm_s: 50,
      e_prime_sep_cm_s:10, e_prime_lat_cm_s:12,
      tr_vmax_ms: 2.4,     tas_cm_s: 12,
      av_vti_cm: 24,       av_vmax_ms: 1.5,    av_mean_pg_mmHg: 5,
      mv_mean_pg_mmHg: 2,  mv_pht_ms: 80,
      lvot_vti_cm: 22,     lvot_vmax_ms: 1.2,
      mr_grade: 'mild',    ar_grade: '',       tr_grade: '',
      pr_grade: '', rhythm: 'sinus', ph_a: 'no', ph_b: 'no', ph_c: 'no'
    };
    // Clear every prior measurement/context so the example cannot retain exclusions.
    resetForm();
    Object.entries(demo).forEach(([id,val])=>{
      const el = document.getElementById(id);
      if (!el) return;
      el.value = val;
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input'));
    });
    calc();
};


    // 最後記得呼叫一次 calc 初始化
    calc();
  }

  // 頁面載入後執行 buildUI
  document.addEventListener('DOMContentLoaded', buildUI);
})();
