// Exporta fatos gravados, sem deduzir nomes pelo plano atual ou concluir sessões.
const COLUMNS = ['aluno_id','origem','chave_origem','indice_arquivo','indice_registro',
  'data_iso','data_original','sessao_id','exercicio','origem_nome','carga_kg','carga_2_kg',
  'reps_1','reps_2','reps_3','reps_4','reps_5','reps_6','adaptacao','deload','tecnica','registro_json',
  // P87: trilha da correção encerrada (sessions[].corrections), ao fim para não mover colunas existentes.
  'correcoes','correcoes_json'];

function cell(value) {
  let text = value == null ? '' : String(value);
  // Aspas CSV não impedem execução de fórmulas em planilhas.
  if (/^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function buildHistoryCsv({ studentId, studentIds, entries }) {
  if (typeof studentId !== 'string' || !studentId || studentId.length > 200 || !Array.isArray(entries)
    || !Array.isArray(studentIds) || !studentIds.includes(studentId)
    || studentIds.some(id => typeof id !== 'string' || !id || id.length > 200))
    throw Error('Aluno ou histórico indisponível');
  const prefix = 'hist_' + studentId + '_', archiveKey = 'otd_' + studentId + '_hist_archive';
  const rows = [];
  // P87: correções ficam na sessão; ligam-se ao registro por sessão + nome do exercício.
  const trail = new Map(), sessionsKey = 'otd_' + studentId + '_sessions';
  for (const [key, value] of entries) {
    if (key !== sessionsKey) continue;
    let list;
    try { list = JSON.parse(value); } catch (_) { throw Error('Sessões ilegíveis; a trilha de correções não pode ser exportada'); }
    if (!Array.isArray(list)) throw Error('Sessões ilegíveis; a trilha de correções não pode ser exportada');
    for (const st of list) {
      if (!st || typeof st !== 'object' || st.corrections == null) continue;
      if (!Array.isArray(st.corrections)) throw Error('Histórico de correções inválido na sessão ' + st.id);
      for (const c of st.corrections) {
        if (!c || typeof c !== 'object') throw Error('Histórico de correções inválido na sessão ' + st.id);
        const id = JSON.stringify([st.id, c.exerciseName]);
        if (!trail.has(id)) trail.set(id, []);
        trail.get(id).push({ revision: c.revision, at: c.at, actor: c.actor, reason: c.reason, before: c.before, after: c.after });
      }
    }
  }
  function append(records, key, archiveIndex = '', archiveName = '') {
    if (!Array.isArray(records)) throw Error('Histórico inválido em ' + key);
    records.forEach((r, index) => {
      if (!r || typeof r !== 'object' || Array.isArray(r)) throw Error('Registro inválido em ' + key);
      const name = typeof r.exerciseName === 'string' && r.exerciseName ? r.exerciseName : archiveName;
      rows.push([studentId, archiveIndex === '' ? 'historico' : 'arquivo', key, archiveIndex, index,
        r.iso, r.d, r.sessionId, name, r.exerciseName ? 'registro' : archiveName ? 'arquivo' : 'ausente',
        r.w, r.w2, ...Array.from({ length: 6 }, (_, i) => r['r' + (i + 1)]),
        r.adapted, r.deload, r.tech, JSON.stringify(r),
        ...(t => [t.length, t.length ? JSON.stringify(t) : ''])(r.sessionId ? trail.get(JSON.stringify([r.sessionId, name])) || [] : [])]);
    });
  }
  for (const [key, value] of entries) {
    if (typeof key !== 'string' || (!key.startsWith(prefix) && key !== archiveKey)) continue;
    // IDs legados podem conter "_": p não deve incluir o histórico de p_x.
    if (key !== archiveKey && studentIds.filter(id => key.startsWith('hist_' + id + '_'))
      .sort((a, b) => b.length - a.length)[0] !== studentId) continue;
    let data;
    try { data = JSON.parse(value); } catch (_) { throw Error('Histórico ilegível em ' + key); }
    if (key === archiveKey) {
      if (!Array.isArray(data)) throw Error('Arquivo de histórico inválido');
      data.forEach((archive, index) => {
        if (!archive || typeof archive !== 'object') throw Error('Histórico arquivado inválido');
        append(archive.h, key, index, typeof archive.n === 'string' ? archive.n : '');
      });
    } else append(data, key);
  }
  return { count: rows.length, csv: '\uFEFF' + [COLUMNS, ...rows].map(row => row.map(cell).join(';')).join('\r\n') + '\r\n' };
}
