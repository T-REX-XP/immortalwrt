'use strict';
'require view';
'require fs';
'require rpc';
'require ui';

var CONFIG_PATH = '/etc/blocky/config.yml';
var API_BASE = 'http://127.0.0.1:4000/api';
var METRICS_URL = 'http://127.0.0.1:4000/metrics';

var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: [ 'name' ],
	expect: { '': {} }
});

function notify(message, level) {
	ui.addNotification(null, E('p', {}, [ message ]), level || 'info');
}

function parseJson(text) {
	if (!text)
		return {};

	return JSON.parse(text);
}

function fetchText(url, method, body) {
	var args = [ '-q', '-O', '-' ];

	if (method === 'POST')
		args.push('--post-data=' + (body || ''));

	args.push(url);

	return fs.exec_direct('/usr/bin/uclient-fetch', args);
}

function fetchJson(url, method, body) {
	return fetchText(url, method, body).then(parseJson);
}

function blockyApi(path, method, body) {
	return fetchJson(API_BASE + path, method || 'GET', body);
}

function runInit(action) {
	return fs.exec_direct('/etc/init.d/blocky', [ action ]);
}

function renderStatus(status, service) {
	var enabled = status && status.enabled;
	var paused = status && status.autoEnableInSec > 0;
	var running = service && service.blocky && service.blocky.instances &&
		service.blocky.instances.instance1 && service.blocky.instances.instance1.running;

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Status') ]),
		E('div', { 'class': 'table' }, [
			E('div', { 'class': 'tr' }, [
				E('div', { 'class': 'td left', 'style': 'width:33%' }, [ _('Service') ]),
				E('div', { 'class': 'td left' }, [ running ? _('running') : _('stopped') ])
			]),
			E('div', { 'class': 'tr' }, [
				E('div', { 'class': 'td left' }, [ _('Blocking') ]),
				E('div', { 'class': 'td left' }, [
					paused ? _('paused for %d seconds').format(status.autoEnableInSec) :
						(enabled ? _('enabled') : _('disabled'))
				])
			]),
			E('div', { 'class': 'tr' }, [
				E('div', { 'class': 'td left' }, [ _('Disabled groups') ]),
				E('div', { 'class': 'td left' }, [
					status && status.disabledGroups && status.disabledGroups.length
						? status.disabledGroups.join(', ')
						: _('none')
				])
			])
		])
	]);
}

function renderActions() {
	var pause = E('input', {
		'type': 'text',
		'class': 'cbi-input-text',
		'value': '5m',
		'style': 'width:7em'
	});

	function actionButton(label, fn, style) {
		return E('button', {
			'class': 'cbi-button ' + (style || 'cbi-button-action'),
			'click': ui.createHandlerFn(this, function(ev) {
				ev.preventDefault();
				return fn().then(function() {
					notify(_('Action completed.'));
					return location.reload();
				}).catch(function(err) {
					notify(err.message || String(err), 'danger');
				});
			})
		}, [ label ]);
	}

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Controls') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('These actions call the Blocky HTTP API through rpcd on the router.')
		]),
		E('p', {}, [
			actionButton(_('Enable blocking'), function() {
				return blockyApi('/blocking/enable');
			}),
			' ',
			actionButton(_('Disable blocking'), function() {
				return blockyApi('/blocking/disable');
			}, 'cbi-button-negative'),
			' ',
			E('label', { 'style': 'margin-left:1em' }, [ _('Pause duration'), ' ', pause ]),
			' ',
			actionButton(_('Pause'), function() {
				return blockyApi('/blocking/disable?duration=' + encodeURIComponent(pause.value || '5m'));
			})
		]),
		E('p', {}, [
			actionButton(_('Refresh lists'), function() {
				return blockyApi('/lists/refresh', 'POST');
			}),
			' ',
			actionButton(_('Flush cache'), function() {
				return blockyApi('/cache/flush', 'POST');
			}),
			' ',
			actionButton(_('Restart service'), function() {
				return runInit('restart');
			}, 'cbi-button-apply')
		])
	]);
}

function renderQuery() {
	var query = E('input', {
		'type': 'text',
		'class': 'cbi-input-text',
		'placeholder': 'example.org',
		'style': 'min-width:22em'
	});
	var type = E('select', { 'class': 'cbi-input-select' }, [
		E('option', { 'value': 'A' }, [ 'A' ]),
		E('option', { 'value': 'AAAA' }, [ 'AAAA' ]),
		E('option', { 'value': 'CNAME' }, [ 'CNAME' ]),
		E('option', { 'value': 'MX' }, [ 'MX' ]),
		E('option', { 'value': 'TXT' }, [ 'TXT' ]),
		E('option', { 'value': 'PTR' }, [ 'PTR' ])
	]);
	var result = E('pre', { 'style': 'white-space:pre-wrap' }, [ _('No query executed yet.') ]);

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('DNS query test') ]),
		E('p', {}, [
			query, ' ', type, ' ',
			E('button', {
				'class': 'cbi-button cbi-button-action',
				'click': ui.createHandlerFn(this, function(ev) {
					ev.preventDefault();

					if (!query.value) {
						notify(_('Enter a domain name first.'), 'warning');
						return;
					}

					return blockyApi('/query', 'POST', JSON.stringify({
						query: query.value,
						type: type.value
					})).then(function(res) {
						result.textContent = JSON.stringify(res, null, 2);
					}).catch(function(err) {
						result.textContent = err.message || String(err);
					});
				})
			}, [ _('Query') ])
		]),
		result
	]);
}

function renderMetrics(metrics) {
	var text = metrics || '';
	var lines = text.split(/\n/).filter(function(line) {
		return line && line.charAt(0) !== '#';
	}).slice(0, 20);

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Metrics') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('Shows the first Prometheus samples if Blocky metrics are enabled.')
		]),
		E('pre', { 'style': 'white-space:pre-wrap; max-height:20em; overflow:auto' }, [
			lines.length ? lines.join('\n') : _('No metrics returned. Enable prometheus in the Blocky configuration to use this section.')
		])
	]);
}

function renderConfig(content) {
	var editor = E('textarea', {
		'class': 'cbi-input-textarea',
		'style': 'width:100%; min-height:28em; font-family:monospace'
	}, [ content || '' ]);

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Configuration') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('Edit %s directly. Save and restart Blocky for changes to take effect.').format(CONFIG_PATH)
		]),
		editor,
		E('p', {}, [
			E('button', {
				'class': 'cbi-button cbi-button-save',
				'click': ui.createHandlerFn(this, function(ev) {
					ev.preventDefault();

					return fs.write(CONFIG_PATH, editor.value).then(function() {
						notify(_('Configuration saved.'));
					}).catch(function(err) {
						notify(err.message || String(err), 'danger');
					});
				})
			}, [ _('Save configuration') ]),
			' ',
			E('button', {
				'class': 'cbi-button cbi-button-apply',
				'click': ui.createHandlerFn(this, function(ev) {
					ev.preventDefault();

					return fs.write(CONFIG_PATH, editor.value).then(function() {
						return runInit('restart');
					}).then(function() {
						notify(_('Configuration saved and Blocky restarted.'));
						return location.reload();
					}).catch(function(err) {
						notify(err.message || String(err), 'danger');
					});
				})
			}, [ _('Save & restart') ])
		])
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callServiceList('blocky'), {}),
			L.resolveDefault(blockyApi('/blocking/status'), { enabled: false }),
			L.resolveDefault(fs.read_direct(CONFIG_PATH), ''),
			L.resolveDefault(fetchText(METRICS_URL), '')
		]);
	},

	render: function(data) {
		var service = data[0];
		var status = data[1];
		var config = data[2];
		var metrics = data[3];

		return E('div', {}, [
			E('h2', {}, [ _('Blocky DNS') ]),
			E('p', { 'class': 'cbi-section-descr' }, [
				_('Manage the local Blocky DNS proxy and ad-blocker. The dashboard uses Blocky API actions inspired by blocky-ui projects, while keeping the implementation native to LuCI.')
			]),
			renderStatus(status, service),
			renderActions(),
			renderQuery(),
			renderMetrics(metrics),
			renderConfig(config)
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
