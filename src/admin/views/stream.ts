/**
 * Admin live stream — real-time statement feed via SSE.
 */

import { html, raw } from './html.ts';
import type { RawHtml } from './html.ts';

const STREAM_SCRIPT = /* js */ `
(function() {
  var feed = document.getElementById('stream-feed');
  var toggle = document.getElementById('stream-toggle');
  var clearBtn = document.getElementById('stream-clear');
  var status = document.getElementById('stream-status');
  var paused = false;
  var eventSource = null;
  var count = 0;

  function formatActor(actor) {
    if (!actor) return '\\u2014';
    if (actor.name) return actor.name;
    if (actor.mbox) return actor.mbox.replace('mailto:', '');
    if (actor.account) return (actor.account.name || '') + '@' + (actor.account.homePage || '');
    return '(anonymous)';
  }

  function formatVerb(iri) {
    if (!iri) return '\\u2014';
    var parts = iri.split('/');
    return parts[parts.length - 1] || iri;
  }

  function formatObject(obj) {
    if (!obj) return '\\u2014';
    if (obj.definition && obj.definition.name) {
      var names = obj.definition.name;
      return names['en-US'] || names['en'] || Object.values(names)[0] || obj.id || '\\u2014';
    }
    return obj.id || '\\u2014';
  }

  function connect() {
    eventSource = new EventSource('/admin/stream/events');

    eventSource.addEventListener('statement_stored', function(e) {
      if (paused) return;
      count++;
      status.textContent = count + ' events received';

      try {
        var data = JSON.parse(e.data);
        var stmt = data.statement || {};
        var card = document.createElement('div');
        card.className = 'stream-card';

        var grid = document.createElement('div');
        grid.className = 'grid';

        var verbCell = document.createElement('div');
        var verbLink = document.createElement('a');
        verbLink.href = '/admin/statements/' + data.id;
        var verbStrong = document.createElement('strong');
        verbStrong.textContent = formatVerb(data.verbIri || (stmt.verb && stmt.verb.id));
        verbLink.appendChild(verbStrong);
        verbCell.appendChild(verbLink);

        var actorCell = document.createElement('div');
        actorCell.textContent = formatActor(stmt.actor);

        var objectCell = document.createElement('div');
        objectCell.textContent = formatObject(stmt.object);

        var timeCell = document.createElement('div');
        timeCell.className = 'text-muted';
        timeCell.textContent = (stmt.stored || new Date().toISOString()).slice(0, 19).replace('T', ' ');

        grid.appendChild(verbCell);
        grid.appendChild(actorCell);
        grid.appendChild(objectCell);
        grid.appendChild(timeCell);
        card.appendChild(grid);

        feed.insertBefore(card, feed.firstChild);

        while (feed.children.length > 100) {
          feed.removeChild(feed.lastChild);
        }
      } catch(err) {
        console.error('SSE parse error:', err);
      }
    });

    eventSource.onopen = function() {
      status.textContent = 'Connected \\u2014 waiting for statements...';
    };

    eventSource.onerror = function() {
      status.textContent = 'Disconnected \\u2014 reconnecting...';
    };
  }

  toggle.addEventListener('click', function() {
    paused = !paused;
    toggle.textContent = paused ? 'Resume' : 'Pause';
    if (paused) {
      status.textContent = 'Paused (' + count + ' events)';
    } else {
      status.textContent = count + ' events received';
    }
  });

  clearBtn.addEventListener('click', function() {
    feed.innerHTML = '';
    count = 0;
    status.textContent = paused ? 'Paused' : 'Connected \\u2014 waiting for statements...';
  });

  connect();
})();
`;

export function streamPage(): RawHtml {
  return html`
    <h2>Live Statement Stream</h2>
    <p class="text-muted">Real-time feed of incoming xAPI statements via Server-Sent Events.</p>

    <div style="display:flex;gap:1em;margin-bottom:1em">
      <button id="stream-toggle" class="outline">Pause</button>
      <button id="stream-clear" class="outline secondary">Clear</button>
      <span id="stream-status" class="text-muted">Connecting...</span>
    </div>

    <div id="stream-feed"></div>

    <script>${raw(STREAM_SCRIPT)}</script>
  `;
}
