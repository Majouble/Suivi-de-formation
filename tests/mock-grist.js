// Faux grist-plugin-api pour tester gestion-acces.js hors de Grist.
// Le document est fourni par window.__DOC (tables → tableaux de lignes).
(function () {
  const doc = window.__DOC;
  const nextId = {};
  function maxId(t) { return Math.max(0, ...(doc[t] || []).map((r) => r.id)); }
  function newId(t) { nextId[t] = Math.max(nextId[t] || 0, maxId(t)) + 1; return nextId[t]; }
  function colsOf(tableId) {
    const t = doc._grist_Tables.find((x) => x.tableId === tableId);
    return doc._grist_Tables_column.filter((c) => c.parentId === t.id).map((c) => c.colId);
  }
  function toColumnar(rows, tableId) {
    const out = { id: rows.map((r) => r.id) };
    const keys = new Set();
    rows.forEach((r) => Object.keys(r).forEach((k) => k !== 'id' && keys.add(k)));
    if (tableId && !tableId.startsWith('_grist')) colsOf(tableId).forEach((k) => keys.add(k));
    keys.forEach((k) => { out[k] = rows.map((r) => (k in r ? r[k] : null)); });
    return out;
  }
  // Validation inspirée de ACLRuleCollection.readAclRules / checkDocEntities.
  function valider(d) {
    const res = new Map(d._grist_ACLResources.map((r) => [r.id, r]));
    const parRes = new Map();
    for (const r of [...d._grist_ACLRules].sort((a, b) => a.rulePos - b.rulePos)) {
      const rr = res.get(r.resource);
      if (!rr) throw new Error(`ACLRule ${r.id} refers to an invalid ACLResource ${r.resource}`);
      if (!rr.tableId) continue;
      if (r.userAttributes) {
        if (rr.tableId !== '*' || rr.colIds !== '*') throw new Error('user attributes must be on the default resource');
        const ua = JSON.parse(r.userAttributes);
        const cols = colsOf(ua.tableId);
        if (!cols.includes(ua.lookupColId)) throw new Error(`Invalid user attribute column ${ua.tableId}.${ua.lookupColId}`);
        continue;
      }
      const body = parRes.get(r.resource) || [];
      if (body.length && !body[body.length - 1].aclFormula) throw new Error(`ACLRule ${r.id} invalid because listed after default rule`);
      if (!/^([+-][CRUDS]+)*$/.test(r.permissionsText)) throw new Error(`Invalid permissions ${r.permissionsText}`);
      body.push(r);
      parRes.set(r.resource, body);
    }
    const keys = new Set();
    for (const rr of d._grist_ACLResources) {
      if (!rr.tableId) continue;
      const k = rr.tableId + '|' + rr.colIds;
      if (keys.has(k)) throw new Error('duplicate resource ' + k);
      keys.add(k);
      if (rr.tableId === '*' || rr.tableId === '*SPECIAL') continue;
      if (!d._grist_Tables.some((t) => t.tableId === rr.tableId)) throw new Error('Invalid tables in rules: ' + rr.tableId);
      if (rr.colIds !== '*') {
        const cols = colsOf(rr.tableId);
        const bad = rr.colIds.split(',').filter((c) => !cols.includes(c));
        if (bad.length) throw new Error(`Invalid columns in rules for table ${rr.tableId}: ${bad.join(', ')}`);
      }
    }
  }
  window.__ACTIONS = [];
  window.grist = {
    ready() {},
    docApi: {
      async fetchTable(t) {
        if (window.__NON_OWNER && t.startsWith('_grist_ACL')) return { id: [] };
        if (!doc[t]) throw new Error(`Table not found "${t}"`);
        return toColumnar(doc[t], t);
      },
      async applyUserActions(actions) {
        window.__ACTIONS.push(actions);
        const backup = JSON.parse(JSON.stringify(doc));
        try {
          const negMap = {};
          for (const a of actions) {
            const [type, t] = a;
            if (type === 'AddColumn') {
              const tab = doc._grist_Tables.find((x) => x.tableId === t);
              doc._grist_Tables_column.push({ id: newId('_grist_Tables_column'), parentId: tab.id, colId: a[2], ...a[3] });
            } else if (type === 'ModifyColumn') {
              const tab = doc._grist_Tables.find((x) => x.tableId === t);
              Object.assign(doc._grist_Tables_column.find((c) => c.parentId === tab.id && c.colId === a[2]), a[3]);
            } else if (type === 'BulkRemoveRecord') {
              doc[t] = doc[t].filter((r) => !a[2].includes(r.id));
            } else if (type === 'BulkAddRecord') {
              a[2].forEach((rid, i) => {
                const id = newId(t);
                if (rid < 0) negMap[t + rid] = id;
                const row = { id };
                for (const [k, vals] of Object.entries(a[3])) row[k] = vals[i];
                if (t === '_grist_ACLRules' && row.resource < 0) row.resource = negMap['_grist_ACLResources' + row.resource];
                doc[t].push(row);
              });
            } else if (type === 'AddRecord') {
              doc[t].push({ id: newId(t), ...a[3] });
            } else if (type === 'UpdateRecord') {
              Object.assign(doc[t].find((r) => r.id === a[2]), a[3]);
            } else {
              throw new Error('Action non simulée : ' + type);
            }
          }
          if (window.__REFUSER && actions.some((x) => String(x[1]).startsWith('_grist_ACL'))) throw new Error(window.__REFUSER);
          valider(doc);
        } catch (e) {
          Object.keys(backup).forEach((k) => { doc[k] = backup[k]; });
          throw e;
        }
        return {};
      },
    },
  };
})();
