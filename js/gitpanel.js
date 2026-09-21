// Per-project synchronisation dialog: target repository, status, push/pull,
// conflict resolution, pull requests and commit history.

import { h, clear, modal, toast, confirmDialog, field, textInput } from './ui.js';
import * as gh from './github.js';
import * as sync from './gitsync.js';

const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return iso || ''; }
};

const CHIP_CLASS = {
  [sync.STATUS.SYNCED]: 'on',
  [sync.STATUS.LOCAL]: 'warn',
  [sync.STATUS.REMOTE]: 'warn',
  [sync.STATUS.DIVERGED]: 'danger',
  [sync.STATUS.REMOTE_MISSING]: 'danger',
  [sync.STATUS.UNLINKED]: '',
};

export function statusChip(status) {
  return h('span', { class: `chip ${CHIP_CLASS[status] ?? ''}` }, sync.STATUS_LABEL[status] || status);
}

function setupScreen(close, what = 'Die Synchronisation') {
  return h('div', {},
    h('h2', {}, 'Daten-Repository einrichten'),
    h('p', { class: 'hint' },
      `${what} braucht ein Repository und einen feingranularen Zugriffstoken (Berechtigung „Contents: read and write", für Pull Requests zusätzlich „Pull requests: write"). Am besten ein eigenes Repository für Spezifikationen — nicht das, in dem die App liegt.`),
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn ghost', onclick: () => close() }, 'Später'),
      h('button', {
        class: 'btn primary',
        onclick: () => { close(); document.dispatchEvent(new CustomEvent('umllight:settings', { detail: { focus: 'git' } })); },
      }, 'Einstellungen öffnen')));
}

/** Repository / branch / path editor, used for linking and for re-targeting. */
function targetEditor(initial, { onRepoWarning } = {}) {
  const value = {
    repoFull: initial.owner && initial.repo ? `${initial.owner}/${initial.repo}` : '',
    branch: initial.branch || '',
    path: initial.path || '',
  };
  const repoList = h('datalist', { id: 'git-repo-list' });
  const warn = h('div', { class: 'hint', style: { margin: '2px 0 10px' } });

  const checkSelf = () => {
    const { owner, repo } = gh.parseRepoFull(value.repoFull);
    if (owner && repo && gh.isSelfRepo({ owner, repo })) {
      warn.style.color = 'var(--warn)';
      warn.textContent = 'Das ist das Repository der App selbst. Für Spezifikationen besser ein eigenes Datenrepository wählen.';
      if (onRepoWarning) onRepoWarning(true);
    } else {
      warn.textContent = '';
      if (onRepoWarning) onRepoWarning(false);
    }
  };

  const repoInput = h('input', {
    type: 'text', value: value.repoFull, list: 'git-repo-list', spellcheck: 'false',
    placeholder: 'owner/repository',
    oninput: (e) => { value.repoFull = e.target.value; checkSelf(); },
  });

  const loadRepos = async (btn) => {
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = 'Lade …';
    try {
      const repos = await gh.listMyRepos();
      clear(repoList);
      repos.filter((r) => r.push).forEach((r) => repoList.appendChild(h('option', { value: r.full })));
      btn.textContent = `${repos.length} gefunden`;
    } catch (err) {
      toast(err.message, 'err');
      btn.textContent = prev;
    } finally {
      btn.disabled = false;
    }
  };

  const branchInput = h('input', {
    type: 'text', value: value.branch, placeholder: 'Standard-Branch', spellcheck: 'false',
  });
  const pathInput = h('input', {
    type: 'text', value: value.path, placeholder: 'umllight/projekt.json', spellcheck: 'false',
  });

  const el = h('div', {},
    field('Repository', h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
      repoInput, repoList,
      h('button', { class: 'btn small', onclick: (e) => loadRepos(e.target) }, 'Laden'))),
    warn,
    h('div', { class: 'grid-2' },
      field('Branch', branchInput),
      field('Pfad', pathInput)));
  checkSelf();

  // Read straight from the DOM so a value never depends on an input event
  // having fired (datalist picks, autofill, programmatic changes).
  el.read = () => {
    const { owner, repo } = gh.parseRepoFull(repoInput.value);
    return { owner, repo, branch: branchInput.value.trim(), path: pathInput.value.trim() };
  };
  return el;
}

/**
 * @param {object} project
 * @param {() => void} [onChanged] called after the local project was replaced
 */
export function openGitDialog(project, onChanged) {
  return modal((close) => {
    const initialTarget = sync.targetFor(project);
    if (!gh.isConfigured(initialTarget)) return setupScreen(close);

    const statusBox = h('div', { class: 'card', style: { marginBottom: '12px' } }, h('div', { class: 'spinner' }));
    const actions = h('div', { class: 'btn-row', style: { marginBottom: '8px' } });
    const historyBox = h('div', {});
    const log = h('div', { class: 'hint', style: { margin: '8px 0 0' } });
    const targetBox = h('div', {});

    let current = null;
    let editor = null;
    let message = '';

    const showEditor = (linked) => {
      clear(targetBox);
      const state = sync.linkOf(project);
      const target = sync.targetFor(project);
      editor = targetEditor({
        owner: target.owner,
        repo: target.repo,
        branch: state?.branch || target.branch || '',
        path: state?.path || sync.defaultPath(project, target),
      });
      targetBox.appendChild(h('h3', {}, linked ? 'Ziel ändern' : 'Ziel'));
      targetBox.appendChild(editor);
      if (linked) {
        targetBox.appendChild(h('div', { class: 'btn-row', style: { marginBottom: '10px' } },
          h('button', {
            class: 'btn small',
            onclick: async () => {
              const t = editor.read();
              if (!t.owner || !t.repo) { toast('Repository als owner/name angeben', 'err'); return; }
              await sync.retarget(project, t);
              editor = null;
              clear(targetBox);
              log.textContent = 'Ziel geändert — der nächste Push legt die Datei dort an.';
              if (onChanged) onChanged();
              refresh(true);
            },
          }, 'Übernehmen'),
          h('button', { class: 'btn small ghost', onclick: () => { editor = null; clear(targetBox); renderStatus(); } }, 'Abbrechen')));
      }
    };

    const setBusy = (text) => {
      log.style.color = '';
      log.textContent = text;
      [...actions.querySelectorAll('button')].forEach((b) => { b.disabled = true; });
    };
    const fail = (err) => {
      log.style.color = 'var(--danger)';
      log.textContent = err.message || String(err);
      [...actions.querySelectorAll('button')].forEach((b) => { b.disabled = false; });
    };
    const act = (label, fn, cls = 'btn') => h('button', {
      class: cls,
      onclick: async () => { setBusy('Arbeite …'); try { await fn(); } catch (err) { fail(err); } },
    }, label);

    async function refresh(networked = true) {
      clear(statusBox);
      statusBox.appendChild(h('div', { class: 'spinner' }));
      try {
        current = networked ? await sync.status(project) : await sync.quickStatus(project);
      } catch (err) {
        clear(statusBox);
        statusBox.appendChild(h('div', { class: 'hint', style: { color: 'var(--danger)', margin: 0 } }, err.message));
        clear(actions);
        actions.appendChild(act('Erneut prüfen', () => refresh(true)));
        return;
      }
      renderStatus();
      renderActions();
    }

    function renderStatus() {
      const st = current.state;
      const target = sync.targetFor(project);
      clear(statusBox);
      statusBox.appendChild(h('div', { class: 'row', style: { marginBottom: '8px' } },
        h('strong', { style: { flex: '1 1 auto' } }, project.name),
        statusChip(current.status)));
      statusBox.appendChild(h('div', { class: 'hint', style: { margin: 0 } },
        st
          ? `${gh.targetLabel(target)} · ${st.branch || 'Standard-Branch'} · ${st.path}`
          : `Ziel: ${gh.targetLabel(target)}${target.path ? ` · ${target.path}/` : ''}`));
      if (st?.syncedAt) {
        statusBox.appendChild(h('div', { class: 'hint', style: { margin: '4px 0 0' } },
          `Zuletzt synchronisiert: ${fmtDate(st.syncedAt)}`));
      }
      if (st?.lastPr) {
        statusBox.appendChild(h('div', { class: 'hint', style: { margin: '4px 0 0' } },
          'Letzter Pull Request: ', h('a', { href: st.lastPr.url, target: '_blank', rel: 'noopener' }, `#${st.lastPr.number}`)));
      }
      if (st && !editor) {
        statusBox.appendChild(h('button', {
          class: 'btn small ghost', style: { marginTop: '8px' },
          onclick: () => showEditor(true),
        }, 'Ziel ändern'));
      }
      if (!st && !editor) showEditor(false);
    }

    const done = (text) => {
      log.style.color = '';
      log.textContent = text;
      if (onChanged) onChanged();
      refresh(true);
    };

    function renderActions() {
      clear(actions);
      const s = current.status;

      if (s === sync.STATUS.UNLINKED) {
        actions.appendChild(act('Verknüpfen & pushen', async () => {
          const t = editor ? editor.read() : {};
          if (!t.owner || !t.repo) throw new Error('Repository als owner/name angeben.');
          await sync.link(project, t);
          try {
            await sync.push(project, { message: message.trim() || undefined });
          } catch (err) {
            if (err.code === 'exists') {
              const useRemote = await confirmDialog('Datei existiert bereits',
                `Unter „${sync.linkOf(project).path}" liegt bereits eine Datei. Deren Inhalt laden (lokale Fassung wird ersetzt)?`, 'Laden');
              if (useRemote) { await sync.pull(project); clear(targetBox); editor = null; done('Vom Repository geladen.'); return; }
              throw new Error('Push abgebrochen — anderen Pfad wählen oder Datei laden.');
            }
            throw err;
          }
          clear(targetBox);
          editor = null;
          done('Projekt wurde committet und gepusht.');
        }, 'btn primary'));
      }

      if (s === sync.STATUS.LOCAL || s === sync.STATUS.REMOTE_MISSING) {
        actions.appendChild(act('Commit & Push', async () => {
          await sync.push(project, { message: message.trim() || undefined, force: s === sync.STATUS.REMOTE_MISSING });
          done('Änderungen gepusht.');
        }, 'btn primary'));
      }

      if (s === sync.STATUS.REMOTE) {
        actions.appendChild(act('Pull (Repository übernehmen)', async () => {
          await sync.pull(project);
          done('Stand aus dem Repository übernommen.');
        }, 'btn primary'));
      }

      if (s === sync.STATUS.DIVERGED) {
        actions.appendChild(act('Remote übernehmen (lokale Änderungen verwerfen)', async () => {
          if (!(await confirmDialog('Lokale Änderungen verwerfen?',
            'Die lokale Fassung wird durch den Stand im Repository ersetzt.', 'Übernehmen'))) return;
          await sync.pull(project);
          done('Stand aus dem Repository übernommen.');
        }));
        actions.appendChild(act('Lokal überschreiben (Force-Push)', async () => {
          if (!(await confirmDialog('Repository überschreiben?',
            'Die Fassung im Repository wird durch die lokale ersetzt. Die Historie bleibt erhalten.', 'Überschreiben'))) return;
          await sync.push(project, { message: message.trim() || undefined, force: true });
          done('Lokale Fassung gepusht.');
        }));
      }

      if (s !== sync.STATUS.UNLINKED && s !== sync.STATUS.SYNCED) {
        actions.appendChild(act('Als Pull Request', async () => {
          const { pr } = await sync.pushAsPullRequest(project, { message: message.trim() || undefined });
          done(`Pull Request #${pr.number} erstellt.`);
          window.open(pr.html_url, '_blank', 'noopener');
        }));
      }

      if (s === sync.STATUS.SYNCED) {
        actions.appendChild(h('span', { class: 'hint', style: { margin: 0 } }, 'Lokal und im Repository identisch.'));
      }

      actions.appendChild(act('Status prüfen', () => refresh(true), 'btn ghost'));
      if (s !== sync.STATUS.UNLINKED) {
        actions.appendChild(h('button', {
          class: 'btn ghost',
          onclick: async () => {
            if (!(await confirmDialog('Verknüpfung lösen?',
              'Das Projekt bleibt lokal und im Repository erhalten, wird aber nicht mehr synchronisiert.', 'Lösen'))) return;
            sync.unlink(project);
            editor = null;
            if (onChanged) onChanged();
            refresh(false);
          },
        }, 'Verknüpfung lösen'));
      }
    }

    async function loadHistory() {
      clear(historyBox);
      historyBox.appendChild(h('div', { class: 'spinner' }));
      try {
        const commits = await sync.history(project, 20);
        clear(historyBox);
        if (!commits.length) {
          historyBox.appendChild(h('div', { class: 'hint' }, 'Noch keine Commits für diese Datei.'));
          return;
        }
        for (const c of commits) {
          historyBox.appendChild(h('div', { class: 'item' },
            h('div', { class: 'item-head', style: { cursor: 'default' } },
              h('span', { class: 'title' }, c.message || c.sha.slice(0, 7)),
              h('span', { class: 'meta' }, `${c.author} · ${fmtDate(c.date)}`)),
            h('div', { class: 'item-body' },
              h('div', { class: 'btn-row' },
                h('a', { class: 'btn small', href: c.url, target: '_blank', rel: 'noopener' }, 'Auf GitHub ↗'),
                h('button', {
                  class: 'btn small',
                  onclick: async () => {
                    if (!(await confirmDialog('Version wiederherstellen?',
                      `Die lokale Fassung wird durch den Stand aus „${c.message || c.sha.slice(0, 7)}" ersetzt. Erst nach einem Push landet sie im Repository.`,
                      'Wiederherstellen'))) return;
                    try {
                      await sync.restore(project, c.sha);
                      toast('Version lokal wiederhergestellt');
                      if (onChanged) onChanged();
                      refresh(true);
                    } catch (err) { fail(err); }
                  },
                }, 'Lokal wiederherstellen')))));
        }
      } catch (err) {
        clear(historyBox);
        historyBox.appendChild(h('div', { class: 'hint', style: { color: 'var(--danger)' } }, err.message));
      }
    }

    const body = h('div', {},
      h('h2', {}, 'Repository-Synchronisation'),
      statusBox,
      targetBox,
      field('Commit-Nachricht (optional)',
        textInput('', (val) => { message = val; }, { placeholder: sync.commitMessage(project) })),
      actions,
      log,
      h('div', { class: 'card', style: { marginTop: '14px' } },
        h('div', { class: 'card-head' },
          h('h3', {}, 'Verlauf'),
          h('button', { class: 'btn small', onclick: loadHistory }, 'Laden')),
        historyBox),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn primary', onclick: () => close() }, 'Schließen')));

    refresh(true);
    return body;
  });
}

/** Import dialog for project files that exist in a repository but not locally. */
export function openImportDialog(onImported) {
  return modal((close) => {
    if (!gh.isConfigured()) return setupScreen(close, 'Der Import');

    const list = h('div', {});
    const log = h('div', { class: 'hint', style: { margin: '8px 0 0' } });
    const editor = targetEditor(gh.defaultTarget());

    async function load() {
      clear(list);
      list.appendChild(h('div', { class: 'spinner' }));
      const t = editor.read();
      try {
        const entries = await sync.listRemoteProjects({ owner: t.owner, repo: t.repo, branch: t.branch, path: t.path });
        clear(list);
        if (!entries.length) {
          list.appendChild(h('div', { class: 'empty' }, 'Keine Projektdateien in diesem Verzeichnis gefunden.'));
          return;
        }
        for (const e of entries) {
          list.appendChild(h('div', { class: 'item' },
            h('div', { class: 'item-head', style: { cursor: 'default' } },
              h('span', { class: 'title' }, e.name),
              e.linked ? h('span', { class: 'chip on' }, 'verknüpft') : null,
              h('button', {
                class: 'btn small',
                onclick: async (ev) => {
                  ev.target.disabled = true;
                  log.style.color = '';
                  log.textContent = `Importiere ${e.name} …`;
                  try {
                    const added = await sync.importRemote(e);
                    log.textContent = `„${added.name}" importiert.`;
                    if (onImported) onImported();
                  } catch (err) {
                    log.style.color = 'var(--danger)';
                    log.textContent = err.message;
                    ev.target.disabled = false;
                  }
                },
              }, e.linked ? 'Erneut importieren' : 'Importieren'))));
        }
      } catch (err) {
        clear(list);
        list.appendChild(h('div', { class: 'hint', style: { color: 'var(--danger)' } }, err.message));
      }
    }

    load();
    return h('div', {},
      h('h2', {}, 'Aus Repository importieren'),
      editor,
      h('div', { class: 'btn-row', style: { marginBottom: '10px' } },
        h('button', { class: 'btn small', onclick: load }, 'Verzeichnis laden')),
      list,
      log,
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn primary', onclick: () => close() }, 'Fertig')));
  });
}
