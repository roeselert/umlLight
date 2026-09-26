// Robustness model helpers (boundary–control–entity): the participants of a
// project, the ICONIX interaction rules and the API operations a boundary can
// be linked to.

import { openApiSpec } from './schemas.js';

const clean = (s) => String(s ?? '').trim();

export const KINDS = {
  actor: { label: 'Akteur', short: 'A' },
  boundary: { label: 'Boundary', short: 'B' },
  control: { label: 'Control', short: 'C' },
  entity: { label: 'Entity', short: 'E' },
};

export const BOUNDARY_KINDS = [['ui', 'Oberfläche / Maske'], ['api', 'API'], ['external', 'Fremdsystem-Schnittstelle']];

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Everything that can take part in an interaction, in display order. */
export function participants(project) {
  const rb = project.robustness || {};
  return [
    ...(project.useCases?.actors || []).map((a) => ({ id: a.id, kind: 'actor', name: a.name || 'Akteur', componentId: '' })),
    ...(rb.boundaries || []).map((b) => ({ id: b.id, kind: 'boundary', name: b.name || 'Boundary', componentId: b.componentId || '', ref: b })),
    ...(rb.controls || []).map((c) => ({ id: c.id, kind: 'control', name: c.name || 'Control', componentId: c.componentId || '', ref: c })),
    ...(project.dataModel?.entities || []).map((e) => ({ id: e.id, kind: 'entity', name: e.name || 'Entität', componentId: e.componentId || '', ref: e })),
  ];
}

// Robustness rules: actors talk to boundaries, boundaries to controls,
// controls to entities, boundaries and other controls. Nouns never talk to
// nouns directly.
const ORDER = ['actor', 'boundary', 'control', 'entity'];
const ALLOWED = new Set(['actor-boundary', 'boundary-control', 'control-control', 'control-entity']);

/** @returns {string|null} why a link breaks the robustness rules */
export function ruleViolation(fromKind, toKind) {
  if (!fromKind || !toKind) return 'Unbekanntes Element';
  const pair = [fromKind, toKind].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).join('-');
  if (ALLOWED.has(pair)) return null;
  if (pair === 'boundary-boundary') return 'Navigation zwischen Boundaries über ein Control führen';
  if (pair === 'entity-entity') return 'Entitäten über Beziehungen im Entitäten-Tab verbinden';
  if (pair === 'actor-actor') return 'Akteure interagieren nur mit Boundaries';
  if (pair.startsWith('actor-')) return 'Akteure sprechen nur mit Boundaries';
  return 'Boundaries und Entitäten nur über ein Control verbinden';
}

/** Operations of the generated OpenAPI spec (entity CRUD), for linking. */
export function generatedOperations(project) {
  const spec = openApiSpec(project, { ...(project.schemas?.openapi || {}), boundaryOps: false });
  const ops = [];
  for (const [path, item] of Object.entries(spec.paths || {})) {
    for (const method of HTTP_METHODS) {
      const op = item[method.toLowerCase()];
      if (op) ops.push({ method, path, summary: op.summary || '' });
    }
  }
  return ops;
}

export const opKey = (op) => `${clean(op.method).toUpperCase()} ${clean(op.path)}`;

export const componentName = (project, id) =>
  (project.robustness?.components || []).find((c) => c.id === id)?.name || '';
