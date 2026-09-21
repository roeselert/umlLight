// Data model -> Avro schemas and OpenAPI specification.
// Both are derived from the entities, attributes and relations of a project
// and can be overridden by hand (like the diagram sources).

const clean = (s) => String(s ?? '').trim();

const ident = (s, fallback = 'Feld') => {
  const v = clean(s)
    .replace(/ä/gi, 'ae').replace(/ö/gi, 'oe').replace(/ü/gi, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_ -]/g, ' ');
  return v || fallback;
};

export const pascal = (s, fallback = 'Entity') => ident(s, fallback)
  .split(/[\s_-]+/).filter(Boolean)
  .map((w) => w[0].toUpperCase() + w.slice(1))
  .join('')
  .replace(/^(\d)/, '_$1') || fallback;

export const camel = (s, fallback = 'feld') => {
  const p = pascal(s, fallback);
  return p[0].toLowerCase() + p.slice(1);
};

const kebab = (s) => ident(s, 'resource').trim().split(/[\s_-]+/).filter(Boolean).join('-').toLowerCase();

/**
 * Path segment for an entity. English pluralisation is a convention, not a
 * rule — German names often read better in the singular, hence the option.
 */
export const pathSegment = (s, style = 'plural') => {
  const base = kebab(s);
  if (style === 'singular') return base;
  if (/(s|x|z|ch|sh)$/.test(base)) return `${base}es`;
  if (/[^aeiou]y$/.test(base)) return `${base.slice(0, -1)}ies`;
  return `${base}s`;
};

const normType = (t) => clean(t).toLowerCase();

// ---------------------------------------------------------------- Avro
const AVRO_TYPES = {
  string: 'string', text: 'string', uuid: { type: 'string', logicalType: 'uuid' },
  integer: 'int', int: 'int', long: 'long', decimal: 'double', double: 'double', float: 'float',
  number: 'double', boolean: 'boolean', bool: 'boolean',
  date: { type: 'int', logicalType: 'date' },
  datetime: { type: 'long', logicalType: 'timestamp-millis' },
  timestamp: { type: 'long', logicalType: 'timestamp-millis' },
  time: { type: 'int', logicalType: 'time-millis' },
  json: 'string', blob: 'bytes', bytes: 'bytes', enum: 'string',
};

const avroType = (type) => AVRO_TYPES[normType(type)] ?? 'string';

/** Reference fields implied by the relations, keyed by entity id. */
function referenceFields(dm) {
  const byId = new Map((dm.entities || []).map((e) => [e.id, e]));
  const refs = new Map();
  const add = (childId, parent, required) => {
    if (!byId.has(childId) || !parent) return;
    if (!refs.has(childId)) refs.set(childId, []);
    refs.get(childId).push({ name: `${camel(parent.name)}Id`, entity: parent, required });
  };
  for (const r of dm.relations || []) {
    const from = byId.get(r.from);
    const to = byId.get(r.to);
    if (!from || !to) continue;
    switch (r.type) {
      case '1-n': case '0-n': case 'compose': case 'aggregate': add(to.id, from, r.type === 'compose'); break;
      case 'n-1': add(from.id, to, true); break;
      case '1-1': add(to.id, from, true); break;
      case '0-1': add(to.id, from, false); break;
      default: break; // n-m needs a join table, inheritance is handled separately
    }
  }
  return refs;
}

const parentOf = (dm, entity) => (dm.relations || [])
  .filter((r) => r.type === 'inherit' && r.to === entity.id)
  .map((r) => (dm.entities || []).find((e) => e.id === r.from))
  .filter(Boolean)[0] || null;

const pkOf = (entity) => (entity.attributes || []).find((a) => a.key === 'pk' && clean(a.name));

export function avroSchema(project, opts = {}) {
  const dm = project.dataModel || {};
  const entities = (dm.entities || []).filter((e) => clean(e.name));
  const namespace = clean(opts.namespace) || `umllight.${camel(project.name, 'projekt').toLowerCase()}`;
  const refs = opts.includeRefs === false ? new Map() : referenceFields(dm);

  return entities.map((e) => {
    const parent = parentOf(dm, e);
    const own = (e.attributes || []).filter((a) => clean(a.name));
    const inherited = parent ? (parent.attributes || []).filter((a) => clean(a.name)) : [];
    const attrs = [...inherited, ...own];
    const seen = new Set(attrs.map((a) => camel(a.name)));

    const fields = attrs.map((a) => {
      const type = avroType(a.type);
      const required = !!a.required || a.key === 'pk';
      const field = { name: camel(a.name), type: required ? type : ['null', type] };
      if (!required) field.default = null;
      if (clean(a.description)) field.doc = clean(a.description);
      return field;
    });

    for (const ref of refs.get(e.id) || []) {
      if (seen.has(ref.name)) continue;
      seen.add(ref.name);
      const refPk = pkOf(ref.entity);
      const type = avroType(refPk?.type || 'uuid');
      fields.push({
        name: ref.name,
        type: ref.required ? type : ['null', type],
        ...(ref.required ? {} : { default: null }),
        doc: `Referenz auf ${ref.entity.name}`,
      });
    }

    const record = { type: 'record', name: pascal(e.name), namespace };
    const doc = [clean(e.description), parent ? `Erbt von ${parent.name}` : '', clean(e.stereotype) ? `«${e.stereotype}»` : '']
      .filter(Boolean).join(' — ');
    if (doc) record.doc = doc;
    record.fields = fields;
    return record;
  });
}

// ------------------------------------------------------------- OpenAPI
const OPENAPI_TYPES = {
  string: { type: 'string' }, text: { type: 'string' },
  uuid: { type: 'string', format: 'uuid' },
  integer: { type: 'integer', format: 'int64' }, int: { type: 'integer', format: 'int32' },
  long: { type: 'integer', format: 'int64' },
  decimal: { type: 'number', format: 'double' }, double: { type: 'number', format: 'double' },
  float: { type: 'number', format: 'float' }, number: { type: 'number' },
  boolean: { type: 'boolean' }, bool: { type: 'boolean' },
  date: { type: 'string', format: 'date' },
  datetime: { type: 'string', format: 'date-time' }, timestamp: { type: 'string', format: 'date-time' },
  time: { type: 'string' },
  json: { type: 'object', additionalProperties: true },
  blob: { type: 'string', format: 'byte' }, bytes: { type: 'string', format: 'byte' },
  enum: { type: 'string' },
};

const openApiType = (type) => ({ ...(OPENAPI_TYPES[normType(type)] ?? { type: 'string' }) });

export function openApiSpec(project, opts = {}) {
  const dm = project.dataModel || {};
  const entities = (dm.entities || []).filter((e) => clean(e.name));
  const refs = opts.includeRefs === false ? new Map() : referenceFields(dm);
  const withCrud = opts.includeCrud !== false;

  const schemas = {};
  const paths = {};
  const tags = [];

  for (const e of entities) {
    const name = pascal(e.name);
    const parent = parentOf(dm, e);
    const pk = pkOf(e) || (parent ? pkOf(parent) : null);
    const properties = {};
    const required = [];

    const addAttr = (a) => {
      const key = camel(a.name);
      const prop = openApiType(a.type);
      if (clean(a.description)) prop.description = clean(a.description);
      if (a.key === 'pk') prop.readOnly = true;
      properties[key] = prop;
      if (a.required || a.key === 'pk') required.push(key);
    };
    for (const a of (e.attributes || []).filter((x) => clean(x.name))) addAttr(a);
    for (const ref of refs.get(e.id) || []) {
      if (properties[ref.name]) continue;
      const refPk = pkOf(ref.entity);
      properties[ref.name] = { ...openApiType(refPk?.type || 'uuid'), description: `Referenz auf ${ref.entity.name}` };
      if (ref.required) required.push(ref.name);
    }

    const schema = { type: 'object' };
    const description = [clean(e.description), clean(e.stereotype) ? `«${e.stereotype}»` : ''].filter(Boolean).join(' — ');
    if (description) schema.description = description;
    schema.properties = properties;
    if (required.length) schema.required = [...new Set(required)];

    schemas[name] = parent
      ? { allOf: [{ $ref: `#/components/schemas/${pascal(parent.name)}` }, schema] }
      : schema;

    if (withCrud) {
      const writable = Object.fromEntries(Object.entries(properties).filter(([, v]) => !v.readOnly));
      const writableRequired = (schema.required || []).filter((k) => writable[k]);
      schemas[`${name}Input`] = {
        type: 'object',
        description: `Schreibbare Felder von ${e.name}`,
        properties: writable,
        ...(writableRequired.length ? { required: writableRequired } : {}),
      };

      const collection = `/${pathSegment(e.name, opts.pathStyle)}`;
      const item = `${collection}/{${camel(pk?.name || 'id')}}`;
      const tag = name;
      tags.push({ name: tag, ...(clean(e.description) ? { description: clean(e.description) } : {}) });
      const ref = { $ref: `#/components/schemas/${name}` };
      const inputRef = { $ref: `#/components/schemas/${name}Input` };
      const errorRef = { $ref: '#/components/responses/Error' };

      paths[collection] = {
        get: {
          tags: [tag], summary: `${e.name} auflisten`, operationId: `list${name}`,
          parameters: [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/Offset' }],
          responses: {
            200: {
              description: 'Liste',
              content: { 'application/json': { schema: { type: 'array', items: ref } } },
            },
            400: errorRef,
          },
        },
        post: {
          tags: [tag], summary: `${e.name} anlegen`, operationId: `create${name}`,
          requestBody: { required: true, content: { 'application/json': { schema: inputRef } } },
          responses: {
            201: { description: 'Angelegt', content: { 'application/json': { schema: ref } } },
            400: errorRef,
          },
        },
      };
      paths[item] = {
        parameters: [{
          name: camel(pk?.name || 'id'), in: 'path', required: true,
          description: `Schlüssel von ${e.name}`,
          schema: openApiType(pk?.type || 'uuid'),
        }],
        get: {
          tags: [tag], summary: `${e.name} lesen`, operationId: `get${name}`,
          responses: {
            200: { description: 'Gefunden', content: { 'application/json': { schema: ref } } },
            404: { $ref: '#/components/responses/NotFound' },
          },
        },
        patch: {
          tags: [tag], summary: `${e.name} ändern`, operationId: `update${name}`,
          requestBody: { required: true, content: { 'application/json': { schema: inputRef } } },
          responses: {
            200: { description: 'Geändert', content: { 'application/json': { schema: ref } } },
            400: errorRef,
            404: { $ref: '#/components/responses/NotFound' },
          },
        },
        delete: {
          tags: [tag], summary: `${e.name} löschen`, operationId: `delete${name}`,
          responses: { 204: { description: 'Gelöscht' }, 404: { $ref: '#/components/responses/NotFound' } },
        },
      };
    }
  }

  schemas.Error = {
    type: 'object',
    properties: { code: { type: 'string' }, message: { type: 'string' } },
    required: ['message'],
  };

  const spec = {
    openapi: '3.1.0',
    info: {
      title: clean(opts.title) || `${project.name} API`,
      version: clean(opts.version) || '1.0.0',
      ...(clean(project.summary) ? { description: clean(project.summary) } : {}),
    },
    servers: [{ url: clean(opts.server) || 'https://api.example.com/v1' }],
    ...(tags.length ? { tags } : {}),
    paths,
    components: {
      schemas,
      ...(withCrud ? {
        parameters: {
          Limit: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 }, description: 'Maximale Anzahl Einträge' },
          Offset: { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0, default: 0 }, description: 'Versatz für Paginierung' },
        },
        responses: {
          Error: { description: 'Fehlerhafte Anfrage', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          NotFound: { description: 'Nicht gefunden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      } : {}),
    },
  };

  if (opts.auth === 'bearer') {
    spec.components.securitySchemes = { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } };
    spec.security = [{ bearerAuth: [] }];
  } else if (opts.auth === 'apiKey') {
    spec.components.securitySchemes = { apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } };
    spec.security = [{ apiKey: [] }];
  } else if (opts.auth === 'oauth2') {
    spec.components.securitySchemes = {
      oauth2: {
        type: 'oauth2',
        flows: { authorizationCode: { authorizationUrl: 'https://auth.example.com/authorize', tokenUrl: 'https://auth.example.com/token', scopes: { read: 'Lesen', write: 'Schreiben' } } },
      },
    };
    spec.security = [{ oauth2: ['read', 'write'] }];
  }
  return spec;
}

// ---------------------------------------------------------------- YAML
const NEEDS_QUOTES = /^(\s|$)|[:#\-?&*!|>'"%@`{}[\],]|^(true|false|null|yes|no|on|off|~)$|^-?\d/i;

function yamlScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  const s = String(v);
  if (s.includes('\n')) return null; // handled by the caller as a block scalar
  return NEEDS_QUOTES.test(s) ? `'${s.replace(/'/g, "''")}'` : s;
}

/** Small YAML emitter for plain JSON structures. */
export function toYaml(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return `${pad}[]`;
    return value.map((item) => {
      if (item !== null && typeof item === 'object') {
        const inner = toYaml(item, indent + 2);
        return `${pad}- ${inner.slice(indent + 2)}`;
      }
      return `${pad}- ${yamlScalar(item) ?? ''}`;
    }).join('\n');
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) return `${pad}{}`;
    return keys.map((k) => {
      const v = value[k];
      const key = /^[\w.$/-]+$/.test(k) && !/^\d+$/.test(k) ? k : `'${k.replace(/'/g, "''")}'`;
      if (v !== null && typeof v === 'object') {
        const isEmpty = Array.isArray(v) ? !v.length : !Object.keys(v).length;
        if (isEmpty) return `${pad}${key}: ${Array.isArray(v) ? '[]' : '{}'}`;
        return `${pad}${key}:\n${toYaml(v, indent + 2)}`;
      }
      const scalar = yamlScalar(v);
      if (scalar === null) {
        const block = String(v).split('\n').map((line) => `${pad}  ${line}`).join('\n');
        return `${pad}${key}: |-\n${block}`;
      }
      return `${pad}${key}: ${scalar}`;
    }).join('\n');
  }
  return `${pad}${yamlScalar(value) ?? ''}`;
}

export const avroText = (project, opts) => JSON.stringify(avroSchema(project, opts), null, 2);

export const openApiText = (project, opts = {}) => (opts.format === 'json'
  ? JSON.stringify(openApiSpec(project, opts), null, 2)
  : toYaml(openApiSpec(project, opts)));
