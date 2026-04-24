'use strict';
'require view';
'require fs';
'require rpc';
'require ui';

var API_BASE = 'http://127.0.0.1:4000/api';
var METRICS_URL = 'http://127.0.0.1:4000/metrics';

var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: [ 'name' ],
	expect: { '': {} }
});

function safeString(value) {
	if (value === null || value === undefined)
		return '';

	return String(value);
}

function formatNumber(value) {
	var number = Number(value || 0);

	if (!isFinite(number))
		number = 0;

	return number.toLocaleString ? number.toLocaleString() : String(number);
}

function formatPercent(value) {
	var number = Number(value || 0);

	if (!isFinite(number))
		number = 0;

	return number.toFixed(1) + '%';
}

function formatDuration(seconds) {
	var value = Number(seconds || 0);
	var hours;
	var minutes;

	if (!isFinite(value) || value <= 0)
		return _('not scheduled');

	hours = Math.floor(value / 3600);
	minutes = Math.floor((value % 3600) / 60);

	if (hours > 0)
		return '%dh %02dm %02ds'.format(hours, minutes, value % 60);

	return '%dm %02ds'.format(minutes, value % 60);
}

function parseJson(text) {
	if (!text)
		return {};

	return JSON.parse(text);
}

function fetchText(url) {
	return fs.exec_direct('/bin/uclient-fetch', [ '-q', '-O', '-', url ]);
}

function blockyApi(path) {
	return fetchText(API_BASE + path).then(parseJson);
}

function isRunning(service) {
	return !!(service && service.blocky && service.blocky.instances &&
		service.blocky.instances.instance1 && service.blocky.instances.instance1.running);
}

function parseLabels(text) {
	var labels = {};
	var index = 0;
	var key = '';
	var value = '';
	var inKey = true;
	var inQuote = false;
	var escapeNext = false;

	if (!text)
		return labels;

	function commit() {
		if (key)
			labels[key] = value;

		key = '';
		value = '';
		inKey = true;
	}

	while (index < text.length) {
		var chr = text.charAt(index++);

		if (escapeNext) {
			value += chr;
			escapeNext = false;
			continue;
		}

		if (!inKey && chr === '\\') {
			escapeNext = true;
			continue;
		}

		if (!inKey && chr === '"') {
			inQuote = !inQuote;
			continue;
		}

		if (inKey && chr === '=') {
			inKey = false;
			continue;
		}

		if (!inQuote && chr === ',') {
			commit();
			continue;
		}

		if (inKey)
			key += chr;
		else
			value += chr;
	}

	commit();

	return labels;
}

function parseMetrics(text) {
	var families = {};
	var order = [];
	var lines = safeString(text).split(/\n/);

	function family(name) {
		if (!families[name]) {
			families[name] = {
				name: name,
				type: '',
				help: '',
				total: 0,
				samples: []
			};
			order.push(name);
		}

		return families[name];
	}

	lines.forEach(function(line) {
		var comment;
		var match;
		var item;
		var value;

		if (!line)
			return;

		comment = line.match(/^#\s+(HELP|TYPE)\s+([^\s]+)\s+(.+)$/);
		if (comment) {
			item = family(comment[2]);

			if (comment[1] === 'HELP')
				item.help = comment[3];
			else
				item.type = comment[3];

			return;
		}

		if (line.charAt(0) === '#')
			return;

		match = line.match(/^([A-Za-z_:][A-Za-z0-9_:]*)(?:\{([^}]*)\})?\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?:\s+\d+)?$/);
		if (!match)
			return;

		value = Number(match[3]);
		if (!isFinite(value))
			return;

		item = family(match[1]);
		item.total += value;
		item.samples.push({
			labels: parseLabels(match[2]),
			value: value
		});
	});

	return {
		order: order,
		families: families
	};
}

function findTotal(metrics, exactNames, patterns) {
	var i;
	var name;
	var family;

	for (i = 0; i < exactNames.length; i++) {
		family = metrics.families[exactNames[i]];
		if (family)
			return family.total;
	}

	for (i = 0; i < metrics.order.length; i++) {
		name = metrics.order[i];

		if (patterns.some(function(pattern) { return pattern.test(name); }))
			return metrics.families[name].total;
	}

	return 0;
}

function deriveOverview(metrics) {
	var totalQueries = findTotal(metrics, [
		'blocky_query_total',
		'blocky_queries_total'
	], [ /blocky.*quer.*total/i ]);
	var blockedQueries = findTotal(metrics, [
		'blocky_query_blocked_total',
		'blocky_blocked_total'
	], [ /blocky.*block.*total/i, /blocky.*quer.*block/i ]);
	var cacheHits = findTotal(metrics, [
		'blocky_cache_hit_total',
		'blocky_cache_hits_total'
	], [ /blocky.*cache.*hit/i ]);
	var cacheMisses = findTotal(metrics, [
		'blocky_cache_miss_total',
		'blocky_cache_misses_total'
	], [ /blocky.*cache.*miss/i ]);
	var denylistEntries = findTotal(metrics, [
		'blocky_blocking_denylists_entries',
		'blocky_denylists_entries'
	], [ /blocky.*deny.*entr/i, /blocky.*list.*entr/i ]);

	return {
		totalQueries: totalQueries,
		blockedQueries: blockedQueries,
		blockedRate: totalQueries > 0 ? blockedQueries / totalQueries * 100 : 0,
		cacheHitRate: cacheHits + cacheMisses > 0 ? cacheHits / (cacheHits + cacheMisses) * 100 : 0,
		denylistEntries: denylistEntries
	};
}

function labelsToText(labels) {
	var keys = Object.keys(labels || {}).sort();

	if (!keys.length)
		return '-';

	return keys.map(function(key) {
		return '%s="%s"'.format(key, labels[key]);
	}).join(', ');
}

function metricSortScore(name) {
	if (/query|response|block|cache|deny|allow/i.test(name))
		return 0;

	if (/upstream|prefetch|conditional|client/i.test(name))
		return 1;

	return 2;
}

function renderCard(title, value, description) {
	return E('div', { 'class': 'td left', 'style': 'min-width:12em; padding:1em' }, [
		E('strong', {}, [ title ]),
		E('div', { 'style': 'font-size:1.8em; margin:.25em 0' }, [ value ]),
		E('small', {}, [ description ])
	]);
}

function renderStatus(status, service, metrics) {
	var running = isRunning(service);
	var enabled = status && status.enabled;
	var paused = status && status.autoEnableInSec > 0;

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Runtime') ]),
		E('div', { 'class': 'table' }, [
			E('div', { 'class': 'tr' }, [
				E('div', { 'class': 'td left', 'style': 'width:25%' }, [ _('Service') ]),
				E('div', { 'class': 'td left' }, [ running ? _('running') : _('stopped') ])
			]),
			E('div', { 'class': 'tr' }, [
				E('div', { 'class': 'td left' }, [ _('Blocking') ]),
				E('div', { 'class': 'td left' }, [
					paused ? _('paused, auto-enables in %s').format(formatDuration(status.autoEnableInSec)) :
						(enabled ? _('enabled') : _('disabled'))
				])
			]),
			E('div', { 'class': 'tr' }, [
				E('div', { 'class': 'td left' }, [ _('Metric families') ]),
				E('div', { 'class': 'td left' }, [ formatNumber(metrics.order.length) ])
			]),
			E('div', { 'class': 'tr' }, [
				E('div', { 'class': 'td left' }, [ _('Metric samples') ]),
				E('div', { 'class': 'td left' }, [
					formatNumber(metrics.order.reduce(function(total, name) {
						return total + metrics.families[name].samples.length;
					}, 0))
				])
			])
		])
	]);
}

function renderOverview(metrics) {
	var overview = deriveOverview(metrics);

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Overview') ]),
		E('div', { 'class': 'table' }, [
			E('div', { 'class': 'tr' }, [
				renderCard(_('Queries'), formatNumber(overview.totalQueries), _('Total query counter, when exposed')),
				renderCard(_('Blocked'), formatNumber(overview.blockedQueries), formatPercent(overview.blockedRate)),
				renderCard(_('Cache hit rate'), formatPercent(overview.cacheHitRate), _('From hit/miss counters')),
				renderCard(_('Listed domains'), formatNumber(overview.denylistEntries), _('From denylist metrics'))
			])
		])
	]);
}

function renderMetricFamily(family) {
	var rows = family.samples.map(function(sample) {
		return E('div', { 'class': 'tr' }, [
			E('div', { 'class': 'td left', 'style': 'width:55%' }, [ labelsToText(sample.labels) ]),
			E('div', { 'class': 'td left' }, [ formatNumber(sample.value) ])
		]);
	});

	if (!rows.length)
		rows.push(E('div', { 'class': 'tr' }, [
			E('div', { 'class': 'td left' }, [ _('No samples') ]),
			E('div', { 'class': 'td left' }, [ '-' ])
		]));

	return E('details', {
		'class': 'cbi-section',
		'data-metric-name': family.name.toLowerCase(),
		'open': metricSortScore(family.name) === 0 ? '' : null
	}, [
		E('summary', {}, [
			E('strong', {}, [ family.name ]),
			' ',
			E('small', {}, [
				_('type: %s, samples: %d').format(family.type || _('unknown'), family.samples.length)
			])
		]),
		family.help ? E('p', { 'class': 'cbi-section-descr' }, [ family.help ]) : '',
		E('div', { 'class': 'table' }, [
			E('div', { 'class': 'tr table-titles' }, [
				E('div', { 'class': 'th left' }, [ _('Labels') ]),
				E('div', { 'class': 'th left' }, [ _('Value') ])
			])
		].concat(rows))
	]);
}

function renderAllMetrics(metrics) {
	var filter = E('input', {
		'type': 'text',
		'class': 'cbi-input-text',
		'placeholder': _('Filter metrics'),
		'style': 'min-width:20em'
	});
	var names = metrics.order.slice().sort(function(a, b) {
		var score = metricSortScore(a) - metricSortScore(b);

		if (score !== 0)
			return score;

		return a.localeCompare(b);
	});
	var families = names.map(function(name) {
		return renderMetricFamily(metrics.families[name]);
	});

	filter.addEventListener('input', function() {
		var needle = filter.value.trim().toLowerCase();

		families.forEach(function(node) {
			var name = node.getAttribute('data-metric-name') || '';

			node.style.display = !needle || name.indexOf(needle) !== -1 ? '' : 'none';
		});
	});

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('All Metrics') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('Every Prometheus metric family returned by Blocky is shown below. Values are rendered as text and never interpreted as HTML.')
		]),
		E('p', {}, [ filter ])
	].concat(families));
}

function renderNoMetrics(raw) {
	return E('div', { 'class': 'alert-message warning' }, [
		_('No metrics were returned from %s. Ensure Blocky is running and prometheus.enable is true in /etc/blocky/config.yml.').format(METRICS_URL),
		raw ? E('pre', { 'style': 'white-space:pre-wrap; margin-top:1em' }, [ raw ]) : ''
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callServiceList('blocky'), {}),
			L.resolveDefault(blockyApi('/blocking/status'), { enabled: false }),
			L.resolveDefault(fetchText(METRICS_URL), '')
		]);
	},

	render: function(data) {
		var service = data[0];
		var status = data[1];
		var rawMetrics = data[2];
		var metrics = parseMetrics(rawMetrics);

		return E('div', {}, [
			E('h2', {}, [ _('Blocky Status') ]),
			E('p', { 'class': 'cbi-section-descr' }, [
				_('Runtime status and Prometheus metrics from the local Blocky instance.')
			]),
			metrics.order.length ? [
				renderStatus(status, service, metrics),
				renderOverview(metrics),
				renderAllMetrics(metrics)
			] : renderNoMetrics(rawMetrics)
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
