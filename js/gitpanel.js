// Per-project synchronisation dialog: status, push/pull, conflict resolution,
// pull requests and commit history.

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

/**
 * @param {object} project
 * @param {() => void} [onChanged] called after the local project was replaced
 */
export function openGitDialog(project, onChanged) {
  return modal((close) => {
    if (!gh.isConfigured()) {
      return h('div', {},
        h('h2', {}, 'GitHub einrichten'),
        h('p', { class: 'hint' },
          'Für die Synchronisation werden ein Repository und ein feingranularer Zugriffstoken benötigt (Berechtigung „Contents: read and write", für Pull Requests zusätzlich „Pull requests: write").'),
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn ghost', onclick: () => close() }, 'Später'),
          h('button', {
            class: 'btn primary',
            onclick: () => { close(); document.dispatchEvent(new CustomEvent('umllight:settings', { detail: { focus: 'git' } })); },
          }, 'Einstellungen öffnen')));
    }

    const cfg = gh.config();
    const head = h('div', { class: 'row', style: { marginBottom: '10px' } });
    const statusBox = h('div', { class: 'card', style: { marginBottom: '12px' } }, h('div', { class: 'spinner' }));
    const actions = h('div', { class: 'btn-row', style: { marginBottom: '8px' } });
    const historyBox = h('div', {});
    const log = h('div', { class: 'hint', style: { margin: '8px 0 0' } });

    let current = null;
    let pathValue = sync.linkOf(project)?.path || sync.defaultPath(project);
    let message = '';

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
      onclick: async () => {
        setBusy('Arbeite …');
        try { await fn(); } catch (err) { fail(err); }
      },
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
      pathField.hidden = !!st;
      clear(statusBox);
      statusBox.appendChild(h('div', { class: 'row', style: { marginBottom: '8px' } },
        h('strong', { style: { flex: '1 1 auto' } }, project.name),
        statusChip(current.status)));
      statusBox.appendChild(h('div', { class: 'hint', style: { margin: 0 } },
        st
          ? `${st.repo || gh.repoKey()} · ${st.branch || cfg.branch || 'Standard-Branch'} · ${st.path}`
          : `${gh.repoKey()} · noch nicht verknüpft`));
      if (st?.syncedAt) {
        statusBox.appendChild(h('div', { class: 'hint', style: { margin: '4px 0 0' } },
          `Zuletzt synchronisiert: ${fmtDate(st.syncedAt)}`));
      }
      if (st?.lastPr) {
        statusBox.appendChild(h('div', { class: 'hint', style: { margin: '4px 0 0' } },
          'Letzter Pull Request: ', h('a', { href: st.lastPr.url, target: '_blank', rel: 'noopener' }, `#${st.lastPr.number}`)));
      }
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
          await sync.link(project, { path: pathValue.trim() || sync.defaultPath(project) });
          try {
            await sync.push(project, { message: message.trim() || undefined });
          } catch (err) {
            if (err.code === 'exists') {
              const useRemote = await confirmDialog('Datei existiert bereits',
                `Unter „${pathValue}" liegt bereits eine Datei. Deren Inhalt laden (lokale Fassung wird ersetzt)?`, 'Laden');
              if (useRemote) { await sync.pull(project); done('Vom Repository geladen.'); return; }
              throw new Error('Push abgebrochen — anderen Pfad wählen oder Datei laden.');
            }
            throw err;
          }
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
          log.textContent = '';
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

    const pathField = field('Pfad im Repository',
      textInput(pathValue, (val) => { pathValue = val; }, { spellcheck: 'false' }),
      'Wird beim ersten Push angelegt.');
    pathField.hidden = !!sync.linkOf(project);

    const body = h('div', {},
      h('h2', {}, 'Repository-Synchronisation'),
      head,
      statusBox,
      field('Commit-Nachricht (optional)',
        textInput('', (val) => { message = val; }, { placeholder: sync.commitMessage(project) })),
      pathField,
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

/** Import dialog for project files that exist in the repository but not locally. */
export function openImportDialog(onImported) {
  return modal((close) => {
    const list = h('div', {}, h('div', { class: 'spinner' }));
    const log = h('div', { class: 'hint', style: { margin: '8px 0 0' } });

    (async () => {
      try {
        const entries = await sync.listRemoteProjects();
        clear(list);
        if (!entries.length) {
          list.appendChild(h('div', { class: 'empty' }, 'Keine Projektdateien im konfigurierten Verzeichnis gefunden.'));
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
    })();

    return h('div', {},
      h('h2', {}, 'Aus Repository importieren'),
      h('p', { class: 'hint' }, `${gh.repoKey()} · ${gh.config().path || 'Wurzelverzeichnis'}`),
      list,
      log,
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn primary', onclick: () => close() }, 'Fertig')));
  });
}
